# Plaud Sync for Obsidian

Sync your [Plaud](https://plaud.ai/) voice recordings into Markdown notes inside your Obsidian vault — transcripts, AI summaries, highlights, and metadata included.

> **Unofficial plugin.** Plaud does not offer a public API. This plugin uses a [reverse-engineered API](https://github.com/leonardsellem/plaud-api-reveng) discovered by inspecting the Plaud web app. It may break without notice if Plaud changes their backend. Use at your own risk.

## Features

- **Incremental sync** — only fetches recordings newer than your last sync checkpoint; never creates duplicates
- **Rich Markdown notes** — renders title, date, duration, AI summary, key highlights, and full transcript with speaker labels
- **Idempotent updates** — uses a stable `file_id` in frontmatter to update existing notes in place
- **Secure token storage** — stores your Plaud session token via Obsidian's Secret Storage API (local fallback if unavailable)
- **Retry with backoff** — transient failures (network, rate-limit, 5xx) are retried automatically; permanent failures (auth, bad response) are surfaced immediately
- **Trash filtering** — recordings you deleted in Plaud are automatically skipped
- **Content hydration** — fetches full transcript and AI summary content from Plaud's signed URLs
- **Scheduled sync** — configurable daily local times, with one catch-up sync after a missed time

## Requirements

- Obsidian **1.4.0** or later
- A Plaud account with recordings
- A session token extracted from the Plaud web app (see [Obtaining your token](#obtaining-your-token))

## Installation

### Manual install

```bash
git clone https://github.com/leonardsellem/plaud-sync-for-obsidian.git
cd plaud-sync-for-obsidian
npm ci
npm run build
```

Copy these three files into your vault's plugin directory
(e.g. `<vault>/.obsidian/plugins/plaud-sync/`):

- `main.js`
- `manifest.json`
- `styles.css`

Restart Obsidian and enable **Plaud Sync** under **Settings → Community plugins**.

## Obtaining your token

Plaud has no official API or developer portal. The token is a JWT session cookie stored in your browser when you use the Plaud web app.

1. Open [web.plaud.ai](https://web.plaud.ai/) and log in
2. Open your browser's Developer Tools (`F12` or `Cmd+Opt+I`)
3. Go to the **Console** tab and run:
   ```js
   localStorage.getItem("tokenstr")
   ```
4. Copy the full string (starts with `bearer eyJ...`)
5. In Obsidian, open **Settings → Plaud Sync** and paste it into the **Plaud token** field

The token is long-lived (~10 months) but will eventually expire. When it does, repeat these steps.

## Configuration

Open **Settings → Community plugins → Plaud Sync**:

| Setting | Default | Description |
|---------|---------|-------------|
| Plaud token | — | Your session token (stored securely, not in plugin settings; saved tokens are not displayed after saving) |
| API domain | `https://api.plaud.ai` | API endpoint; must be an HTTPS `plaud.ai` API host |
| Sync folder | `Plaud` | Vault folder where notes are created |
| Filename pattern | `plaud-{date}-{time}-{title}` | Pattern for new note filenames (`{date}`, `{time}`, and `{title}` are replaced) |
| Sync on startup | `true` | Automatically sync when Obsidian starts |
| Scheduled sync | `false` | Enable daily syncing while Obsidian is open and one catch-up after missed times |
| Daily sync times | `08:00, 17:00` | Daily times in the computer's local timezone; enter one or more comma-separated 24-hour times |
| Scheduled sync status | No scheduled sync yet | Shows the last scheduled result, attempt time, and successful completion time |
| Update existing notes | `true` | Overwrite notes that already exist (matched by `file_id`) |

## Usage

### Commands

Open the command palette (`Ctrl/Cmd+P`) and search for:

| Command | Description |
|---------|-------------|
| **Plaud: sync now** | Run an incremental sync immediately; shows a summary notice with created/updated/skipped/failed counts |
| **Plaud: validate token** | Test your token against the API and show your active recording count |

### How sync works

1. Fetches the full recording list from Plaud
2. Filters out trashed recordings
3. Selects candidates where `start_time > lastSyncAtMs`
4. For each candidate, fetches detail + content (transcript, AI summary)
5. Creates or updates the Markdown note in your sync folder
6. Advances the `lastSyncAtMs` checkpoint only after the full batch succeeds

Manual, startup, and scheduled syncs share one lock and cannot overlap. Manual attempts show a notice if another sync is running. A scheduled run waits for the lock without consuming its scheduled slot.

### Scheduled syncing

Enable **Scheduled sync** in the plugin settings. The default times are **8:00 AM and 5:00 PM**, using your computer's local timezone. Change **Daily sync times** to adjust the schedule, for example `09:30, 18:00`. Duplicate times are removed; invalid entries leave the saved schedule in place.

The schedule runs inside Obsidian and uses the same incremental sync, token storage, and note-update settings as manual sync. Obsidian must be open with the plugin enabled for a timer to run. If Obsidian was closed at one or more scheduled times, the plugin runs **one catch-up sync** when it next opens, even if **Sync on startup** is off. That catch-up also fulfills startup sync when startup syncing is enabled. Several missed times produce one batch because the incremental checkpoint covers earlier recordings.

Enabling scheduling or changing its times starts the new schedule from that moment; times before that change are not treated as missed. Failed scheduled attempts remain recorded and the next scheduled slot tries again. You can also use **Plaud: sync now** to retry immediately. Reloading the plugin does not repeat a slot that was already attempted.

The plugin clears its timer when unloaded and recalculates it after schedule changes. It checks the local clock at least once a minute to accommodate sleep, clock changes, and timezone changes. Times follow local calendar days across daylight-saving changes. A custom time inside a spring-forward gap shifts forward by the gap; a repeated autumn time runs once at its first occurrence.

### Scheduled status for monitoring

The plugin persists the following fields in `<vault>/.obsidian/plugins/plaud-sync/data.json`. Another process can read these fields to monitor scheduled results without accessing the Plaud credential or running a separate sync tool. All timestamps are Unix milliseconds; `0` means no recorded timestamp.

| Field | Meaning |
|-------|---------|
| `lastScheduledAttemptAtMs` | Actual start time of the last scheduled or catch-up attempt, saved before contacting Plaud |
| `lastSuccessfulScheduledSyncAtMs` | Completion time of the last scheduled batch with no failures, including a batch with no new recordings |
| `scheduledSyncStatus` | `never`, `running`, `success`, `no_new_recordings`, or `failed` |
| `scheduledSyncFailure` | `null` or a safe failure code: `auth`, `rate_limit`, `network`, `server`, `invalid_response`, `partial_failure`, `persistence`, `interrupted`, or `unknown` |
| `lastScheduledSlotAtMs` | Most recent scheduled slot claimed by an attempt; prevents repeated catch-up for the same slot |
| `scheduledSyncEnabledAtMs` | Start of the current schedule, used to exclude times before scheduling was enabled or changed |

`no_new_recordings` means the batch succeeded with zero incremental candidates. `success` means candidates were processed without failures, including notes skipped under **Update existing notes**. Any per-recording failure produces `failed` with `partial_failure` and leaves the last successful timestamp unchanged. Raw error messages, credentials, signed URLs, recording IDs, and recording content are not saved in the scheduled status. A previous session's unfinished `running` attempt is marked `failed` with `interrupted` on the next open. Manual and ordinary startup runs do not overwrite scheduled status.

Security guardrails:

- Plaud API tokens are sent only to HTTPS Plaud API hosts.
- Signed content URLs must use HTTPS and cannot target local/private hosts.
- Synced note content is sanitized to avoid frontmatter injection, raw HTML rendering, and remote image embeds from API-provided text.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| "Plaud token missing…" | Token not set or cleared | Re-paste token in settings, then run **Plaud: validate token** |
| "authentication failed…" | Expired or invalid token | Extract a fresh token from the web app |
| "rate limited by Plaud API…" | Too many requests | Wait a few minutes and retry; avoid rapid manual syncs |
| "network error…" | Connectivity / DNS / VPN issue | Check your connection and retry |
| "Plaud API is temporarily unavailable…" | Plaud servers down (5xx) | Retry later |
| "unexpected API response format…" | Plaud changed their API | Check for a plugin update; open an issue if none exists |
| "Unable to create Plaud sync folder…" | Invalid path or vault permissions | Use a simple folder name; check vault write access |

## Development

```bash
npm ci                # install dependencies
npm run dev           # watch mode with hot reload
npm run build         # typecheck + production build
npm run test          # run test suite (Node.js native test runner)
npm run lint          # eslint
```

### Project structure

```
src/
├── main.ts                 # Plugin lifecycle, command dispatch, error handling
├── commands.ts             # Command registration
├── settings.ts             # Settings UI tab
├── settings-schema.ts      # Settings interface and defaults
├── secret-store.ts         # Token storage (Obsidian secrets + fallback)
├── plaud-api.ts            # API client, error categorization
├── plaud-api-obsidian.ts   # Obsidian requestUrl transport adapter
├── plaud-normalizer.ts     # Payload normalization across API variants
├── plaud-renderer.ts       # Markdown rendering
├── plaud-content-hydrator.ts # Content inflation from signed URLs
├── plaud-vault.ts          # Vault note identity and upsert logic
├── plaud-sync.ts           # Incremental sync orchestration
├── plaud-retry.ts          # Retry/backoff with telemetry sanitization
├── sync-runtime.ts         # Shared manual/startup/scheduled sync guard
├── daily-schedule.ts       # Local next-run and catch-up calculations
├── scheduled-sync.ts       # Scheduled lifecycle, timers, and persistence
└── scheduled-sync-status.ts # Allowlisted status and failure codes
test/
└── *.test.mjs              # Matching test suite for each module
```

## Legal Basis

This is an **unofficial** community plugin, not affiliated with or endorsed by PLAUD, Inc.

### Interoperability under EU law

This project is developed and distributed under the interoperability provisions of **EU Directive 2009/24/EC** (the Software Directive):

- **Article 5(3)** permits users to observe, study, and test software to determine underlying ideas and principles
- **Article 6** permits decompilation and reverse engineering when necessary to achieve interoperability with independently created software
- **Article 9** renders contractual clauses restricting these rights null and void

The Court of Justice of the European Union has consistently upheld these protections, notably in *SAS Institute v. World Programming* (C-406/10) and *Top System v. Belgian State* (C-13/20).

### Interoperability intent

This plugin enables PLAUD users to connect their recording data with [Obsidian](https://obsidian.md/), an independently created knowledge management application. PLAUD already supports third-party automation through their official Zapier integration, demonstrating acceptance of interoperability use cases. This project extends similar functionality to the Obsidian ecosystem.

### Disclaimer

This software is provided as-is for interoperability purposes. Users are responsible for compliance with PLAUD's Terms of Service and applicable laws in their jurisdiction. The maintainers make no warranty regarding account standing or service availability.

## Contributing

Contributions are welcome. Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[MIT](LICENSE) — Leonard Sellem
