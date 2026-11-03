import assert from 'node:assert/strict';
import test from 'node:test';
import { diagnosticarFalcon, fechaFalconPeru } from './falcon.js';

test('Falcon permanece inactivo sin intentar conectarse por defecto', async () => {
  const original = process.env.FALCON_SYNC_ENABLED;
  process.env.FALCON_SYNC_ENABLED = 'false';
  const status = await diagnosticarFalcon();
  assert.equal(status.enabled, false);
  assert.equal(status.connected, false);
  process.env.FALCON_SYNC_ENABLED = original;
});

test('preserva la hora local de Falcon al serializar DATETIME sin zona', () => {
  assert.equal(
    fechaFalconPeru(new Date('2026-11-03T07:19:59.050Z')),
    '2026-11-03T07:19:59-05:00'
  );
});
