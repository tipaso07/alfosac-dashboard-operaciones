import type { Modalidad, Operacion } from './domain.js';

export type PeriodoReporte = 'DIARIO' | 'MENSUAL';
export type ModalidadReporte = Extract<Modalidad, 'FCL' | 'LCL'> | 'TODAS';

export interface FilaReporteOperativo {
  fecha: string | null;
  horaCita: string | null;
  modalidad: Modalidad;
  volante: string;
  placa: string;
  estado: Operacion['estado'];
  clasificacion: 'ATENDIDA' | 'NO_ATENDIDA' | 'PENDIENTE_ANULACION' | 'ANULADA' | 'PESAJE_LIBRE' | 'POR_CONFIRMAR';
}

export interface ReporteOperativo {
  periodo: PeriodoReporte;
  fecha: string;
  modalidad: ModalidadReporte;
  resumen: {
    programadas: number;
    atendidas: number;
    noAtendidas: number;
    pendientesAnulacion: number;
    anuladas: number;
    pesajesLibres: number;
    porConfirmar: number;
  };
  filas: FilaReporteOperativo[];
  nota: string;
}

function fechaLima(value: string | null) {
  if (!value) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date(value));
  const get = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function horaLima(value: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
}

function dentroDelPeriodo(date: string | null, period: PeriodoReporte, requested: string) {
  const normalized = fechaLima(date);
  if (!normalized) return false;
  return period === 'DIARIO' ? normalized === requested : normalized.slice(0, 7) === requested.slice(0, 7);
}

function clasificar(estado: Operacion['estado']): FilaReporteOperativo['clasificacion'] {
  if (estado === 'COMPLETADA') return 'ATENDIDA';
  if (estado === 'NO_COMPLETADA') return 'NO_ATENDIDA';
  if (estado === 'PENDIENTE_ANULACION') return 'PENDIENTE_ANULACION';
  if (estado === 'ANULADA') return 'ANULADA';
  if (estado === 'PESAJE_LIBRE') return 'PESAJE_LIBRE';
  return 'POR_CONFIRMAR';
}

/** Reporte de negocio: no interpreta un pesaje como atención de una cita. */
export function crearReporteOperativo(
  operaciones: Operacion[],
  periodo: PeriodoReporte,
  fecha: string,
  modalidad: ModalidadReporte
): ReporteOperativo {
  const candidatas = operaciones.filter((item) => {
    const fechaPrincipal = item.fechaCita ?? item.fechaGarita ?? item.fechaIngresoDespacho ?? item.fechaCompletado;
    return dentroDelPeriodo(fechaPrincipal, periodo, fecha)
      && (modalidad === 'TODAS' || item.modalidad === modalidad)
      && (item.modalidad === 'FCL' || item.modalidad === 'LCL');
  });
  const filas = candidatas.map((item) => ({
    fecha: fechaLima(item.fechaCita ?? item.fechaGarita ?? item.fechaIngresoDespacho ?? item.fechaCompletado),
    horaCita: horaLima(item.fechaCita),
    modalidad: item.modalidad,
    volante: item.volante,
    placa: item.unidad,
    estado: item.estado,
    clasificacion: clasificar(item.estado)
  })).sort((a, b) => `${a.fecha ?? ''}${a.horaCita ?? ''}${a.volante}`.localeCompare(`${b.fecha ?? ''}${b.horaCita ?? ''}${b.volante}`));

  const contar = (clasificacion: FilaReporteOperativo['clasificacion']) => filas.filter((item) => item.clasificacion === clasificacion).length;
  return {
    periodo, fecha, modalidad,
    resumen: {
      programadas: filas.length,
      atendidas: contar('ATENDIDA'),
      noAtendidas: contar('NO_ATENDIDA'),
      pendientesAnulacion: contar('PENDIENTE_ANULACION'),
      anuladas: contar('ANULADA'),
      pesajesLibres: contar('PESAJE_LIBRE'),
      porConfirmar: contar('POR_CONFIRMAR')
    },
    filas,
    nota: 'Atendida, anulada y pendiente de anulación solo se informan desde su estado de negocio. Un pesaje GITS no se interpreta como atención.'
  };
}

export function reporteACsv(report: ReporteOperativo) {
  const escape = (value: string | number | null) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const headers = ['Fecha', 'Hora de cita', 'Modalidad', 'Volante', 'Placa', 'Estado origen', 'Clasificación'];
  return [headers, ...report.filas.map((item) => [item.fecha, item.horaCita, item.modalidad, item.volante, item.placa, item.estado, item.clasificacion])]
    .map((row) => row.map(escape).join(','))
    .join('\r\n');
}
