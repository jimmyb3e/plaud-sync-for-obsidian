export type SyncTrigger = 'manual' | 'startup' | 'scheduled';

export interface PlaudSyncRuntimeOptions {
	isStartupEnabled: () => boolean;
	runSync: (trigger: SyncTrigger) => Promise<void>;
	onLocked: (message: string) => void;
}

const LOCKED_MESSAGE = 'Plaud sync already running. Please wait for current run to finish.';

export interface PlaudSyncRuntime {
	runManualSync(): Promise<boolean>;
	runStartupSync(): Promise<boolean>;
	/** Scheduled persistence and sync both run inside the existing shared lock. */
	runScheduledSync(task?: () => Promise<void>): Promise<boolean>;
}

export function createPlaudSyncRuntime(options: PlaudSyncRuntimeOptions): PlaudSyncRuntime {
	let running = false;

	const runWithLock = async (trigger: SyncTrigger, task = () => options.runSync(trigger)): Promise<boolean> => {
		if (running) {
			if (trigger !== 'scheduled') {
				options.onLocked(LOCKED_MESSAGE);
			}
			return false;
		}

		running = true;

		try {
			await task();
			return true;
		} finally {
			running = false;
		}
	};

	return {
		runManualSync: () => runWithLock('manual'),
		runStartupSync: () => {
			if (!options.isStartupEnabled()) {
				return Promise.resolve(false);
			}

			return runWithLock('startup');
		},
		runScheduledSync: (task) => runWithLock('scheduled', task)
	};
}
