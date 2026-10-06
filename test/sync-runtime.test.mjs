import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import process from 'node:process';
import {pathToFileURL} from 'node:url';

const root = process.cwd();
const moduleUrl = pathToFileURL(path.join(root, 'src/sync-runtime.ts')).href;
const {createPlaudSyncRuntime} = await import(moduleUrl);

test('startup sync respects syncOnStartup setting', async () => {
  let runCalls = 0;
  const notices = [];

  const runtime = createPlaudSyncRuntime({
    isStartupEnabled: () => false,
    runSync: async () => {
      runCalls += 1;
    },
    onLocked: (message) => {
      notices.push(message);
    }
  });

  const ran = await runtime.runStartupSync();

  assert.equal(ran, false);
  assert.equal(runCalls, 0);
  assert.deepEqual(notices, []);
});

test('concurrent sync attempts are prevented with clear messaging', async () => {
  let release;
  let runCalls = 0;
  const notices = [];

  const runtime = createPlaudSyncRuntime({
    isStartupEnabled: () => true,
    runSync: async () => {
      runCalls += 1;
      await new Promise((resolve) => {
        release = resolve;
      });
    },
    onLocked: (message) => {
      notices.push(message);
    }
  });

  const first = runtime.runManualSync();
  await Promise.resolve();
  const second = await runtime.runManualSync();

  assert.equal(second, false);
  assert.equal(runCalls, 1);
  assert.deepEqual(notices, ['Plaud sync already running. Please wait for current run to finish.']);

  release();
  const firstResult = await first;
  assert.equal(firstResult, true);
});

test('scheduled, startup, and manual tasks share a lock, including scheduled lifecycle writes', async () => {
  let release;
  const triggers = [];
  const runtime = createPlaudSyncRuntime({
    isStartupEnabled: () => true,
    runSync: async (trigger) => { triggers.push(trigger); },
    onLocked: () => {}
  });
  const scheduled = runtime.runScheduledSync(async () => {
    await new Promise((resolve) => { release = resolve; });
  });
  assert.equal(await runtime.runStartupSync(), false);
  assert.equal(await runtime.runManualSync(), false);
  assert.equal(await runtime.runScheduledSync(), false);
  assert.deepEqual(triggers, []);
  release();
  assert.equal(await scheduled, true);
  assert.equal(await runtime.runManualSync(), true);
  assert.deepEqual(triggers, ['manual']);
});

test('the lock is set before task execution and released even on rejection', async () => {
  let reentrant;
  const runtime = createPlaudSyncRuntime({
    isStartupEnabled: () => true,
    runSync: async () => {},
    onLocked: () => {}
  });
  await assert.rejects(runtime.runScheduledSync(async () => {
    reentrant = runtime.runManualSync();
    throw new Error('failed');
  }), /failed/);
  assert.equal(await reentrant, false);
  assert.equal(await runtime.runStartupSync(), true);
});
