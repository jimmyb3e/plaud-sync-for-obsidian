export const DEFAULT_SYNC_TIMES = ['08:00', '17:00'];

/** Validate, canonicalize, sort, and deduplicate local daily times. */
export function parseDailySyncTimes(value: unknown): string[] | null {
	if (!Array.isArray(value) || value.length === 0) {
		return null;
	}

	const times: string[] = [];
	for (const entry of value) {
		if (typeof entry !== 'string' || !/^(?:[01]?\d|2[0-3]):[0-5]\d$/.test(entry.trim())) {
			return null;
		}
		times.push(entry.trim().padStart(5, '0'));
	}

	return [...new Set(times)].sort();
}

function localRunTimes(nowMs: number, times: readonly string[], dayOffset: number): number[] {
	const now = new Date(nowMs);
	return times.map((time) => {
		const [hour, minute] = time.split(':').map(Number);
		// Use calendar days so DST changes do not shift the configured wall-clock time.
		// Date chooses the first repeated time and advances nonexistent times across a DST gap.
		return new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, hour, minute).getTime();
	});
}

export function nextScheduledRunAt(nowMs: number, times: readonly string[]): number | null {
	const validTimes = parseDailySyncTimes(times);
	if (!validTimes || !Number.isFinite(nowMs)) {
		return null;
	}
	const upcoming = [...localRunTimes(nowMs, validTimes, 0), ...localRunTimes(nowMs, validTimes, 1)]
		.filter((time) => time > nowMs);
	return upcoming.length > 0 ? Math.min(...upcoming) : null;
}

/** One latest missed slot covers every earlier slot because sync is incremental. */
export function dueScheduledRunAt(nowMs: number, times: readonly string[], sinceMs: number): number | null {
	const validTimes = parseDailySyncTimes(times);
	if (!validTimes || !Number.isFinite(nowMs) || !Number.isFinite(sinceMs)) {
		return null;
	}
	const due = [...localRunTimes(nowMs, validTimes, -1), ...localRunTimes(nowMs, validTimes, 0)]
		.filter((time) => time <= nowMs && time > sinceMs);
	return due.length > 0 ? Math.max(...due) : null;
}
