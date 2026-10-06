export interface PlaudVaultAdapter {
	ensureFolder(path: string): Promise<void>;
	listMarkdownFiles(folder: string): Promise<string[]>;
	read(path: string): Promise<string>;
	write(path: string, content: string): Promise<void>;
	create(path: string, content: string): Promise<void>;
}

export interface BuildFilenameInput {
	filenamePattern: string;
	date: string;
	time?: string;
	title: string;
}

export interface UpsertPlaudNoteInput {
	vault: PlaudVaultAdapter;
	syncFolder: string;
	filenamePattern: string;
	updateExisting: boolean;
	fileId: string;
	title: string;
	date: string;
	time: string;
	markdown: string;
}

export interface UpsertPlaudNoteResult {
	action: 'created' | 'updated' | 'skipped';
	path: string;
}

const INVALID_FOLDER_SEGMENT_CHARS = /[<>:"|?*]/;

export function normalizeSyncFolder(folder: string): string {
	const normalized = folder
		.trim()
		.replace(/\\/g, '/')
		.replace(/\/+/g, '/')
		.replace(/^\/+|\/+$/g, '');

	if (!normalized) {
		return 'Plaud';
	}

	const segments = normalized.split('/');
	for (const segment of segments) {
		if (!segment || segment === '.' || segment === '..') {
			throw new Error('Plaud sync folder cannot contain empty, current, or parent-directory segments.');
		}

		if (segment.startsWith('.')) {
			throw new Error('Plaud sync folder cannot target hidden or Obsidian configuration folders.');
		}

		if (INVALID_FOLDER_SEGMENT_CHARS.test(segment)) {
			throw new Error('Plaud sync folder contains characters that are not safe for vault folder names.');
		}
	}

	return segments.join('/');
}

function slugify(value: string): string {
	const normalized = value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.replace(/-+/g, '-');

	return normalized || 'recording';
}

function datePrefixCandidates(date: string): string[] {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
	if (!match) {
		return [];
	}

	const [, year, month, day] = match;
	const monthNoZero = String(Number(month));
	const dayNoZero = String(Number(day));
	const candidates = [
		`${year}-${month}-${day}`,
		`${year}-${monthNoZero}-${dayNoZero}`,
		`${month}-${day}`,
		`${month}-${dayNoZero}`,
		`${monthNoZero}-${day}`,
		`${monthNoZero}-${dayNoZero}`
	];

	return [...new Set(candidates)].sort((a, b) => b.length - a.length);
}

function stripMatchingDatePrefix(titleSlug: string, date: string): string {
	for (const candidate of datePrefixCandidates(date)) {
		if (titleSlug === candidate) {
			return '';
		}

		const prefix = `${candidate}-`;
		if (titleSlug.startsWith(prefix)) {
			return titleSlug.slice(prefix.length);
		}
	}

	return titleSlug;
}

function buildTitleSlugForPattern(title: string, date: string, pattern: string): string {
	const titleSlug = slugify(title);
	if (!pattern.includes('{date}')) {
		return titleSlug;
	}

	return stripMatchingDatePrefix(titleSlug, date) || 'recording';
}

function extractFrontmatter(content: string): string {
	if (!content.startsWith('---\n')) {
		return '';
	}

	const closing = content.indexOf('\n---\n', 4);
	if (closing === -1) {
		return '';
	}

	return content.slice(4, closing);
}

function extractFrontmatterFileId(content: string): string {
	const frontmatter = extractFrontmatter(content);
	if (!frontmatter) {
		return '';
	}

	const match = frontmatter.match(/^file_id:\s*(.+)$/m);
	const raw = match?.[1]?.trim() ?? '';
	if (!raw) {
		return '';
	}

	const startsWithDouble = raw.startsWith('"');
	const endsWithDouble = raw.endsWith('"');
	if (startsWithDouble && endsWithDouble && raw.length >= 2) {
		return raw.slice(1, -1).trim();
	}

	const startsWithSingle = raw.startsWith("'");
	const endsWithSingle = raw.endsWith("'");
	if (startsWithSingle && endsWithSingle && raw.length >= 2) {
		return raw.slice(1, -1).trim();
	}

	return raw;
}

function joinPath(folder: string, fileName: string): string {
	return `${folder}/${fileName}`;
}

function withCollisionSuffix(fileName: string, suffix: number): string {
	const dotIndex = fileName.lastIndexOf('.');
	if (dotIndex === -1) {
		return `${fileName}-${suffix}`;
	}

	const base = fileName.slice(0, dotIndex);
	const ext = fileName.slice(dotIndex);
	return `${base}-${suffix}${ext}`;
}

export function buildPlaudFilename(input: BuildFilenameInput): string {
	const pattern = input.filenamePattern.trim() || 'plaud-{date}-{time}-{title}';
	const title = buildTitleSlugForPattern(input.title, input.date, pattern);
	const replacedDate = pattern.replace(/\{date\}/g, input.date);
	const replacedTime = replacedDate.replace(/\{time\}/g, input.time ?? '00-00-00');
	const filled = replacedTime.replace(/\{title\}/g, title);
	const filename = slugify(filled).replace(/^-+|-+$/g, '');
	return `${filename || 'plaud-recording'}.md`;
}

function resolveAvailablePath(folder: string, initialFileName: string, existingPaths: Set<string>): string {
	let candidate = joinPath(folder, initialFileName);
	if (!existingPaths.has(candidate)) {
		return candidate;
	}

	let suffix = 2;
	while (existingPaths.has(candidate)) {
		candidate = joinPath(folder, withCollisionSuffix(initialFileName, suffix));
		suffix += 1;
	}

	return candidate;
}

export async function upsertPlaudNote(input: UpsertPlaudNoteInput): Promise<UpsertPlaudNoteResult> {
	const folder = normalizeSyncFolder(input.syncFolder);
	await input.vault.ensureFolder(folder);

	const existingPaths = await input.vault.listMarkdownFiles(folder);
	const existingSet = new Set(existingPaths);

	for (const path of existingPaths) {
		const fileId = extractFrontmatterFileId(await input.vault.read(path));
		if (fileId === input.fileId) {
			if (!input.updateExisting) {
				return {action: 'skipped', path};
			}

			await input.vault.write(path, input.markdown);
			return {action: 'updated', path};
		}
	}

	const initialFileName = buildPlaudFilename({
		filenamePattern: input.filenamePattern,
		date: input.date,
		time: input.time,
		title: input.title
	});
	const path = resolveAvailablePath(folder, initialFileName, existingSet);

	await input.vault.create(path, input.markdown);
	return {action: 'created', path};
}
