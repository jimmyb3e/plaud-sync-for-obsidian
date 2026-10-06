import {PlaudApiError} from './plaud-api.ts';

export const SCHEDULED_SYNC_STATUSES = ['never', 'running', 'success', 'no_new_recordings', 'failed'] as const;
export type ScheduledSyncStatus = typeof SCHEDULED_SYNC_STATUSES[number];

export const SCHEDULED_SYNC_FAILURES = [
	'auth', 'rate_limit', 'network', 'server', 'invalid_response', 'partial_failure', 'persistence', 'interrupted', 'unknown'
] as const;
export type ScheduledSyncFailure = typeof SCHEDULED_SYNC_FAILURES[number];

export function normalizeScheduledSyncStatus(value: unknown): ScheduledSyncStatus {
	return SCHEDULED_SYNC_STATUSES.find((status) => status === value) ?? 'never';
}

export function normalizeScheduledSyncFailure(value: unknown): ScheduledSyncFailure | null {
	return SCHEDULED_SYNC_FAILURES.find((failure) => failure === value) ?? null;
}

/** Persist only allowlisted codes; raw errors can contain credentials or recording content. */
export function scheduledSyncFailureFromError(error: unknown): ScheduledSyncFailure {
	return error instanceof PlaudApiError ? normalizeScheduledSyncFailure(error.category) ?? 'unknown' : 'unknown';
}
