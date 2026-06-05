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
  assert.match(markdown, /Speaker A: Hello/);
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
  assert.match(markdown, /&lt;img src=x onerror=alert\(1\)&gt; \\!\[track\]/);
  assert.match(markdown, /- First line \\!\[track\]/);
  assert.match(markdown, /&lt;iframe src="https:\/\/example\.com"&gt;&lt;\/iframe&gt;/);
});
