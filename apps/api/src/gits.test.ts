import test from 'node:test';
import assert from 'node:assert/strict';
import { correlacionSeguraGits, fechaGitsPeru } from './gits.js';

const event = (overrides: Partial<{
  volante: string | null; placa: string | null; contenedor: string | null; fechaGarita: string | null;
}> = {}) => ({
  empresa: '00001', movimiento: '1', volante: '000000000164303', placa: 'F6A843', contenedor: 'MRKU2922154',
  fechaGarita: '2026-10-19T04:47:56-05:00', fechaIngresoAlmacen: null, fechaSalidaAlmacen: null, ...overrides
});

test('correlacion GITS usa contenedor exacto y conserva el primer ingreso', () => {
  const result = correlacionSeguraGits(
    { volante: '164303', placa: null, contenedor: 'MRKU2922154' },
    [event({ fechaGarita: '2026-10-19T06:00:00-05:00' }), event({ fechaGarita: '2026-10-19T04:47:56-05:00' })]
  );
  assert.equal(result?.matchedBy, 'CONTENEDOR');
  assert.equal(result?.event.fechaGarita, '2026-10-19T04:47:56-05:00');
});

test('correlacion GITS no asigna un volante sin contenedor cuando hay varias placas', () => {
  const result = correlacionSeguraGits(
    { volante: '164303', placa: null, contenedor: null },
    [event(), event({ placa: 'D7J818', contenedor: 'TCNU7793576' })]
  );
  assert.equal(result, null);
});

test('datetime de GITS se serializa como hora Perú', () => {
  assert.equal(fechaGitsPeru(new Date(Date.UTC(2026, 9, 19, 4, 47, 56))), '2026-10-19T04:47:56-05:00');
});
