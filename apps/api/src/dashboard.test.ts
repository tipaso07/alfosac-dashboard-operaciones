import test from 'node:test';
import assert from 'node:assert/strict';
import { crearResumen } from './dashboard.js';
import type { Operacion } from './domain.js';

test('resume citas y eventos del día sin perder una cita que ya llegó a garita', () => {
  const operaciones: Operacion[] = [
    { id: '1', modalidad: 'FCL', estado: 'EN_GARITA', volante: 'A', unidad: 'U1', fechaCita: '2026-10-19T07:00:00-05:00', fechaGarita: '2026-10-19T07:20:00-05:00', fechaIngresoDespacho: null, fechaCompletado: null, fuente: 'DEMO' },
    { id: '2', modalidad: 'FCL', estado: 'COMPLETADA', volante: 'B', unidad: 'U2', fechaCita: '2026-10-19T08:00:00-05:00', fechaGarita: '2026-10-19T08:15:00-05:00', fechaIngresoDespacho: '2026-10-19T08:30:00-05:00', fechaCompletado: '2026-10-19T09:00:00-05:00', fuente: 'DEMO' }
  ];
  const fcl = crearResumen(operaciones, '2026-10-19').find((item) => item.modalidad === 'FCL');
  assert.deepEqual(fcl, { modalidad: 'FCL', agendadas: 2, garita: 2, despacho: 1, completadas: 1, noCompletadas: 0 });
});

