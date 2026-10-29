import type { Operacion } from './domain.js';
import type { GitsDailyFlowItem } from './gits.js';

const ahora = new Date();
const isoHaceMinutos = (minutos: number) => new Date(ahora.getTime() - minutos * 60_000).toISOString();

export const operacionesDemo: Operacion[] = [
  { id: 'op-001', modalidad: 'FCL', estado: 'EN_GARITA', volante: 'FCL-26001', unidad: 'BCT-451', fechaCita: isoHaceMinutos(18), fechaGarita: isoHaceMinutos(6), fechaIngresoDespacho: null, fechaCompletado: null, fuente: 'DEMO' },
  { id: 'op-002', modalidad: 'FCL', estado: 'EN_DESPACHO', volante: 'FCL-26002', unidad: 'T8W-932', fechaCita: isoHaceMinutos(75), fechaGarita: isoHaceMinutos(62), fechaIngresoDespacho: isoHaceMinutos(32), fechaCompletado: null, fuente: 'DEMO' },
  { id: 'op-003', modalidad: 'LCL', estado: 'AGENDADA', volante: 'LCL-11901', unidad: 'AYH-280', fechaCita: isoHaceMinutos(-20), fechaGarita: null, fechaIngresoDespacho: null, fechaCompletado: null, fuente: 'DEMO' },
  { id: 'op-004', modalidad: 'LCL', estado: 'NO_COMPLETADA', volante: 'LCL-11877', unidad: 'BRR-610', fechaCita: isoHaceMinutos(135), fechaGarita: null, fechaIngresoDespacho: null, fechaCompletado: null, fuente: 'DEMO' },
  { id: 'op-007', modalidad: 'LCL', estado: 'PENDIENTE_ANULACION', volante: 'LCL-11751', unidad: 'C2K-140', fechaCita: isoHaceMinutos(185), fechaGarita: null, fechaIngresoDespacho: null, fechaCompletado: null, fuente: 'DEMO' },
  { id: 'op-008', modalidad: 'LCL', estado: 'PESAJE_LIBRE', volante: 'LCL-11723', unidad: 'A6V-378', fechaCita: isoHaceMinutos(125), fechaGarita: null, fechaIngresoDespacho: null, fechaCompletado: null, fuente: 'DEMO' },
  { id: 'op-009', modalidad: 'FCL', estado: 'ANULADA', volante: 'FCL-25962', unidad: '—', fechaCita: isoHaceMinutos(220), fechaGarita: null, fechaIngresoDespacho: null, fechaCompletado: null, fuente: 'DEMO' },
  { id: 'op-005', modalidad: 'BB', estado: 'COMPLETADA', volante: 'BB-5318', unidad: 'BZY-741', fechaCita: isoHaceMinutos(110), fechaGarita: isoHaceMinutos(98), fechaIngresoDespacho: isoHaceMinutos(72), fechaCompletado: isoHaceMinutos(25), fuente: 'DEMO' },
  { id: 'op-006', modalidad: 'AEREO', estado: 'EN_DESPACHO', volante: 'AR-82591', unidad: 'AER-043', fechaCita: isoHaceMinutos(48), fechaGarita: isoHaceMinutos(42), fechaIngresoDespacho: isoHaceMinutos(18), fechaCompletado: null, fuente: 'DEMO' }
];

/** Movimientos ficticios coherentes con las citas de demostración. */
export const movimientosDemo: GitsDailyFlowItem[] = [
  {
    empresa: 'DEMO', movimiento: 'DEMO-001', volante: 'FCL-26001', placa: 'BCT-451', contenedor: 'DEMO-FCL-01',
    fechaGarita: isoHaceMinutos(6), fechaSalidaBalanza: null, fechaIngresoAlmacen: null, fechaSalidaAlmacen: null,
    pesoInicial: 12_450, pesoFinal: null, pesoNetoBalanza: null, cantidadTarjas: null, pesoMercaderiaDeclarado: 8_100
  },
  {
    empresa: 'DEMO', movimiento: 'DEMO-002', volante: 'FCL-26002', placa: 'T8W-932', contenedor: 'DEMO-FCL-02',
    fechaGarita: isoHaceMinutos(62), fechaSalidaBalanza: null, fechaIngresoAlmacen: isoHaceMinutos(32), fechaSalidaAlmacen: null,
    pesoInicial: 9_820, pesoFinal: null, pesoNetoBalanza: null, cantidadTarjas: 4, pesoMercaderiaDeclarado: 5_700
  },
  {
    empresa: 'DEMO', movimiento: 'DEMO-005', volante: 'BB-5318', placa: 'BZY-741', contenedor: 'DEMO-BB-01',
    fechaGarita: isoHaceMinutos(98), fechaSalidaBalanza: isoHaceMinutos(25), fechaIngresoAlmacen: isoHaceMinutos(72), fechaSalidaAlmacen: isoHaceMinutos(25),
    pesoInicial: 7_100, pesoFinal: 10_350, pesoNetoBalanza: 3_250, cantidadTarjas: 6, pesoMercaderiaDeclarado: 3_245
  },
  {
    empresa: 'DEMO', movimiento: 'DEMO-006', volante: 'AR-82591', placa: 'AER-043', contenedor: null,
    fechaGarita: isoHaceMinutos(42), fechaSalidaBalanza: null, fechaIngresoAlmacen: isoHaceMinutos(18), fechaSalidaAlmacen: null,
    pesoInicial: 1_260, pesoFinal: null, pesoNetoBalanza: null, cantidadTarjas: null, pesoMercaderiaDeclarado: 730
  },
  {
    empresa: 'DEMO', movimiento: 'DEMO-008', volante: 'LCL-11723', placa: 'A6V-378', contenedor: null,
    fechaGarita: isoHaceMinutos(108), fechaSalidaBalanza: null, fechaIngresoAlmacen: null, fechaSalidaAlmacen: null,
    pesoInicial: 4_600, pesoFinal: null, pesoNetoBalanza: null, cantidadTarjas: 0, pesoMercaderiaDeclarado: 2_900
  }
];

