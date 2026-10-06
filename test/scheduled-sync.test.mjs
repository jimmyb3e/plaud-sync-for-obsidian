import test from 'node:test';
import assert from 'node:assert/strict';
import process from 'node:process';
import {setImmediate} from 'node:timers/promises';
import {PlaudScheduledSync} from '../src/scheduled-sync.ts';
import {createPlaudSyncRuntime} from '../src/sync-runtime.ts';
import {normalizeSettings, toPersistedSettings} from '../src/settings-schema.ts';
import {PlaudApiError} from '../src/plaud-api.ts';

process.env.TZ = 'America/Chicago';
const local = (value) => new Date(value).getTime();
const summary = (overrides = {}) => ({
  listed: 0, selected: 0, created: 0, updated: 0, skipped: 0, failed: 0,
  lastSyncAtMsBefore: 0, lastSyncAtMsAfter: 0, failures: [], ...overrides
});

function harness(overrides = {}, behavior = {}) {
  let now = behavior.now ?? local('2026-10-06T07:59:30');
  const settings = normalizeSettings({
    syncOnStartup: false, scheduledSyncEnabled: true,
    scheduledSyncEnabledAtMs: local('2026-10-05T07:00:00'),
    lastScheduledSlotAtMs: local('2026-10-05T17:00:00'), ...overrides
  });
  const timers = new Map();
  const saved = [];
  const failures = [];
  const runs = [];
  const triggers = [];
  const notices = [];
  let timerId = 0;
  const runtime = createPlaudSyncRuntime({
    isStartupEnabled: () => settings.syncOnStartup,
    runSync: async (trigger) => {
      triggers.push(trigger);
      await behavior.runOther?.(trigger);
    },
    onLocked: (message) => notices.push(message)
  });
  const scheduler = new PlaudScheduledSync({
    getSettings: () => settings,
    saveSettings: async () => {
      scheduler.settingsChanged();
      await behavior.save?.(settings);
      saved.push(toPersistedSettings(settings));
    },
    runtime,
    sync: async () => {
      runs.push(now);
      return behavior.sync ? behavior.sync() : summary();
    },
    onFailure: (failure) => failures.push(failure),
    now: () => now,
    setTimer: (callback, delayMs) => {
      timers.set(++timerId, {callback, delayMs});
      return timerId;
    },
    clearTimer: (id) => timers.delete(id)
  });
  return {
    settings, timers, saved, failures, runs, triggers, notices, runtime, scheduler,
    async fireAt(nextNow) {
      now = nextNow;
      const [id, timer] = timers.entries().next().value;
      timers.delete(id);
      timer.callback();
      await setImmediate();
    },
    setNow(value) { now = value; }
  };
}

test('a scheduled run records its attempt before sync and records no new recordings as success', async () => {
  const h = harness();
  await h.scheduler.start();
  assert.equal(h.timers.values().next().value.delayMs, 30_000);
  await h.fireAt(local('2026-10-06T08:00:00'));
  assert.deepEqual(h.runs, [local('2026-10-06T08:00:00')]);
  assert.equal(h.saved[0].scheduledSyncStatus, 'running');
  assert.equal(h.saved[0].lastScheduledAttemptAtMs, h.runs[0]);
  assert.equal(h.saved[0].lastScheduledSlotAtMs, h.runs[0]);
  assert.equal(h.saved[1].scheduledSyncStatus, 'no_new_recordings');
  assert.equal(h.saved[1].lastSuccessfulScheduledSyncAtMs, h.runs[0]);
  assert.equal(h.saved[1].scheduledSyncFailure, null);
  h.scheduler.stop();
});

test('opening after multiple missed slots performs one catch-up and fulfills startup sync', async () => {
  const h = harness({syncOnStartup: true}, {now: local('2026-10-10T18:00:00')});
  await h.scheduler.start();
  assert.equal(h.runs.length, 1);
  assert.equal(h.settings.lastScheduledSlotAtMs, local('2026-10-10T17:00:00'));
  assert.deepEqual(h.triggers, []);
  await h.fireAt(local('2026-10-10T18:01:00'));
  assert.equal(h.runs.length, 1);
  h.scheduler.stop();

  const reopened = harness(h.saved.at(-1), {now: local('2026-10-10T18:02:00')});
  await reopened.scheduler.start();
  assert.equal(reopened.runs.length, 0);
  assert.deepEqual(reopened.triggers, ['startup']);
  reopened.scheduler.stop();
});

test('missing the first ever scheduled slot still catches up on the next open', async () => {
  const h = harness({lastScheduledSlotAtMs: 0}, {now: local('2026-10-06T09:00:00')});
  await h.scheduler.start();
  assert.equal(h.runs.length, 1);
  assert.equal(h.settings.lastScheduledSlotAtMs, local('2026-10-06T08:00:00'));
  h.scheduler.stop();
});

test('a newly enabled schedule starts now and does not catch up slots from before activation', async () => {
  const h = harness({scheduledSyncEnabledAtMs: 0, lastScheduledSlotAtMs: 0}, {now: local('2026-10-06T18:00:00')});
  await h.scheduler.start();
  assert.equal(h.runs.length, 0);
  assert.equal(h.saved[0].scheduledSyncEnabledAtMs, local('2026-10-06T18:00:00'));
  await h.fireAt(local('2026-10-07T08:00:00'));
  assert.equal(h.runs.length, 1);
  h.scheduler.stop();
});

test('disabled scheduling leaves startup sync behavior intact and creates no timer', async () => {
  const h = harness({scheduledSyncEnabled: false, syncOnStartup: true});
  await h.scheduler.start();
  assert.deepEqual(h.triggers, ['startup']);
  assert.equal(h.runs.length, 0);
  assert.equal(h.timers.size, 0);
  assert.equal(h.saved.length, 0);
  h.scheduler.stop();
});

test('a suspended timer collapses missed runs into the latest slot on resume', async () => {
  const h = harness();
  await h.scheduler.start();
  await h.fireAt(local('2026-10-08T18:00:00'));
  assert.equal(h.runs.length, 1);
  assert.equal(h.settings.lastScheduledSlotAtMs, local('2026-10-08T17:00:00'));
  h.scheduler.stop();
});

test('a busy manual sync leaves the scheduled slot pending until the shared lock is free', async () => {
  let release;
  const h = harness({}, {runOther: () => new Promise((resolve) => { release = resolve; })});
  const manual = h.runtime.runManualSync();
  h.setNow(local('2026-10-06T08:00:00'));
  await h.scheduler.start();
  assert.equal(h.runs.length, 0);
  assert.equal(h.settings.lastScheduledAttemptAtMs, 0);
  assert.equal(h.timers.values().next().value.delayMs, 30_000);
  assert.deepEqual(h.notices, []);
  release();
  await manual;
  await h.fireAt(local('2026-10-06T08:00:30'));
  assert.equal(h.runs.length, 1);
  assert.equal(h.settings.lastScheduledSlotAtMs, local('2026-10-06T08:00:00'));
  h.scheduler.stop();
});

test('scheduled sync holds the shared lock through persistence and duplicate timer callbacks', async () => {
  let release;
  const h = harness({syncOnStartup: true}, {
    sync: () => new Promise((resolve) => { release = () => resolve(summary()); })
  });
  await h.scheduler.start();
  const callback = h.timers.values().next().value.callback;
  await h.fireAt(local('2026-10-06T08:00:00'));
  assert.equal(h.settings.scheduledSyncStatus, 'running');
  callback();
  assert.equal(await h.runtime.runManualSync(), false);
  assert.equal(await h.runtime.runStartupSync(), false);
  assert.equal(await h.runtime.runScheduledSync(), false);
  assert.equal(h.runs.length, 1);
  release();
  await setImmediate();
  callback();
  await setImmediate();
  assert.equal(h.runs.length, 1);
  assert.equal(h.timers.size, 1);
  h.scheduler.stop();
  assert.equal(h.timers.size, 0);
});

test('schedule edits replace the timer and start a new baseline without changing sync history', async () => {
  const h = harness();
  await h.scheduler.start();
  const oldId = h.timers.keys().next().value;
  const clearedCallback = h.timers.get(oldId).callback;
  h.settings.scheduledSyncTimes = ['07:59', '08:05'];
  h.scheduler.settingsChanged();
  assert.equal(h.timers.has(oldId), false);
  assert.equal(h.timers.size, 1);
  clearedCallback();
  await setImmediate();
  assert.equal(h.timers.size, 1);
  assert.equal(h.settings.scheduledSyncEnabledAtMs, local('2026-10-06T07:59:30'));
  assert.equal(h.settings.lastScheduledSlotAtMs, local('2026-10-05T17:00:00'));
  await h.fireAt(local('2026-10-06T08:00:00'));
  assert.equal(h.runs.length, 0);
  await h.fireAt(local('2026-10-06T08:05:00'));
  assert.equal(h.runs.length, 1);
  h.settings.scheduledSyncEnabled = false;
  h.scheduler.settingsChanged();
  assert.equal(h.timers.size, 0);
  h.scheduler.stop();
});

test('unload clears timers, ignores stale callbacks, and prevents rearming after an in-flight run', async () => {
  let release;
  const h = harness({}, {sync: () => new Promise((resolve) => { release = () => resolve(summary()); })});
  await h.scheduler.start();
  const staleCallback = h.timers.values().next().value.callback;
  await h.fireAt(local('2026-10-06T08:00:00'));
  h.scheduler.stop();
  staleCallback();
  release();
  await setImmediate();
  assert.equal(h.timers.size, 0);
  assert.equal(h.runs.length, 1);
  h.settings.scheduledSyncTimes = ['20:00'];
  h.scheduler.settingsChanged();
  assert.equal(h.timers.size, 0);
});

test('complete failure preserves last success and persists only a safe failure code', async () => {
  const secret = 'sensitive-credential';
  const priorSuccess = local('2026-10-05T17:01:00');
  const h = harness({lastSuccessfulScheduledSyncAtMs: priorSuccess}, {
    now: local('2026-10-06T09:00:00'),
    sync: async () => { throw new PlaudApiError('auth', `Bearer ${secret} https://example.com/private-recording`); }
  });
  await h.scheduler.start();
  assert.equal(h.settings.scheduledSyncStatus, 'failed');
  assert.equal(h.settings.scheduledSyncFailure, 'auth');
  assert.equal(h.settings.lastSuccessfulScheduledSyncAtMs, priorSuccess);
  assert.deepEqual(h.failures, ['auth']);
  assert.doesNotMatch(JSON.stringify(h.saved), /sensitive-credential|private-recording/);
  h.scheduler.stop();
  const reopened = harness(h.saved.at(-1), {now: local('2026-10-06T10:00:00')});
  await reopened.scheduler.start();
  assert.equal(reopened.runs.length, 0);
  reopened.scheduler.stop();
});

test('partial failure is not reported as success or no new recordings', async () => {
  const h = harness({}, {
    now: local('2026-10-06T09:00:00'),
    sync: async () => summary({selected: 2, created: 1, failed: 1, failures: [{fileId: 'private-id', message: 'raw secret'}]})
  });
  await h.scheduler.start();
  assert.equal(h.settings.scheduledSyncStatus, 'failed');
  assert.equal(h.settings.scheduledSyncFailure, 'partial_failure');
  assert.equal(h.settings.lastSuccessfulScheduledSyncAtMs, 0);
  assert.doesNotMatch(JSON.stringify(h.saved), /private-id|raw secret/);
  h.scheduler.stop();
});

test('successful recordings clear a previous failure and advance the scheduled success timestamp', async () => {
  const h = harness({scheduledSyncStatus: 'failed', scheduledSyncFailure: 'auth'}, {
    now: local('2026-10-06T09:00:00'), sync: async () => summary({selected: 1, created: 1})
  });
  await h.scheduler.start();
  assert.equal(h.settings.scheduledSyncStatus, 'success');
  assert.equal(h.settings.scheduledSyncFailure, null);
  assert.equal(h.settings.lastSuccessfulScheduledSyncAtMs, local('2026-10-06T09:00:00'));
  h.scheduler.stop();
});

test('persistence failure before the attempt prevents an untracked network sync', async () => {
  let saves = 0;
  const h = harness({}, {
    now: local('2026-10-06T09:00:00'),
    save: async () => { if (++saves === 1) throw new Error('private-path'); }
  });
  await h.scheduler.start();
  assert.equal(h.runs.length, 0);
  assert.equal(h.saved[0].scheduledSyncStatus, 'failed');
  assert.equal(h.saved[0].scheduledSyncFailure, 'persistence');
  assert.deepEqual(h.failures, ['persistence']);
  h.scheduler.stop();
});

test('an interrupted attempt is marked failed on reopen without repeating the claimed slot', async () => {
  const slot = local('2026-10-06T08:00:00');
  const h = harness({
    scheduledSyncStatus: 'running', lastScheduledSlotAtMs: slot, lastScheduledAttemptAtMs: slot
  }, {now: local('2026-10-06T09:00:00')});
  await h.scheduler.start();
  assert.equal(h.runs.length, 0);
  assert.equal(h.saved[0].scheduledSyncStatus, 'failed');
  assert.equal(h.saved[0].scheduledSyncFailure, 'interrupted');
  assert.equal(h.settings.lastSuccessfulScheduledSyncAtMs, 0);
  h.scheduler.stop();
});

test('an unknown error containing sensitive details becomes only an unknown failure code', async () => {
  const h = harness({}, {
    now: local('2026-10-06T09:00:00'),
    sync: async () => { throw new Error('secret credential in /private/path'); }
  });
  await h.scheduler.start();
  assert.equal(h.settings.scheduledSyncStatus, 'failed');
  assert.equal(h.settings.scheduledSyncFailure, 'unknown');
  assert.doesNotMatch(JSON.stringify(h.saved), /secret credential|private\/path/);
  h.scheduler.stop();
});
