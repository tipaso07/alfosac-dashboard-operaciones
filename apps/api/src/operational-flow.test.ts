import test from 'node:test';
import assert from 'node:assert/strict';
import { crearFlujoOperativo } from './operational-flow.js';
import { esRetiroVacio } from './gits.js';
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

test('asocia un retiro vacío sin volante solo con la única cita de misma placa y garita previa', () => {
  const maritima: Operacion = { ...cita('vacío'), volante: '167732', unidad: 'BXR741', fechaGarita: '2026-11-18T12:57:00-05:00' };
  const retiroVacio = {
    ...movimiento('libre'), volante: null, placa: 'BXR741', fechaGarita: '2026-11-18T13:13:21-05:00',
    fechaSalidaBalanza: '2026-11-18T14:09:32-05:00', retiroVacio: true, observacion: 'SALE VACIO // CARGA ANCHA'
  };
  const group = crearFlujoOperativo([maritima], [retiroVacio])[0];
  assert.equal(group?.volante, '167732');
  assert.equal(group?.movimientos[0]?.retiroVacio, true);
});

test('conserva el retiro vacío en una cita anulada si no existe otra cita activa compatible', () => {
  const anulada: Operacion = { ...cita('anulada'), estado: 'ANULADA', volante: '167732', unidad: 'BXR741', fechaGarita: '2026-11-18T12:57:00-05:00' };
  const retiroVacio = {
    ...movimiento('libre'), volante: null, placa: 'BXR741', fechaGarita: '2026-11-18T13:13:21-05:00',
    fechaSalidaBalanza: '2026-11-18T14:09:32-05:00', retiroVacio: true, observacion: 'SALE VACIO // CARGA ANCHA'
  };
  const group = crearFlujoOperativo([anulada], [retiroVacio])[0];
  assert.equal(group?.volante, '167732');
  assert.equal(group?.movimientos[0]?.movimiento, 'libre');
});

test('enlaza un retiro reestibado por A.R. y descarta el pesaje consolidado del mismo volante', () => {
  const maritima: Operacion = { ...cita('aut'), volante: '168271', unidad: 'D6F807', autorizacionRetiro: '168741', fechaGarita: '2026-11-23T06:47:04-05:00' };
  const consolidado = { ...movimiento('total'), volante: '168271', placa: 'D6F807', fechaGarita: '2026-11-23T06:54:20-05:00', observacion: 'REESTIBADO // 62 BULTOS EN TOTAL' };
  const porcion = { ...movimiento('parte'), volante: null, placa: 'D6F807', fechaGarita: '2026-11-23T06:54:55-05:00', observacion: 'RETIRO REESTIBADO //AUT//168741// 48 BULTOS', autorizacionRetiro: '168741' };
  const group = crearFlujoOperativo([maritima], [consolidado, porcion])[0];
  assert.equal(group?.movimientos.length, 1);
  assert.equal(group?.movimientos[0]?.movimiento, 'parte');
});

test('considera retiro vacío el movimiento de Balanza Libre marcado como cancelado', () => {
  const maritima: Operacion = { ...cita('cancelada'), volante: '168573', unidad: 'F8R929', autorizacionRetiro: '169063', fechaGarita: '2026-11-23T13:00:00-05:00' };
  const retiroCancelado = {
    ...movimiento('libre-cancelado'), volante: null, placa: 'F8R929', fechaGarita: '2026-11-23T13:21:58-05:00',
    observacion: 'RETIRO AUT//169063// CANCELADO // A SE TIENE QUE DESGLOSAR LA MERCADERIA', autorizacionRetiro: '169063', retiroVacio: true
  };
  assert.equal(esRetiroVacio(retiroCancelado.observacion), true);
  const group = crearFlujoOperativo([maritima], [retiroCancelado])[0];
  assert.equal(group?.movimientos[0]?.volante, '168573');
  assert.equal(group?.movimientos[0]?.retiroVacio, true);
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

test('usa la placa del movimiento GITS cuando Falcon no la tiene en la cita marítima', () => {
  const maritima: Operacion = { ...cita('mar'), volante: '166180', unidad: '-', fechaGarita: '2026-11-05T08:05:00-05:00' };
  const aereo: Operacion = {
    id: 'AR-24958', modalidad: 'AEREO', estado: 'EN_GARITA', volante: '83233', unidad: 'CHJ827',
    fechaCita: null, fechaGarita: '2026-11-05T08:04:00-05:00', fechaIngresoDespacho: null,
    fechaCompletado: null, pesoDeclarado: 142.5, fuente: 'FALCON'
  };
  const gits = { ...movimiento('a'), volante: '000000000166180', placa: 'CHJ827', fechaGarita: '2026-11-05T08:12:00-05:00' };
  const group = crearFlujoOperativo([maritima, aereo], [gits]).find((item) => item.volante === '166180');
  assert.equal(group?.aereosAsociados.length, 1);
});
