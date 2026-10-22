import test from 'node:test';
import assert from 'node:assert/strict';
import { crearFlujoOperativo } from './operational-flow.js';
import type { Operacion } from './domain.js';

const cita = (id: string): Operacion => ({ id, modalidad: 'LCL', estado: 'AGENDADA', volante: '164709', unidad: '-', fechaCita: '2026-10-22T08:00:00-05:00', fechaGarita: null, fechaIngresoDespacho: null, fechaCompletado: null, fuente: 'FALCON' });
const movimiento = (id: string) => ({ empresa: '00001', movimiento: id, volante: '000000000164709', placa: 'ABC123', contenedor: null, fechaGarita: '2026-10-22T04:00:00-05:00', fechaIngresoAlmacen: null, fechaSalidaAlmacen: null });

test('agrupa volante repetido sin asignar movimientos a una cita individual', () => {
  const group = crearFlujoOperativo([cita('1'), cita('2')], [movimiento('a'), movimiento('b')])[0];
  assert.equal(group.tipo, 'MULTIPLE');
  assert.equal(group.citas.length, 2);
  assert.equal(group.movimientos.length, 2);
});

test('marca como único solamente una cita y un movimiento del mismo volante', () => {
  const group = crearFlujoOperativo([cita('1')], [movimiento('a')])[0];
  assert.equal(group.tipo, 'UNICO');
});
