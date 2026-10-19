import type { Operacion } from './domain.js';

const ahora = new Date();
const isoHaceMinutos = (minutos: number) => new Date(ahora.getTime() - minutos * 60_000).toISOString();

export const operacionesDemo: Operacion[] = [
  { id: 'op-001', modalidad: 'FCL', estado: 'EN_GARITA', volante: 'FCL-26001', unidad: 'BCT-451', fechaCita: isoHaceMinutos(18), fechaGarita: isoHaceMinutos(6), fechaIngresoDespacho: null, fechaCompletado: null, fuente: 'DEMO' },
  { id: 'op-002', modalidad: 'FCL', estado: 'EN_DESPACHO', volante: 'FCL-26002', unidad: 'T8W-932', fechaCita: isoHaceMinutos(75), fechaGarita: isoHaceMinutos(62), fechaIngresoDespacho: isoHaceMinutos(32), fechaCompletado: null, fuente: 'DEMO' },
  { id: 'op-003', modalidad: 'LCL', estado: 'AGENDADA', volante: 'LCL-11901', unidad: 'AYH-280', fechaCita: isoHaceMinutos(-20), fechaGarita: null, fechaIngresoDespacho: null, fechaCompletado: null, fuente: 'DEMO' },
  { id: 'op-004', modalidad: 'LCL', estado: 'NO_COMPLETADA', volante: 'LCL-11877', unidad: 'BRR-610', fechaCita: isoHaceMinutos(135), fechaGarita: null, fechaIngresoDespacho: null, fechaCompletado: null, fuente: 'DEMO' },
  { id: 'op-005', modalidad: 'BB', estado: 'COMPLETADA', volante: 'BB-5318', unidad: 'BZY-741', fechaCita: isoHaceMinutos(110), fechaGarita: isoHaceMinutos(98), fechaIngresoDespacho: isoHaceMinutos(72), fechaCompletado: isoHaceMinutos(25), fuente: 'DEMO' },
  { id: 'op-006', modalidad: 'AEREO', estado: 'EN_DESPACHO', volante: 'AR-82591', unidad: 'AER-043', fechaCita: isoHaceMinutos(48), fechaGarita: isoHaceMinutos(42), fechaIngresoDespacho: isoHaceMinutos(18), fechaCompletado: null, fuente: 'DEMO' }
];

