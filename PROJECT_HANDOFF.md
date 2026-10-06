# Project Handoff: Plaud Sync for Obsidian

Last updated: 2026-06-18

## Purpose

This repo is James Baird's fork of the Obsidian Plaud Sync plugin. The current project focused on making Plaud imports usable in Obsidian for human reading and LLM review, especially summaries and transcripts.

The main implementation work is in `src/plaud-renderer.ts`. The regression coverage is in `test/plaud-renderer.test.mjs`.

## Source Basis

- Baseline fact: The plugin renders normalized Plaud recording details into Markdown notes through `renderPlaudMarkdown` in `src/plaud-renderer.ts`.
- Baseline fact: Obsidian loads the compiled `main.js`, not the TypeScript source directly.
- Historical input: The desired behavior came from James's screenshots comparing Obsidian imports against Plaud web rendering.
- Validated finding: Plaud summaries often arrive as collapsed "markdown-ish" text where section headings, bullets, checkbox rows, quote lists, and owner/date metadata are flattened into one paragraph.
- Validated finding: The earlier renderer over-sanitized Markdown by escaping `>` to `&gt;`, which broke Plaud blockquotes.
- Validated finding: The earlier renderer under-modeled Plaud's collapsed summary conventions, causing headings to swallow first bullets, quote attributions to become separate bullets, and years/counts to be mistaken for numbered lists.

## Current Git State

Recent relevant commit:

```text
c304fc4 Improve Plaud markdown rendering
```

That commit contains the renderer and test changes described below. At the time this handoff was written, the repo worktree was clean before adding this file.

## What Changed

### Summary Rendering

The renderer now runs Plaud summary text through a safer formatting pipeline:

1. Normalize line endings.
2. Repair common mojibake.
3. Decode Markdown-safe entities such as `&gt;` back to `>`.
4. Escape raw `<` so Plaud content cannot render raw HTML.
5. Neutralize remote image embeds by escaping `![`.
6. Reflow collapsed Plaud summary text into headings, bullets, numbered items, blockquotes, and task rows.

The intent is not to implement a full Markdown parser. It is a constrained Plaud-summary repair pass that preserves useful Markdown while preventing raw HTML injection.

### Safety Behavior

The renderer intentionally preserves normal Markdown syntax:

- Headings
- Bullets
- Numbered lists
- Checkboxes
- Blockquotes
- Bold labels

It still blocks risky content:

- Raw `<tag>` text is converted to `&lt;tag>`.
- Image embeds like `![tracking pixel](...)` are escaped as `\![...]`.
- Frontmatter strings are JSON-quoted to avoid injection.

### Mojibake Repair

The renderer repairs common Plaud encoding artifacts. In source, these are represented with escaped Unicode forms rather than pasted literally:

```text
\u00e2\u20ac\u2122 -> '
\u00e2\u20ac\u0153 -> "
\u00e2\u20ac\u009d -> "
\u00e2\u20ac\u201d -> --
\u00e2\u20ac\u201c -> -
\u00f0\u0178\u2122\u201a -> :)
```

### Collapsed Heading and Bullet Repair

Plaud web often renders a clean section such as:

```text
Target-Specific Deal Signals
- ICR (PR/IR): ...
- Cybersecurity & CMMC: ...
```

But the imported text may arrive collapsed as:

```text
## Target-Specific Deal Signals - ICR (PR/IR): ... - Cybersecurity & CMMC: ...
```

The renderer now separates the heading from the first bullet and recognizes later bullets when they look like real Plaud list items.

Important heuristics:

- A dash after a heading can start the first plain bullet.
- Colon-labeled bullets split cleanly, e.g. `- ICR (PR/IR): ...`.
- Bold label bullets split cleanly, e.g. `- **Baseline fact:** ...`.
- Plain bullets can split after a complete sentence.
- Inline dashes in text, such as `AI-automated`, are not touched.

### Checkbox and Todo Repair

Plaud todos often include task metadata inline:

```text
- [ ] Talk to Nathan ... - James - June 5, 2026
```

Earlier reflow logic split `James`, dates, or timing notes into bogus child bullets. The current renderer keeps owner and timing metadata inline on the checkbox row.

Examples now preserved inline:

```text
- [ ] ... - James - June 5, 2026
- [ ] ... - Stu / Nikhil - Near-term (asset coming to market in 2026)
```

### Quote List Repair

Plaud memorable quote sections were a recurring edge case. The imported text could arrive as:

```text
## Memorable Quotes - "Quote one." - James - "Quote two." - Fredy
```

The renderer now outputs:

```text
## Memorable Quotes
- "Quote one." - James
- "Quote two." - Fredy
```

It recognizes quoted bullets and keeps speaker attribution inline, including multi-word names such as `Cory Thompson`.

### Numbered List Guardrails

Earlier logic treated any `number.` or `number)` pattern as a numbered list item. That created bad line breaks in examples such as:

```text
(June 5, 2026) after...
client only needs 10.
```

The renderer now splits numbered items only when the text after the number looks like a real list item. It avoids splitting parenthetical years, dates, and terminal counts.

### Transcript Rendering

Transcripts now render in compact speaker blocks:

```text
[Speaker A]
Utterance text...

[Speaker B]
Utterance text...
```

Earlier in the project, the requested format had a blank line between speaker and utterance. James later refined the preference: no blank line between speaker and utterance, but a blank line between turns.

Long speaker turns are split into readable paragraphs using sentence boundaries where practical. Speaker names are preserved as provided by Plaud. The renderer does not infer interviewer/interviewee roles.

## Key Files

### `src/plaud-renderer.ts`

Primary renderer. Key helper groups:

- Date, duration, title, and frontmatter formatting.
- Content sanitation and safe entity decoding.
- Mojibake repair.
- Summary reflow:
  - `splitCollapsedDashBullets`
  - `splitCollapsedNumberedItems`
  - `splitCollapsedSummaryLine`
  - `reflowCollapsedSummary`
- Transcript formatting:
  - `parseTranscriptTurns`
  - `splitIntoReadableParagraphs`
  - `formatTranscript`

### `test/plaud-renderer.test.mjs`

Renderer regression tests. Coverage now includes:

- Frontmatter contract.
- Section ordering.
- Empty summary and transcript fallbacks.
- Raw HTML escaping.
- Image embed neutralization.
- Blockquote preservation.
- Collapsed heading/list reflow.
- Mojibake repair.
- Bold label bullets.
- Todo owner/date metadata.
- Memorable quote attribution.
- Parenthetical years and terminal counts.
- Transcript speaker block format.
- Long transcript paragraph splitting.

## Verification History

These commands were used repeatedly during the project:

```powershell
node --experimental-strip-types --test --test-isolation=none test\plaud-renderer.test.mjs
node_modules\.bin\tsc.cmd -noEmit -skipLibCheck
$env:NODE_OPTIONS='--test-isolation=none'; npm.cmd test
```

Most recent successful full test result observed in this thread:

```text
79/79 tests passed
```

TypeScript also passed.

## Build Caveat

`npm.cmd run build` did not complete inside the Codex sandbox. TypeScript passed, but esbuild failed when it tried to spawn its service process:

```text
Error: spawn EPERM
```

This appears to be a sandbox restriction, not a TypeScript or renderer failure. Run the build from a normal local PowerShell session before installing into Obsidian:

```powershell
cd "C:\Users\jbaird\sandbox\plaud-sync-for-obsidian-clean"
npm.cmd run build
```

That should regenerate `main.js`, which Obsidian actually loads.

## Obsidian Install Path

James's vault path:

```text
C:\Users\jbaird\OneDrive - STOUT\Documents\Work\04_Obsidian\obsidian_main
```

Plugin ID from `manifest.json`:

```text
plaud-sync
```

Install target:

```text
C:\Users\jbaird\OneDrive - STOUT\Documents\Work\04_Obsidian\obsidian_main\.obsidian\plugins\plaud-sync
```

Manual install commands:

```powershell
cd "C:\Users\jbaird\sandbox\plaud-sync-for-obsidian-clean"

npm.cmd install
npm.cmd run build

$vault = "C:\Users\jbaird\OneDrive - STOUT\Documents\Work\04_Obsidian\obsidian_main"
$plugin = Join-Path $vault ".obsidian\plugins\plaud-sync"

New-Item -ItemType Directory -Force -Path $plugin | Out-Null
Copy-Item ".\main.js", ".\manifest.json", ".\styles.css" -Destination $plugin -Force
```

Then in Obsidian:

1. Open the vault.
2. Go to **Settings -> Community plugins**.
3. Enable **Plaud Sync**.
4. If it was already enabled, disable and re-enable it, or reload Obsidian.

## Known Limitations

### Renderer Is Heuristic

The summary reflow logic is intentionally heuristic. Plaud does not appear to provide a stable, structured summary AST through this sync path. The renderer repairs common collapsed Markdown patterns observed in actual imports.

Future bugs will likely appear as new collapsed-text shapes. The right workflow is:

1. Capture the bad Obsidian rendering and Plaud web equivalent.
2. Reduce it to a minimal collapsed summary fixture.
3. Add a failing test in `test/plaud-renderer.test.mjs`.
4. Adjust helper logic in `src/plaud-renderer.ts`.
5. Run focused renderer tests, TypeScript, and full tests.

### Main Bundle Not Auto-Updated in Sandbox

Because esbuild could not run in the Codex sandbox, source changes were validated through TypeScript and tests, but `main.js` must be rebuilt outside the sandbox before Obsidian can use the latest behavior.

### README Encoding Artifacts

The current `README.md` contains visible encoding artifacts in punctuation and arrow characters. This was observed while preparing the handoff. It was not part of the renderer project and was not changed.

## Suggested Next Steps

1. Run `npm.cmd run build` outside the sandbox.
2. Copy `main.js`, `manifest.json`, and `styles.css` into the Obsidian plugin folder.
3. Re-import or resync a few Plaud notes that previously showed bad rendering.
4. If any new formatting bug appears, add it as another renderer regression test before changing the parser.
5. Consider a small README update after validation to describe improved Markdown rendering and transcript formatting.

## Quick Return Commands

```powershell
cd "C:\Users\jbaird\sandbox\plaud-sync-for-obsidian-clean"

git status --short
git log --oneline -5

node --experimental-strip-types --test --test-isolation=none test\plaud-renderer.test.mjs
node_modules\.bin\tsc.cmd -noEmit -skipLibCheck
$env:NODE_OPTIONS='--test-isolation=none'; npm.cmd test
```

## Mental Model for Future Work

Treat Plaud summary rendering as a recovery problem, not a styling problem.

Plaud web has structure. The sync payload often has text that only hints at that structure. The renderer's job is to recover the most useful Markdown structure while preserving safety:

- Let Markdown be Markdown where it helps: headings, bullets, checkboxes, blockquotes, bold labels.
- Prevent raw HTML and remote image embeds from rendering.
- Do not invent semantics not present in Plaud data.
- Preserve speaker names, owner names, dates, and quote attributions inline when they are metadata for a list item.
- Prefer regression tests based on real Plaud/Obsidian pairs over broad regex rewrites.

