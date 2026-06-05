import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import process from 'node:process';
import {pathToFileURL} from 'node:url';

const root = process.cwd();
const moduleUrl = pathToFileURL(path.join(root, 'src/plaud-renderer.ts')).href;
const {renderPlaudMarkdown} = await import(moduleUrl);

const sampleDetail = {
  id: 'abc',
  fileId: 'f_abc',
  title: 'Weekly sync',
  startAtMs: 1730678400000,
  durationMs: 1800000,
  summary: 'Summary text',
  highlights: ['Highlight one', 'Highlight two'],
  transcript: 'Speaker A: Hello',
  raw: {}
};

test('renders frontmatter contract fields', () => {
  const markdown = renderPlaudMarkdown(sampleDetail);

  assert.match(markdown, /^---/m);
  assert.match(markdown, /^source: plaud$/m);
  assert.match(markdown, /^type: recording$/m);
  assert.match(markdown, /^file_id: "f_abc"$/m);
  assert.match(markdown, /^title: "Weekly sync"$/m);
  assert.match(markdown, /^date: 2024-11-04$/m);
  assert.match(markdown, /^duration: 30 min$/m);
});

test('renders required body sections in order', () => {
  const markdown = renderPlaudMarkdown(sampleDetail);

  const summaryIndex = markdown.indexOf('## Summary');
  const highlightsIndex = markdown.indexOf('## Highlights');
  const transcriptIndex = markdown.indexOf('## Transcript');

  assert.ok(summaryIndex > 0);
  assert.ok(highlightsIndex > summaryIndex);
  assert.ok(transcriptIndex > highlightsIndex);

  assert.match(markdown, /Summary text/);
  assert.match(markdown, /- Highlight one/);
  assert.match(markdown, /\[Speaker A\]\nHello/);
});

test('rendering is deterministic for identical input', () => {
  const first = renderPlaudMarkdown(sampleDetail);
  const second = renderPlaudMarkdown(sampleDetail);

  assert.equal(first, second);
});

test('gracefully renders placeholders for missing optional fields', () => {
  const markdown = renderPlaudMarkdown({
    id: 'x',
    fileId: 'x',
    title: '',
    startAtMs: 0,
    durationMs: 0,
    summary: '',
    highlights: [],
    transcript: '',
    raw: {}
  });

  assert.match(markdown, /# Untitled recording/);
  assert.match(markdown, /No summary available\./);
  assert.match(markdown, /- No highlights extracted\./);
  assert.match(markdown, /No transcript available\./);
});

test('escapes quotes in title frontmatter while preserving heading text', () => {
  const markdown = renderPlaudMarkdown({
    ...sampleDetail,
    title: 'Exec "Q4" Sync'
  });

  assert.match(markdown, /^title: "Exec \\"Q4\\" Sync"$/m);
  assert.match(markdown, /^# Exec "Q4" Sync$/m);
});

test('quotes frontmatter and neutralizes risky markdown from Plaud content', () => {
  const markdown = renderPlaudMarkdown({
    ...sampleDetail,
    fileId: 'f_bad"\nmalicious: true',
    title: 'Title <script>alert(1)</script>',
    summary: '<img src=x onerror=alert(1)> ![track](https://example.com/pixel)',
    highlights: ['First line\n![track](https://example.com/pixel)'],
    transcript: 'Speaker: <iframe src="https://example.com"></iframe>'
  });

  assert.match(markdown, /^file_id: "f_bad\\"\\nmalicious: true"$/m);
  assert.doesNotMatch(markdown, /^malicious: true$/m);
  assert.match(markdown, /&lt;img src=x onerror=alert\(1\)> \\!\[track\]/);
  assert.match(markdown, /- First line \\!\[track\]/);
  assert.match(markdown, /&lt;iframe src="https:\/\/example\.com">&lt;\/iframe>/);
});

test('preserves markdown blockquotes instead of escaping greater-than markers', () => {
  const markdown = renderPlaudMarkdown({
    ...sampleDetail,
    summary: '&gt; Key finding\n&gt; Supporting detail'
  });

  assert.match(markdown, /\n> Key finding\n> Supporting detail\n/);
  assert.doesNotMatch(markdown, /&gt; Key finding/);
});

test('escapes raw HTML tags while keeping normal markdown markers usable', () => {
  const markdown = renderPlaudMarkdown({
    ...sampleDetail,
    summary: '## Findings <script>alert(1)</script> > Plaud quote - Useful bullet'
  });

  assert.match(markdown, /## Findings &lt;script>alert\(1\)&lt;\/script>/);
  assert.match(markdown, /\n> Plaud quote/);
  assert.doesNotMatch(markdown, /<script>alert/);
});

test('reflows collapsed Plaud summary text into headings and list items', () => {
  const markdown = renderPlaudMarkdown({
    ...sampleDetail,
    summary: 'Overview ## Decisions - First item - [ ] Follow up 1. Numbered item > Important quote'
  });

  assert.match(markdown, /Overview\n\n## Decisions\n- First item\n- \[ \] Follow up\n1\. Numbered item\n> Important quote/);
});

test('repairs common Plaud mojibake in rendered content', () => {
  const markdown = renderPlaudMarkdown({
    ...sampleDetail,
    summary: '\u00e2\u20ac\u2122 \u00e2\u20ac\u0153 \u00e2\u20ac\u009d \u00e2\u20ac\u201d \u00e2\u20ac\u201c \u00f0\u0178\u2122\u201a'
  });

  assert.match(markdown, /' " " -- - :\)/);
});

test('splits Plaud heading lines from following colon-labeled bullets', () => {
  const markdown = renderPlaudMarkdown({
    ...sampleDetail,
    summary: '## Target-Specific Deal Signals - ICR (PR/IR): Nikhil passed on a potential acquisition, fearing basic PR is easily AI-automated and clients will force price cuts. - Cybersecurity & CMMC (Summit Seven, GuidePoint, Coalfire): Working hypothesis: Premium attestation buyers do not buy strictly on price. - Registered Agent Services (Cogency): Viewed favorably.'
  });

  assert.match(markdown, /## Target-Specific Deal Signals\n- ICR \(PR\/IR\): Nikhil passed/);
  assert.match(markdown, /\n- Cybersecurity & CMMC \(Summit Seven, GuidePoint, Coalfire\): Working hypothesis:/);
  assert.match(markdown, /\n- Registered Agent Services \(Cogency\): Viewed favorably\./);
  assert.doesNotMatch(markdown, /## Target-Specific Deal Signals - ICR/);
  assert.doesNotMatch(markdown, /\n- automated and clients/);
});

test('preserves bold label bullets from collapsed analytical readouts', () => {
  const markdown = renderPlaudMarkdown({
    ...sampleDetail,
    summary: '## AI Workflow & Slide Blanking Vulnerabilities - **Baseline fact:** James has been passing raw markdown files to the team. - **Validated finding:** Junior team members lack the instinct to override the MD files. - Without Nathan acting as a translation layer, there is a significant risk of yield loss.'
  });

  assert.match(markdown, /## AI Workflow & Slide Blanking Vulnerabilities\n- \*\*Baseline fact:\*\* James has been passing/);
  assert.match(markdown, /\n- \*\*Validated finding:\*\* Junior team members lack/);
  assert.match(markdown, /\n- Without Nathan acting as a translation layer/);
});

test('keeps Plaud todo owner and timing metadata inline on checkbox items', () => {
  const markdown = renderPlaudMarkdown({
    ...sampleDetail,
    summary: '## Next Steps / To-Dos - [ ] Talk to Nathan to gauge his sentiment and reasons for declining the full-time offer - James - June 5, 2026 - [ ] Schedule 3-way alignment meeting with Fredy and Bjorn regarding Foundry - James - June 8, 2026 - [ ] Ping Stu to determine his current level of involvement/perspective on Foundry - Fredy - Timing unclear'
  });

  assert.match(markdown, /## Next Steps \/ To-Dos\n- \[ \] Talk to Nathan to gauge his sentiment and reasons for declining the full-time offer - James - June 5, 2026/);
  assert.match(markdown, /\n- \[ \] Schedule 3-way alignment meeting with Fredy and Bjorn regarding Foundry - James - June 8, 2026/);
  assert.match(markdown, /\n- \[ \] Ping Stu to determine his current level of involvement\/perspective on Foundry - Fredy - Timing unclear/);
  assert.doesNotMatch(markdown, /\n- James\n/);
  assert.doesNotMatch(markdown, /\n- Timing unclear\n/);
});

test('splits memorable quote bullets before quoted text and keeps attribution inline', () => {
  const markdown = renderPlaudMarkdown({
    ...sampleDetail,
    summary: `## Memorable Quotes - "I feel like I am totally in the dark right now. Like I said, part of that's on me." - James - "Pretty quickly your environment gets quite busy and contaminated... it's getting harder and harder to audit as my environment gets more complex." - Fredy - "Before large language models, I could get the answer to like forty or fifty or sixty percent of my own... But now I think with these things, I can get the answer to like eighty percent. I still need a lot of help with the visualization and like the polishing." - James`
  });

  assert.match(markdown, /## Memorable Quotes\n- "I feel like I am totally in the dark right now\. Like I said, part of that's on me\." - James/);
  assert.match(markdown, /\n- "Pretty quickly your environment gets quite busy and contaminated\.\.\. it's getting harder and harder to audit as my environment gets more complex\." - Fredy/);
  assert.match(markdown, /\n- "Before large language models, I could get the answer to like forty or fifty or sixty percent of my own\.\.\. But now I think with these things, I can get the answer to like eighty percent\. I still need a lot of help with the visualization and like the polishing\." - James/);
  assert.doesNotMatch(markdown, /## Memorable Quotes - "I feel/);
  assert.doesNotMatch(markdown, /\n- James\n/);
  assert.doesNotMatch(markdown, /\n- Fredy\n/);
});

test('keeps multi-word memorable quote attributions inline', () => {
  const markdown = renderPlaudMarkdown({
    ...sampleDetail,
    summary: '## Memorable Quotes - "I do think there is a sequencing here, right? In terms of letting the presidents know that we are going to tap their people... and allow them to socialize any thoughts that they have on it." - Cory Thompson - "I am asking for you to poke... whether you like it or not, to poke both of us, James. To say, hey, are you guys on track? Are you doing the things that were recommended in order to be successful?" - Cory Thompson'
  });

  assert.match(markdown, /## Memorable Quotes\n- "I do think there is a sequencing here, right\? In terms of letting the presidents know that we are going to tap their people\.\.\. and allow them to socialize any thoughts that they have on it\." - Cory Thompson/);
  assert.match(markdown, /\n- "I am asking for you to poke\.\.\. whether you like it or not, to poke both of us, James\. To say, hey, are you guys on track\? Are you doing the things that were recommended in order to be successful\?" - Cory Thompson/);
  assert.doesNotMatch(markdown, /\n- Cory Thompson\n/);
});

test('does not split parenthetical years or terminal counts as numbered lists', () => {
  const markdown = renderPlaudMarkdown({
    ...sampleDetail,
    summary: '## Executive Summary - **Stout Strategy Transition:** Nathan is officially departing today (June 5, 2026) after declining a full-time offer. ## Team Execution: Strategy vs. Diligence Mindset - Close client touchpoints are critical. Left unchecked, the team will build 50 slides when the client only needs 10. - Meeting hygiene requires enforcement.'
  });

  assert.match(markdown, /\(June 5, 2026\) after declining a full-time offer\./);
  assert.match(markdown, /client only needs 10\.\n- Meeting hygiene requires enforcement\./);
  assert.doesNotMatch(markdown, /\n2026\) after/);
  assert.doesNotMatch(markdown, /\n10\.\n/);
});

test('keeps trailing decision owners inline instead of creating person-only bullets', () => {
  const markdown = renderPlaudMarkdown({
    ...sampleDetail,
    summary: '## Decisions Made - Schedule a three-way sync on Monday (June 8, 2026) to force alignment on Foundry current state and team structure. - Fredy & James - Exchange experimental AI tools to test integration across the distinct workflow layers. - Fredy & James'
  });

  assert.match(markdown, /- Schedule a three-way sync on Monday \(June 8, 2026\) to force alignment on Foundry current state and team structure\./);
  assert.match(markdown, /\n- Fredy & James - Exchange experimental AI tools to test integration across the distinct workflow layers\. - Fredy & James/);
  assert.doesNotMatch(markdown, /\n2026\) to force/);
  assert.doesNotMatch(markdown, /\n- Fredy & James\n/);
});

test('keeps todo dates with parenthetical years inline', () => {
  const markdown = renderPlaudMarkdown({
    ...sampleDetail,
    summary: "## Next Steps / To-Dos - [ ] Schedule a follow-up discussion specifically on Summit Seven's growth modeling - Stu / Nikhil - Near-term (asset coming to market in 2026)"
  });

  assert.match(markdown, /- \[ \] Schedule a follow-up discussion specifically on Summit Seven's growth modeling - Stu \/ Nikhil - Near-term \(asset coming to market in 2026\)/);
  assert.doesNotMatch(markdown, /\n2026\)/);
});

test('renders transcript speaker turns in block format', () => {
  const markdown = renderPlaudMarkdown({
    ...sampleDetail,
    transcript: 'Speaker A: Hello there\nSpeaker B: Thanks for the update'
  });

  assert.match(markdown, /\[Speaker A\]\nHello there\n\n\[Speaker B\]\nThanks for the update/);
  assert.doesNotMatch(markdown, /^Speaker A: Hello there$/m);
});

test('splits long transcript turns into readable paragraphs', () => {
  const longTurn = [
    'This opening sentence establishes context for the discussion and gives the renderer enough room to work.',
    'The next sentence adds more detail about customer requirements, implementation timing, and follow-up work.',
    'A third sentence continues the same speaker turn so that a single dense line would be hard to review.',
    'The fourth sentence adds another idea that should stay readable for people scanning the note later.',
    'A fifth sentence makes the total turn long enough that sentence-aware paragraph splitting should occur.',
    'The final sentence closes the thought and confirms the formatter can keep the original speaker label.'
  ].join(' ');

  const markdown = renderPlaudMarkdown({
    ...sampleDetail,
    transcript: `Speaker A: ${longTurn}`
  });

  const transcript = markdown.slice(markdown.indexOf('## Transcript'));
  assert.match(transcript, /\[Speaker A\]\nThis opening sentence/);
  assert.match(transcript, /occur\.\n\nThe final sentence closes/);
});
