import {dueScheduledRunAt, nextScheduledRunAt} from './daily-schedule.ts';
import type {PlaudPluginSettings} from './settings-schema.ts';
import type {PlaudSyncSummary} from './plaud-sync.ts';
import type {PlaudSyncRuntime} from './sync-runtime.ts';
import {scheduledSyncFailureFromError, type ScheduledSyncFailure} from './scheduled-sync-status.ts';

interface ScheduledSyncOptions {
	getSettings: () => PlaudPluginSettings;
	saveSettings: () => Promise<void>;
	runtime: PlaudSyncRuntime;
	sync: () => Promise<PlaudSyncSummary>;
	onFailure: (failure: ScheduledSyncFailure) => void;
	now?: () => number;
	setTimer?: (callback: () => void, delayMs: number) => number;
	clearTimer?: (id: number) => void;
}

// Recheck the local clock/timezone at least once a minute, including after sleep.
const CLOCK_CHECK_MS = 60_000;
const LOCK_RETRY_MS = 30_000;

export class PlaudScheduledSync {
	private active = false;
	private checking = false;
	private timer: number | null = null;
	private configuration = '';
	private readonly now: () => number;
	private readonly setTimer: (callback: () => void, delayMs: number) => number;
	private readonly clearTimer: (id: number) => void;
	private readonly options: ScheduledSyncOptions;

	constructor(options: ScheduledSyncOptions) {
		this.options = options;
		this.now = options.now ?? Date.now;
		this.setTimer = options.setTimer ?? ((callback, delayMs) => window.setTimeout(callback, delayMs));
		this.clearTimer = options.clearTimer ?? ((id) => window.clearTimeout(id));
	}

	async start(): Promise<void> {
		if (this.active) {
			return;
		}
		this.active = true;
		this.configuration = this.configurationKey();
		const settings = this.options.getSettings();
		try {
			if (settings.scheduledSyncStatus === 'running') {
				// A persisted running attempt belongs to the previous plugin session.
				settings.scheduledSyncStatus = 'failed';
				settings.scheduledSyncFailure = 'interrupted';
				await this.options.saveSettings();
			}
			if (settings.scheduledSyncEnabled && settings.scheduledSyncEnabledAtMs === 0) {
				// A new schedule starts now; do not invent missed slots before it was enabled.
				settings.scheduledSyncEnabledAtMs = this.now();
				await this.options.saveSettings();
			}
			if (!this.active) {
				return;
			}
			if (this.dueRunAt() !== null) {
				// Catch-up fulfills startup sync too, avoiding two incremental batches on open.
				await this.tick();
			} else {
				this.armNext();
				await this.options.runtime.runStartupSync();
			}
		} catch {
			this.options.onFailure('persistence');
			this.armNext();
		}
	}

	/** Called before settings are saved so the new schedule's baseline is persisted too. */
	settingsChanged(): void {
		const configuration = this.configurationKey();
		if (configuration === this.configuration) {
			return;
		}
		this.configuration = configuration;
		const settings = this.options.getSettings();
		settings.scheduledSyncEnabledAtMs = settings.scheduledSyncEnabled ? this.now() : 0;
		this.armNext();
	}

	stop(): void {
		this.active = false;
		this.clearPendingTimer();
	}

	private configurationKey(): string {
		const settings = this.options.getSettings();
		return `${settings.scheduledSyncEnabled}:${settings.scheduledSyncTimes.join(',')}`;
	}

	private dueRunAt(): number | null {
		const settings = this.options.getSettings();
		return settings.scheduledSyncEnabled ? dueScheduledRunAt(
			this.now(), settings.scheduledSyncTimes,
			Math.max(settings.scheduledSyncEnabledAtMs, settings.lastScheduledSlotAtMs)
		) : null;
	}

	private clearPendingTimer(): void {
		if (this.timer !== null) {
			this.clearTimer(this.timer);
			this.timer = null;
		}
	}

	private armNext(): void {
		this.clearPendingTimer();
		const settings = this.options.getSettings();
		if (!this.active || !settings.scheduledSyncEnabled) {
			return;
		}
		const next = nextScheduledRunAt(this.now(), settings.scheduledSyncTimes);
		const delay = this.dueRunAt() !== null ? LOCK_RETRY_MS : (next ?? this.now() + CLOCK_CHECK_MS) - this.now();
		const timerId = this.setTimer(() => {
			// A cleared callback may already be queued; it must not orphan the replacement timer.
			if (this.timer !== timerId) {
				return;
			}
			this.timer = null;
			void this.tick();
		}, Math.max(1, Math.min(CLOCK_CHECK_MS, delay)));
		this.timer = timerId;
	}

	private async tick(): Promise<void> {
		if (!this.active || this.checking) {
			return;
		}
		this.checking = true;
		try {
			const slot = this.dueRunAt();
			if (slot !== null) {
				// A busy runtime leaves the slot unclaimed; retry after the other sync finishes.
				await this.options.runtime.runScheduledSync(() => this.attempt(slot));
			}
		} finally {
			this.checking = false;
			this.armNext();
		}
	}

	private async attempt(slot: number): Promise<void> {
		const settings = this.options.getSettings();
		settings.lastScheduledSlotAtMs = slot;
		settings.lastScheduledAttemptAtMs = this.now();
		settings.scheduledSyncStatus = 'running';
		settings.scheduledSyncFailure = null;
		let attemptSaved = false;
		try {
			await this.options.saveSettings();
			attemptSaved = true;
			const summary = await this.options.sync();
			if (summary.failed > 0) {
				settings.scheduledSyncStatus = 'failed';
				settings.scheduledSyncFailure = 'partial_failure';
			} else {
				settings.scheduledSyncStatus = summary.selected === 0 ? 'no_new_recordings' : 'success';
				settings.lastSuccessfulScheduledSyncAtMs = this.now();
			}
		} catch (error) {
			settings.scheduledSyncStatus = 'failed';
			settings.scheduledSyncFailure = attemptSaved ? scheduledSyncFailureFromError(error) : 'persistence';
		}
		try {
			await this.options.saveSettings();
		} catch {
			this.options.onFailure('persistence');
			return;
		}
		if (settings.scheduledSyncFailure) {
			this.options.onFailure(settings.scheduledSyncFailure);
		}
	}
}
