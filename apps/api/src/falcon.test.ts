import assert from 'node:assert/strict';
import test from 'node:test';
import { diagnosticarFalcon } from './falcon.js';

test('Falcon permanece inactivo sin intentar conectarse por defecto', async () => {
  const original = process.env.FALCON_SYNC_ENABLED;
  process.env.FALCON_SYNC_ENABLED = 'false';
  const status = await diagnosticarFalcon();
  assert.equal(status.enabled, false);
  assert.equal(status.connected, false);
  process.env.FALCON_SYNC_ENABLED = original;
});
