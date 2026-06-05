import type {NormalizedPlaudDetail} from './plaud-normalizer';

function formatDate(timestampMs: number): string {
	if (!Number.isFinite(timestampMs) || timestampMs <= 0) {
		return '1970-01-01';
	}
	return new Date(timestampMs).toISOString().slice(0, 10);
}

function formatDuration(durationMs: number): string {
	if (!Number.isFinite(durationMs) || durationMs <= 0) {
		return '0 min';
	}
	return `${Math.round(durationMs / 60000)} min`;
}

function normalizeTitle(title: string): string {
	const trimmed = title.trim();
	return trimmed.length > 0 ? trimmed : 'Untitled recording';
}

function normalizeLineEndings(value: string): string {
	return value.replace(/\r\n?/g, '\n');
}

function formatFrontmatterString(value: string): string {
	return JSON.stringify(normalizeLineEndings(value));
}

const MOJIBAKE_REPLACEMENTS: Array<[RegExp, string]> = [
	[/\u00e2\u20ac\u2122/g, "'"],
	[/\u00e2\u20ac\u0153/g, '"'],
	[/\u00e2\u20ac\u009d/g, '"'],
	[/\u00e2\u20ac\u201d/g, '--'],
	[/\u00e2\u20ac\u201c/g, '-'],
	[/\u00f0\u0178\u2122\u201a/g, ':)']
];

function repairCommonMojibake(value: string): string {
	let repaired = value;
	for (const [pattern, replacement] of MOJIBAKE_REPLACEMENTS) {
		repaired = repaired.replace(pattern, replacement);
	}
	return repaired;
}

function decodeMarkdownEntities(value: string): string {
	return value
		.replace(/&amp;gt;/gi, '>')
		.replace(/&gt;/gi, '>')
		.replace(/&#62;/g, '>')
		.replace(/&quot;/gi, '"')
		.replace(/&#39;/g, "'");
}

function sanitizeMarkdownContent(value: string): string {
	return decodeMarkdownEntities(repairCommonMojibake(normalizeLineEndings(value)))
		.replace(/</g, '&lt;')
		.replace(/!\[/g, '\\![');
}

const MAX_LIST_LABEL_CHARS = 120;

function isMarkdownListMarker(value: string): boolean {
	return /^([-*+]\s+(?=[A-Za-z0-9*"])|- \[[ xX]\]\s+|\d+[.)]\s+)/.test(value);
}

function startsTaskCheckbox(value: string): boolean {
	return /^\[[ xX]\]\s+/.test(value.trimStart());
}

function startsLabelLikeBullet(value: string): boolean {
	const trimmed = value.trimStart();
	if (startsTaskCheckbox(trimmed)) {
		return true;
	}

	const boldLabel = /^\*\*[^*\n]{1,120}:\*\*/.exec(trimmed);
	if (boldLabel) {
		return true;
	}

	const colonIndex = trimmed.indexOf(':');
	if (colonIndex <= 0 || colonIndex > MAX_LIST_LABEL_CHARS) {
		return false;
	}

	const label = trimmed.slice(0, colonIndex);
	return /^[A-Z0-9"*]/.test(label) && !/[.!?]/.test(label);
}

function previousTextAllowsPlainBullet(value: string): boolean {
	return /[.!?)]["')\]]*$/.test(value.trimEnd());
}

function startsQuotedBullet(value: string): boolean {
	return /^(?:[-*+]\s+)?["\u201c]/.test(value.trimStart());
}

function hasCompletedQuotedBullet(value: string): boolean {
	return /^(?:[-*+]\s+)?["\u201c].+["\u201d]\s+-\s+\S/.test(value.trim());
}

function looksLikePersonOnlyAttribution(value: string): boolean {
	const trimmed = value.trim();
	if (!/^[A-Z][A-Za-z'’.-]*(?:\s+(?:&\s+)?[A-Z][A-Za-z'’.-]*){0,3}$/.test(trimmed)) {
		return false;
	}

	return !/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|January|February|March|April|May|June|July|August|September|October|November|December)$/i.test(trimmed);
}

function shouldSplitDashBullet(beforeDash: string, afterDash: string, allowPlainAfterHeading: boolean): boolean {
	if (startsTaskCheckbox(afterDash) || startsLabelLikeBullet(afterDash)) {
		return true;
	}

	if (startsQuotedBullet(afterDash)) {
		return allowPlainAfterHeading || hasCompletedQuotedBullet(beforeDash) || previousTextAllowsPlainBullet(beforeDash);
	}

	if (startsQuotedBullet(beforeDash)) {
		return false;
	}

	if (looksLikePersonOnlyAttribution(afterDash)) {
		return false;
	}

	const startsLikePlainBullet = /^[A-Z0-9]/.test(afterDash.trimStart());
	return startsLikePlainBullet && (allowPlainAfterHeading || previousTextAllowsPlainBullet(beforeDash));
}

function splitCollapsedDashBullets(line: string, allowPlainAfterHeading = false): string[] {
	const parts: string[] = [];
	let cursor = 0;
	let index = 0;
	const isTaskLine = /^-\s+\[[ xX]\]\s+/.test(line);

	while (index < line.length) {
		const dashIndex = line.indexOf(' - ', index);
		if (dashIndex === -1) {
			break;
		}

		const beforeDash = line.slice(cursor, dashIndex).trim();
		const afterDash = line.slice(dashIndex + 3);

		if (!isTaskLine && shouldSplitDashBullet(beforeDash, afterDash, allowPlainAfterHeading && parts.length === 0)) {
			const part = line.slice(cursor, dashIndex).trim();
			if (part) {
				parts.push(part);
			}
			cursor = dashIndex + 1;
		}

		index = dashIndex + 3;
	}

	const finalPart = line.slice(cursor).trim();
	if (finalPart) {
		parts.push(finalPart);
	}

	return parts.length > 0 ? parts : [line.trim()];
}

function shouldSplitNumberedItem(beforeNumber: string, numberText: string, afterNumber: string): boolean {
	const number = Number.parseInt(numberText, 10);
	if (!Number.isFinite(number) || number <= 0 || number > 99) {
		return false;
	}

	const after = afterNumber.trimStart();
	if (!/^[A-Z"*]/.test(after)) {
		return false;
	}

	const before = beforeNumber.trimEnd();
	if (/\b(?:Jan|Feb|Mar|Apr|May|Jun|June|Jul|July|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?$/i.test(before)) {
		return false;
	}

	return /^[-*+]\s+/.test(before) || /[.!?:)]["')\]]*$/.test(before);
}

function splitCollapsedNumberedItems(line: string): string[] {
	const parts: string[] = [];
	let cursor = 0;
	const numberedItemPattern = /\s+(\d{1,4}[.)])\s+/g;
	let match: RegExpExecArray | null;

	while ((match = numberedItemPattern.exec(line)) !== null) {
		const numberText = match[1] ?? '';
		const numberStart = match.index + match[0].indexOf(numberText);
		const beforeNumber = line.slice(cursor, numberStart).trim();
		const afterNumber = line.slice(numberStart + numberText.length + 1);

		if (shouldSplitNumberedItem(beforeNumber, numberText, afterNumber)) {
			const part = line.slice(cursor, match.index).trim();
			if (part) {
				parts.push(part);
			}
			cursor = numberStart;
		}
	}

	const finalPart = line.slice(cursor).trim();
	if (finalPart) {
		parts.push(finalPart);
	}

	return parts.length > 0 ? parts : [line.trim()];
}

function expandCollapsedNumberedItems(parts: string[]): string[] {
	const expanded: string[] = [];
	for (const part of parts) {
		expanded.push(...splitCollapsedNumberedItems(part));
	}
	return expanded;
}

function splitCollapsedSummaryLine(line: string): string[] {
	const headingMatch = /^(#{2,6}\s+)(.+)$/.exec(line);
	if (!headingMatch) {
		return expandCollapsedNumberedItems(splitCollapsedDashBullets(line));
	}

	const headingPrefix = headingMatch[1] ?? '';
	const headingText = headingMatch[2] ?? '';
	const parts = splitCollapsedDashBullets(headingText, true);
	if (parts.length <= 1) {
		return [line];
	}

	const heading = `${headingPrefix}${parts[0] ?? ''}`.trim();
	return [heading, ...expandCollapsedNumberedItems(parts.slice(1))];
}

function reflowCollapsedSummary(value: string): string {
	const roughLines = value
		.replace(/[ \t]+/g, ' ')
		.replace(/([^\n])\s+(#{2,6}\s+)/g, '$1\n\n$2')
		.replace(/([^\n])\s+(>\s+)/g, '$1\n$2')
		.replace(/([^\n])\s+(- \[[ xX]\]\s+)/g, '$1\n$2')
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0);

	const lines: string[] = [];
	for (const line of roughLines) {
		lines.push(...splitCollapsedSummaryLine(line));
	}
	const spaced: string[] = [];

	for (let index = 0; index < lines.length; index++) {
		const line = lines[index] ?? '';
		const previous = spaced[spaced.length - 1] ?? '';
		const isHeading = /^#{2,6}\s/.test(line);
		if (isHeading && previous !== '') {
			spaced.push('');
		}

		spaced.push(line);

		if (isHeading) {
			const next = lines[index + 1] ?? '';
			if (next && !isMarkdownListMarker(next) && !next.startsWith('>')) {
				spaced.push('');
			}
		}
	}

	return spaced.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function formatSummary(value: string): string {
	const sanitized = sanitizeMarkdownContent(value.trim());
	return sanitized ? reflowCollapsedSummary(sanitized) : 'No summary available.';
}

function sanitizeHighlight(value: string): string {
	return sanitizeMarkdownContent(value)
		.replace(/\s*\n+\s*/g, ' ')
		.trim();
}

function renderHighlights(highlights: string[]): string {
	if (highlights.length === 0) {
		return '- No highlights extracted.';
	}

	return highlights.map((highlight) => `- ${sanitizeHighlight(highlight) || 'Untitled highlight'}`).join('\n');
}

interface TranscriptTurn {
	speaker: string;
	text: string;
}

const MAX_TRANSCRIPT_PARAGRAPH_CHARS = 520;

function parseTranscriptTurns(value: string): TranscriptTurn[] {
	const turns: TranscriptTurn[] = [];
	let current: {speaker: string; lines: string[]} | null = null;

	for (const line of value.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed) {
			continue;
		}

		const match = /^(.{1,120}?):\s+(.+)$/.exec(trimmed);
		if (match) {
			const speaker = match[1] ?? '';
			const text = match[2] ?? '';
			if (current) {
				turns.push({
					speaker: current.speaker,
					text: current.lines.join(' ').trim()
				});
			}

			current = {
				speaker,
				lines: [text]
			};
			continue;
		}

		if (current) {
			current.lines.push(trimmed);
		}
	}

	if (current) {
		turns.push({
			speaker: current.speaker,
			text: current.lines.join(' ').trim()
		});
	}

	return turns;
}

function splitLongSentence(value: string): string[] {
	const words = value.split(/\s+/).filter((word) => word.length > 0);
	const paragraphs: string[] = [];
	let current = '';

	for (const word of words) {
		const next = current ? `${current} ${word}` : word;
		if (next.length > MAX_TRANSCRIPT_PARAGRAPH_CHARS && current) {
			paragraphs.push(current);
			current = word;
		} else {
			current = next;
		}
	}

	if (current) {
		paragraphs.push(current);
	}

	return paragraphs;
}

function splitIntoReadableParagraphs(value: string): string[] {
	const text = value.replace(/\s+/g, ' ').trim();
	if (text.length <= MAX_TRANSCRIPT_PARAGRAPH_CHARS) {
		return text ? [text] : [];
	}

	const sentences = text.match(/[^.!?]+[.!?]+(?:["')\]]+)?(?=\s|$)|[^.!?]+$/g) ?? [text];
	const paragraphs: string[] = [];
	let current = '';

	for (const sentence of sentences.map((part) => part.trim()).filter(Boolean)) {
		if (sentence.length > MAX_TRANSCRIPT_PARAGRAPH_CHARS) {
			if (current) {
				paragraphs.push(current);
				current = '';
			}
			paragraphs.push(...splitLongSentence(sentence));
			continue;
		}

		const next = current ? `${current} ${sentence}` : sentence;
		if (next.length > MAX_TRANSCRIPT_PARAGRAPH_CHARS && current) {
			paragraphs.push(current);
			current = sentence;
		} else {
			current = next;
		}
	}

	if (current) {
		paragraphs.push(current);
	}

	return paragraphs;
}

function formatTranscript(value: string): string {
	const sanitized = sanitizeMarkdownContent(value.trim());
	if (!sanitized) {
		return 'No transcript available.';
	}

	const turns = parseTranscriptTurns(sanitized);
	if (turns.length === 0) {
		return splitIntoReadableParagraphs(sanitized).join('\n\n');
	}

	return turns
		.map((turn) => {
			const paragraphs = splitIntoReadableParagraphs(turn.text);
			return [`[${turn.speaker}]`, paragraphs.join('\n\n')].join('\n');
		})
		.join('\n\n');
}

export function renderPlaudMarkdown(detail: NormalizedPlaudDetail): string {
	const title = normalizeTitle(detail.title);
	const date = formatDate(detail.startAtMs);
	const duration = formatDuration(detail.durationMs);
	const summary = formatSummary(detail.summary);
	const transcript = formatTranscript(detail.transcript);

	return [
		'---',
		'source: plaud',
		'type: recording',
		`file_id: ${formatFrontmatterString(detail.fileId)}`,
		`title: ${formatFrontmatterString(title)}`,
		`date: ${date}`,
		`duration: ${duration}`,
		'---',
		'',
		`# ${sanitizeMarkdownContent(title)}`,
		'',
		'## Summary',
		summary,
		'',
		'## Highlights',
		renderHighlights(detail.highlights),
		'',
		'## Transcript',
		transcript,
		''
	].join('\n');
}
