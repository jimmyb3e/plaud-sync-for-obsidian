import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import process from 'node:process';
import {pathToFileURL} from 'node:url';
import fs from 'node:fs';

const root = process.cwd();
const schemaModuleUrl = pathToFileURL(path.join(root, 'src/settings-schema.ts')).href;
const {
  DEFAULT_SETTINGS,
  normalizeSettings,
  toPersistedSettings
} = await import(schemaModuleUrl);

const mainSource = fs.readFileSync(path.join(root, 'src/main.ts'), 'utf8');

test('default settings expose full Plaud sync schema', () => {
  assert.deepEqual(Object.keys(DEFAULT_SETTINGS).sort(), [
    'apiDomain',
    'filenamePattern',
    'lastScheduledAttemptAtMs',
    'lastScheduledSlotAtMs',
    'lastSuccessfulScheduledSyncAtMs',
    'lastSyncAtMs',
    'scheduledSyncEnabled',
    'scheduledSyncEnabledAtMs',
    'scheduledSyncFailure',
    'scheduledSyncStatus',
    'scheduledSyncTimes',
    'syncFolder',
    'syncOnStartup',
    'updateExisting'
  ]);

  assert.equal(DEFAULT_SETTINGS.apiDomain, 'https://api.plaud.ai');
  assert.equal(DEFAULT_SETTINGS.syncFolder, 'Plaud');
  assert.equal(DEFAULT_SETTINGS.syncOnStartup, true);
  assert.equal(DEFAULT_SETTINGS.updateExisting, true);
  assert.equal(DEFAULT_SETTINGS.filenamePattern, 'plaud-{date}-{time}-{title}');
  assert.equal(DEFAULT_SETTINGS.lastSyncAtMs, 0);
  assert.equal(DEFAULT_SETTINGS.scheduledSyncEnabled, false);
  assert.deepEqual(DEFAULT_SETTINGS.scheduledSyncTimes, ['08:00', '17:00']);
});

test('normalizeSettings merges persisted partial values with defaults', () => {
  const merged = normalizeSettings({
    syncFolder: 'My Plaud Notes',
    syncOnStartup: false,
    lastSyncAtMs: 1730000000123
  });

  assert.equal(merged.apiDomain, DEFAULT_SETTINGS.apiDomain);
  assert.equal(merged.syncFolder, 'My Plaud Notes');
  assert.equal(merged.syncOnStartup, false);
  assert.equal(merged.updateExisting, DEFAULT_SETTINGS.updateExisting);
  assert.equal(merged.filenamePattern, DEFAULT_SETTINGS.filenamePattern);
  assert.equal(merged.lastSyncAtMs, 1730000000123);
});

test('normalizeSettings protects against malformed persisted values', () => {
  const merged = normalizeSettings({
    apiDomain: '',
    syncFolder: 42,
    syncOnStartup: 'yes',
    updateExisting: null,
    filenamePattern: '',
    lastSyncAtMs: -100
  });

  assert.deepEqual(merged, DEFAULT_SETTINGS);
});

test('normalizeSettings migrates the old default filename pattern', () => {
  const merged = normalizeSettings({
    filenamePattern: 'plaud-{date}-{title}'
  });

  assert.equal(merged.filenamePattern, DEFAULT_SETTINGS.filenamePattern);
});

test('toPersistedSettings preserves explicit lastSyncAtMs checkpoint semantics', () => {
  const persisted = toPersistedSettings({
    ...DEFAULT_SETTINGS,
    lastSyncAtMs: 1731000000000
  });

  assert.equal(persisted.lastSyncAtMs, 1731000000000);
});

test('plugin main wiring uses normalizeSettings during load path', () => {
  assert.match(mainSource, /this\.settings\s*=\s*normalizeSettings\(await this\.loadData\(\)\)/);
});

test('legacy settings migrate without changing startup, manual sync configuration, or checkpoint', () => {
  const legacy = {
    apiDomain: 'https://api.plaud.ai', syncFolder: 'Existing notes', syncOnStartup: false,
    updateExisting: false, filenamePattern: '{title}', lastSyncAtMs: 1720000000000
  };
  const migrated = normalizeSettings(legacy);
  for (const [key, value] of Object.entries(legacy)) {
    assert.equal(migrated[key], value);
  }
  assert.equal(migrated.scheduledSyncEnabled, false);
  assert.deepEqual(migrated.scheduledSyncTimes, ['08:00', '17:00']);
  assert.equal(migrated.scheduledSyncEnabledAtMs, 0);
  assert.equal(migrated.lastScheduledAttemptAtMs, 0);
  assert.equal(migrated.lastSuccessfulScheduledSyncAtMs, 0);
  assert.equal(migrated.scheduledSyncStatus, 'never');
  assert.equal(migrated.scheduledSyncFailure, null);
});

test('schedule settings round-trip with canonical times and safe status codes', () => {
  const settings = normalizeSettings({
    scheduledSyncEnabled: true, scheduledSyncTimes: ['17:00', '8:00', '08:00'],
    scheduledSyncEnabledAtMs: 1000, lastScheduledSlotAtMs: 2000,
    lastScheduledAttemptAtMs: 2100, lastSuccessfulScheduledSyncAtMs: 2200,
    scheduledSyncStatus: 'failed', scheduledSyncFailure: 'auth'
  });
  assert.deepEqual(settings.scheduledSyncTimes, ['08:00', '17:00']);
  assert.deepEqual(normalizeSettings(toPersistedSettings(settings)), settings);
});

test('malformed schedules and unsafe failure text are rejected during load and save', () => {
  const malformed = {
    scheduledSyncEnabled: 'yes', scheduledSyncTimes: ['08:00', '25:00'],
    scheduledSyncEnabledAtMs: -1, lastScheduledSlotAtMs: NaN,
    lastScheduledAttemptAtMs: 'yesterday', lastSuccessfulScheduledSyncAtMs: Infinity,
    scheduledSyncStatus: 'Bearer credential', scheduledSyncFailure: 'https://private.example/?token=secret'
  };
  assert.deepEqual(normalizeSettings(malformed), DEFAULT_SETTINGS);
  assert.deepEqual(toPersistedSettings({...DEFAULT_SETTINGS, ...malformed}), DEFAULT_SETTINGS);
  for (const times of [[], ['8 AM'], '08:00,17:00', null]) {
    assert.deepEqual(normalizeSettings({scheduledSyncTimes: times}).scheduledSyncTimes, ['08:00', '17:00']);
  }
});

test('schedule arrays are copied so edits cannot mutate the defaults or queued save snapshots', () => {
  const settings = normalizeSettings(null);
  const saved = toPersistedSettings(settings);
  settings.scheduledSyncTimes.push('20:00');
  assert.deepEqual(DEFAULT_SETTINGS.scheduledSyncTimes, ['08:00', '17:00']);
  assert.deepEqual(saved.scheduledSyncTimes, ['08:00', '17:00']);
});
