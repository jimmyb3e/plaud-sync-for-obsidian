import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import process from 'node:process';
import {pathToFileURL} from 'node:url';

const root = process.cwd();
const moduleUrl = pathToFileURL(path.join(root, 'src/security.ts')).href;
const {normalizePlaudApiDomain, normalizeSignedContentUrl} = await import(moduleUrl);

test('normalizes allowed Plaud API hosts to origin', () => {
  assert.equal(normalizePlaudApiDomain('https://api.plaud.ai/'), 'https://api.plaud.ai');
  assert.equal(normalizePlaudApiDomain('https://api-euc1.plaud.ai'), 'https://api-euc1.plaud.ai');
});

test('rejects unsafe Plaud API domains', () => {
  assert.throws(() => normalizePlaudApiDomain('http://api.plaud.ai'), /must use https/);
  assert.throws(() => normalizePlaudApiDomain('https://example.com'), /plaud\.ai API host/);
  assert.throws(() => normalizePlaudApiDomain('https://api.plaud.ai.evil.test'), /plaud\.ai API host/);
  assert.throws(() => normalizePlaudApiDomain('https://api.plaud.ai/path'), /base https/);
  assert.throws(() => normalizePlaudApiDomain('https://api.plaud.ai:8443'), /base https/);
});

test('allows ordinary signed https content URLs', () => {
  assert.equal(
    normalizeSignedContentUrl('https://cdn.example.com/content.json?X-Amz-Signature=abc'),
    'https://cdn.example.com/content.json?X-Amz-Signature=abc'
  );
});

test('blocks local or non-https signed content URLs', () => {
  assert.throws(() => normalizeSignedContentUrl('http://cdn.example.com/content.json'), /must use https/);
  assert.throws(() => normalizeSignedContentUrl('https://localhost/content.json'), /local or private/);
  assert.throws(() => normalizeSignedContentUrl('https://127.0.0.1/content.json'), /local or private/);
  assert.throws(() => normalizeSignedContentUrl('https://192.168.1.5/content.json'), /local or private/);
});
