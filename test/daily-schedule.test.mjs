import test from 'node:test';
import assert from 'node:assert/strict';
import process from 'node:process';
import {nextScheduledRunAt, dueScheduledRunAt, parseDailySyncTimes} from '../src/daily-schedule.ts';

process.env.TZ = 'America/Chicago';
const local = (value) => new Date(value).getTime();
const times = ['08:00', '17:00'];

test('next run uses local times, skips the exact current slot, and rolls across calendar boundaries', () => {
  for (const [now, expected] of [
    ['2026-10-06T07:59:59', '2026-10-06T08:00:00'],
    ['2026-10-06T08:00:00', '2026-10-06T17:00:00'],
    ['2026-10-06T12:00:00', '2026-10-06T17:00:00'],
    ['2026-10-06T17:00:00', '2026-10-07T08:00:00'],
    ['2026-12-31T23:59:59', '2027-01-01T08:00:00']
  ]) {
    assert.equal(nextScheduledRunAt(local(now), times), local(expected));
  }
});

test('custom times are validated, sorted, and deduplicated', () => {
  assert.deepEqual(parseDailySyncTimes([' 9:15 ', '00:00', '23:59', '09:15']), ['00:00', '09:15', '23:59']);
  assert.equal(nextScheduledRunAt(local('2026-10-06T08:00:00'), ['21:10', '09:15']), local('2026-10-06T09:15:00'));
  assert.equal(parseDailySyncTimes(['24:00']), null);
  assert.equal(parseDailySyncTimes(['08:60']), null);
  assert.equal(nextScheduledRunAt(Date.now(), []), null);
});

test('catch-up picks only the latest missed slot and excludes already claimed slots', () => {
  const since = local('2026-10-01T07:00:00');
  const now = local('2026-10-06T12:00:00');
  const latest = local('2026-10-06T08:00:00');
  assert.equal(dueScheduledRunAt(now, times, since), latest);
  assert.equal(dueScheduledRunAt(now, times, latest), null);
  assert.equal(dueScheduledRunAt(local('2026-10-06T07:00:00'), times, since), local('2026-10-05T17:00:00'));
  assert.equal(dueScheduledRunAt(latest, times, since), latest);
  assert.equal(dueScheduledRunAt(now, times, now + 1), null);
});

test('next morning stays at 8 AM across spring and autumn DST changes', () => {
  assert.equal(nextScheduledRunAt(local('2026-03-07T18:00:00'), times), Date.parse('2026-03-08T13:00:00Z'));
  assert.equal(nextScheduledRunAt(local('2026-10-31T18:00:00'), times), Date.parse('2026-11-01T14:00:00Z'));
});

test('DST gaps advance nonexistent times and repeated times run only once', () => {
  assert.equal(nextScheduledRunAt(local('2026-03-08T01:59:00'), ['02:30']), Date.parse('2026-03-08T08:30:00Z'));
  // On this day 03:00 occurs before the normalized 02:30 (03:30).
  assert.equal(nextScheduledRunAt(local('2026-03-08T01:59:00'), ['02:30', '03:00']), Date.parse('2026-03-08T08:00:00Z'));
  const firstOccurrence = Date.parse('2026-11-01T06:30:00Z');
  assert.equal(nextScheduledRunAt(local('2026-11-01T00:30:00'), ['01:30']), firstOccurrence);
  assert.equal(dueScheduledRunAt(Date.parse('2026-11-01T07:45:00Z'), ['01:30'], firstOccurrence), null);
});

test('a timezone change recalculates the next local time', () => {
  const instant = Date.parse('2026-10-06T14:00:00Z');
  try {
    process.env.TZ = 'America/Los_Angeles';
    assert.equal(nextScheduledRunAt(instant, times), Date.parse('2026-10-06T15:00:00Z'));
  } finally {
    process.env.TZ = 'America/Chicago';
  }
});
