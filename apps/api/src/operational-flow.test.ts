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

test('separa una cita sin movimiento de un vínculo múltiple', () => {
  const group = crearFlujoOperativo([cita('1')], [])[0];
  assert.equal(group.tipo, 'SIN_MOVIMIENTO');
});

test('ordena grupos cuando Postgres devuelve una fecha como objeto Date', () => {
  const dated = { ...cita('1'), fechaCita: new Date('2026-10-22T08:00:00-05:00') } as unknown as Operacion;
  assert.equal(crearFlujoOperativo([dated], [movimiento('a')])[0]?.volante, '164709');
});

test('asocia Aéreo con Marítimo solo para la misma placa y hasta diez minutos en garita', () => {
  const maritima: Operacion = { ...cita('mar'), volante: '166180', unidad: 'CHJ827', fechaGarita: '2026-11-05T08:05:00-05:00' };
  const aereo: Operacion = {
    id: 'AR-24958', modalidad: 'AEREO', estado: 'EN_GARITA', volante: '83233', unidad: 'CHJ827',
    fechaCita: null, fechaGarita: '2026-11-05T08:04:00-05:00', fechaIngresoDespacho: '2026-11-05T08:12:00-05:00',
    fechaCompletado: '2026-11-05T09:22:00-05:00', pesoDeclarado: 142.5, fuente: 'FALCON'
  };
  const group = crearFlujoOperativo([maritima, aereo], []).find((item) => item.volante === '166180');
  assert.equal(group?.aereosAsociados.length, 1);
  assert.equal(group?.aereosAsociados[0]?.volante, '83233');
});

test('no asocia el Aéreo cuando supera diez minutos de diferencia en garita', () => {
  const maritima: Operacion = { ...cita('mar'), volante: '166180', unidad: 'CHJ827', fechaGarita: '2026-11-05T08:05:00-05:00' };
  const aereo: Operacion = {
    id: 'AR-24958', modalidad: 'AEREO', estado: 'EN_GARITA', volante: '83233', unidad: 'CHJ827',
    fechaCita: null, fechaGarita: '2026-11-05T08:16:00-05:00', fechaIngresoDespacho: null,
    fechaCompletado: null, pesoDeclarado: 142.5, fuente: 'FALCON'
  };
  const group = crearFlujoOperativo([maritima, aereo], []).find((item) => item.volante === '166180');
  assert.equal(group?.aereosAsociados.length, 0);
});
