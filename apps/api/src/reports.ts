import type { Modalidad, Operacion } from './domain.js';
import type { GitsDailyFlowItem } from './gits.js';

export type PeriodoReporte = 'DIARIO' | 'MENSUAL' | 'RANGO';
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
  hasta: string | null;
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
  estadisticas: {
    citasAgendadas: number;
    registroGarita: number;
    primerPesaje: number | null;
    salidaBalanza: number | null;
    esperaPromedioMinutos: number | null;
    atencionPromedioMinutos: number | null;
    gitsDisponible: boolean;
  };
  cierre: {
    atendidas: number | null;
    anuladas: number | null;
    sinAtencion: number | null;
    pendienteAnulacion: number | null;
    disponible: boolean;
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

function dentroDelPeriodo(date: string | null, period: PeriodoReporte, requested: string, hasta: string | null) {
  const normalized = fechaLima(date);
  if (!normalized) return false;
  if (period === 'DIARIO') return normalized === requested;
  if (period === 'MENSUAL') return normalized.slice(0, 7) === requested.slice(0, 7);
  return hasta !== null && normalized >= requested && normalized <= hasta;
}

function clasificar(estado: Operacion['estado']): FilaReporteOperativo['clasificacion'] {
  if (estado === 'COMPLETADA') return 'ATENDIDA';
  if (estado === 'NO_COMPLETADA') return 'NO_ATENDIDA';
  if (estado === 'PENDIENTE_ANULACION') return 'PENDIENTE_ANULACION';
  if (estado === 'ANULADA') return 'ANULADA';
  if (estado === 'PESAJE_LIBRE') return 'PESAJE_LIBRE';
  return 'POR_CONFIRMAR';
}

function volanteNormalizado(value: string | null | undefined) {
  return value?.trim().replace(/\s+/g, '').replace(/^0+(?=\d)/, '') ?? '';
}

function minutosEntre(inicio: string, fin: string) {
  const minutos = (new Date(fin).getTime() - new Date(inicio).getTime()) / 60_000;
  return Number.isFinite(minutos) && minutos >= 0 && minutos <= 24 * 60 ? minutos : null;
}

function promedio(values: number[]) {
  return values.length ? Math.round(values.reduce((total, value) => total + value, 0) / values.length) : null;
}

/** Reporte de negocio: no interpreta un pesaje como atención de una cita. */
export function crearReporteOperativo(
  operaciones: Operacion[],
  periodo: PeriodoReporte,
  fecha: string,
  modalidad: ModalidadReporte,
  movimientosGits: GitsDailyFlowItem[] | null = null,
  cierreFalcon: { anuladas: number; sinAtencion: number } | null = null,
  hasta: string | null = null
): ReporteOperativo {
  const candidatas = operaciones.filter((item) => {
    const fechaPrincipal = item.fechaCita ?? item.fechaGarita ?? item.fechaIngresoDespacho ?? item.fechaCompletado;
    return dentroDelPeriodo(fechaPrincipal, periodo, fecha, hasta)
      && (modalidad === 'TODAS' || item.modalidad === modalidad)
      && (item.modalidad === 'FCL' || item.modalidad === 'LCL');
  });
  // La placa de GITS corresponde a la unidad que efectivamente pasó por
  // balanza. Se prioriza frente a Falcon, que puede quedar sin placa aunque
  // el movimiento físico ya haya sido registrado.
  const placaPorVolante = new Map<string, string>();
  for (const movimiento of movimientosGits ?? []) {
    const volante = volanteNormalizado(movimiento.volante);
    const placa = movimiento.placa?.trim();
    if (volante && placa && placa !== '-') placaPorVolante.set(volante, placa);
  }
  const filas = candidatas.map((item) => ({
    fecha: fechaLima(item.fechaCita ?? item.fechaGarita ?? item.fechaIngresoDespacho ?? item.fechaCompletado),
    horaCita: horaLima(item.fechaCita),
    modalidad: item.modalidad,
    volante: item.volante,
    placa: placaPorVolante.get(volanteNormalizado(item.volante)) ?? item.unidad ?? '-',
    estado: item.estado,
    // Las cargas históricas previas podían conservar EN_DESPACHO aun con salida registrada.
    // La salida/completado es la evidencia operativa definitiva para el cierre del reporte.
    clasificacion: item.fechaCompletado ? 'ATENDIDA' : clasificar(item.estado)
  })).sort((a, b) => `${a.fecha ?? ''}${a.horaCita ?? ''}${a.volante}`.localeCompare(`${b.fecha ?? ''}${b.horaCita ?? ''}${b.volante}`));

  const contar = (clasificacion: FilaReporteOperativo['clasificacion']) => filas.filter((item) => item.clasificacion === clasificacion).length;
  const porVolante = new Map<string, Operacion[]>();
  for (const cita of candidatas) {
    const volante = volanteNormalizado(cita.volante);
    if (volante) porVolante.set(volante, [...(porVolante.get(volante) ?? []), cita]);
  }
  const movimientos = movimientosGits === null ? null : movimientosGits.filter((movimiento) => {
    const citas = porVolante.get(volanteNormalizado(movimiento.volante)) ?? [];
    return Boolean(movimiento.fechaGarita) && citas.some((cita) => cita.modalidad === 'FCL' || cita.modalidad === 'LCL');
  });
  const esperas = (movimientos ?? []).flatMap((movimiento) => {
    if (!movimiento.fechaGarita) return [];
    const citas = porVolante.get(volanteNormalizado(movimiento.volante)) ?? [];
    const opciones = citas
      .map((cita) => cita.fechaGarita ? minutosEntre(cita.fechaGarita, movimiento.fechaGarita!) : null)
      .filter((valor): valor is number => valor !== null);
    return opciones.length ? [Math.min(...opciones)] : [];
  });
  const atenciones = (movimientos ?? []).flatMap((movimiento) => movimiento.fechaGarita && movimiento.fechaSalidaBalanza
    ? [minutosEntre(movimiento.fechaGarita, movimiento.fechaSalidaBalanza)].filter((valor): valor is number => valor !== null)
    : []);
  const atendidas = movimientos === null ? null : new Set(
    movimientos
      .filter((movimiento) => Boolean(movimiento.fechaSalidaBalanza))
      .map((movimiento) => volanteNormalizado(movimiento.volante))
      .filter(Boolean)
  ).size;
  return {
    periodo, fecha, hasta, modalidad,
    resumen: {
      programadas: filas.length,
      atendidas: contar('ATENDIDA'),
      noAtendidas: contar('NO_ATENDIDA'),
      pendientesAnulacion: contar('PENDIENTE_ANULACION'),
      anuladas: contar('ANULADA'),
      pesajesLibres: contar('PESAJE_LIBRE'),
      porConfirmar: contar('POR_CONFIRMAR')
    },
    estadisticas: {
      citasAgendadas: candidatas.filter((item) => item.fechaCita && dentroDelPeriodo(item.fechaCita, periodo, fecha, hasta)).length,
      registroGarita: candidatas.filter((item) => item.fechaGarita && dentroDelPeriodo(item.fechaGarita, periodo, fecha, hasta)).length,
      primerPesaje: movimientos === null ? null : movimientos.length,
      salidaBalanza: movimientos === null ? null : movimientos.filter((item) => Boolean(item.fechaSalidaBalanza)).length,
      esperaPromedioMinutos: movimientos === null ? null : promedio(esperas),
      atencionPromedioMinutos: movimientos === null ? null : promedio(atenciones),
      gitsDisponible: movimientos !== null
    },
    cierre: {
      atendidas,
      anuladas: cierreFalcon?.anuladas ?? null,
      sinAtencion: cierreFalcon?.sinAtencion ?? null,
      pendienteAnulacion: cierreFalcon?.sinAtencion ?? null,
      disponible: movimientos !== null || cierreFalcon !== null
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
