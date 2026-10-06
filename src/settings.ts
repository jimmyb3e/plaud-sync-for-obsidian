import {App, Notice, PluginSettingTab, Setting} from 'obsidian';
import type PlaudSyncPlugin from './main';
import {clearPlaudToken, getPlaudToken, setPlaudToken} from './secret-store';
import {DEFAULT_SETTINGS} from './settings-schema';
import {parseDailySyncTimes} from './daily-schedule';

export class PlaudSettingTab extends PluginSettingTab {
	plugin: PlaudSyncPlugin;

	constructor(app: App, plugin: PlaudSyncPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;
		containerEl.empty();

		const tokenStatusSetting = new Setting(containerEl)
			.setName('Plaud token status')
			.setDesc('Checking token status...');

		new Setting(containerEl)
			.setName('Plaud token')
			.setDesc('Stored in Obsidian secret storage when available. Saved tokens are not displayed here.')
			.addText((text) => {
				text.inputEl.type = 'password';
				text.setPlaceholder('Paste new plaud token');

				text.onChange(async (value) => {
					const token = value.trim();
					if (!token) {
						await clearPlaudToken(this.app);
						await this.refreshTokenStatus(tokenStatusSetting);
						new Notice('Plaud token cleared. Paste a token to enable API sync.');
						return;
					}

					try {
						await setPlaudToken(this.app, token);
						text.setValue('');
						await this.refreshTokenStatus(tokenStatusSetting);
						new Notice('Plaud token saved.');
					} catch (error) {
						const message = error instanceof Error ? error.message : 'Failed to save Plaud token.';
						new Notice(message);
					}
				});
			});

		void this.refreshTokenStatus(tokenStatusSetting);

		new Setting(containerEl)
			.setName('API domain')
			.setDesc('Base endpoint for plaud requests.')
			.addText((text) => text
				.setPlaceholder(DEFAULT_SETTINGS.apiDomain)
				.setValue(this.plugin.settings.apiDomain)
				.onChange(async (value) => {
					this.plugin.settings.apiDomain = value.trim() || DEFAULT_SETTINGS.apiDomain;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Sync folder')
			.setDesc('Store synced notes in this folder.')
			.addText((text) => text
				.setPlaceholder('Plaud')
				.setValue(this.plugin.settings.syncFolder)
				.onChange(async (value) => {
					this.plugin.settings.syncFolder = value.trim() || DEFAULT_SETTINGS.syncFolder;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Sync on startup')
			.setDesc('Run a sync automatically when Obsidian starts.')
			.addToggle((toggle) => toggle
				.setValue(this.plugin.settings.syncOnStartup)
				.onChange(async (value) => {
					this.plugin.settings.syncOnStartup = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Scheduled sync')
			.setDesc('Sync daily at the configured local times. Catch up once when Obsidian opens after a missed time.')
			.addToggle((toggle) => toggle
				.setValue(this.plugin.settings.scheduledSyncEnabled)
				.onChange(async (value) => {
					this.plugin.settings.scheduledSyncEnabled = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Daily sync times')
			.setDesc('Enter 24-hour times separated by commas, such as 08:00, 17:00. Uses your computer’s local timezone.')
			.addText((text) => text
				.setPlaceholder('08:00, 17:00')
				.setValue(this.plugin.settings.scheduledSyncTimes.join(', '))
				.onChange(async (value) => {
					const times = parseDailySyncTimes(value.split(','));
					text.inputEl.setCustomValidity(times ? '' : 'Enter valid times, such as 08:00, 17:00.');
					if (times) {
						this.plugin.settings.scheduledSyncTimes = times;
						await this.plugin.saveSettings();
					}
				}));

		const schedule = this.plugin.settings;
		const statusLabels = {
			never: 'No scheduled sync yet', running: 'Sync in progress', success: 'Sync complete',
			no_new_recordings: 'No new recordings', failed: 'Sync failed'
		};
		const lastAttempt = schedule.lastScheduledAttemptAtMs > 0
			? new Date(schedule.lastScheduledAttemptAtMs).toLocaleString() : 'Never';
		const lastSuccess = schedule.lastSuccessfulScheduledSyncAtMs > 0
			? new Date(schedule.lastSuccessfulScheduledSyncAtMs).toLocaleString() : 'Never';
		new Setting(containerEl)
			.setName('Scheduled sync status')
			.setDesc(`${statusLabels[schedule.scheduledSyncStatus]}. Last attempt: ${lastAttempt}. Last success: ${lastSuccess}.`);

		new Setting(containerEl)
			.setName('Update existing notes')
			.setDesc('Update existing files when matching plaud recordings are found.')
			.addToggle((toggle) => toggle
				.setValue(this.plugin.settings.updateExisting)
				.onChange(async (value) => {
					this.plugin.settings.updateExisting = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Filename pattern')
			.setDesc('Pattern used for new synced files. Supports {date}, {time}, and {title}.')
			.addText((text) => text
				.setPlaceholder(DEFAULT_SETTINGS.filenamePattern)
				.setValue(this.plugin.settings.filenamePattern)
				.onChange(async (value) => {
					this.plugin.settings.filenamePattern = value.trim() || DEFAULT_SETTINGS.filenamePattern;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Last sync checkpoint')
			.setDesc('Unix timestamp in milliseconds for incremental sync state.')
			.addText((text) => text
				.setValue(String(this.plugin.settings.lastSyncAtMs))
				.onChange(async (value) => {
					const parsed = Number.parseInt(value, 10);
					this.plugin.settings.lastSyncAtMs = Number.isFinite(parsed) && parsed >= 0
						? parsed
						: DEFAULT_SETTINGS.lastSyncAtMs;
					await this.plugin.saveSettings();
				}));
	}

	private async refreshTokenStatus(statusSetting: Setting): Promise<void> {
		const token = await getPlaudToken(this.app);
		statusSetting.setDesc(
			token
				? 'Plaud token configured. Use Validate token command to confirm access.'
				: 'Plaud token missing. Paste your token above to enable sync.'
		);
	}
}
