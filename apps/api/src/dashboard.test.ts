import test from 'node:test';
import assert from 'node:assert/strict';
import { crearResumen } from './dashboard.js';
import type { Operacion } from './domain.js';

test('resume operaciones por modalidad y estado', () => {
  const operaciones: Operacion[] = [
    { id: '1', modalidad: 'FCL', estado: 'EN_GARITA', volante: 'A', unidad: 'U1', fechaCita: null, fechaGarita: null, fechaIngresoDespacho: null, fechaCompletado: null, fuente: 'DEMO' },
    { id: '2', modalidad: 'FCL', estado: 'COMPLETADA', volante: 'B', unidad: 'U2', fechaCita: null, fechaGarita: null, fechaIngresoDespacho: null, fechaCompletado: null, fuente: 'DEMO' }
  ];
  const fcl = crearResumen(operaciones).find((item) => item.modalidad === 'FCL');
  assert.deepEqual(fcl, { modalidad: 'FCL', agendadas: 0, garita: 1, despacho: 0, completadas: 1, noCompletadas: 0 });
});

