import type { Operacion, ResumenModalidad, Modalidad } from './domain.js';

const modalidades: Modalidad[] = ['FCL', 'LCL', 'BB', 'AEREO'];

function fechaLima(value: string | null) {
  if (!value) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date(value));
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function crearResumen(operaciones: Operacion[], reportDate?: string): ResumenModalidad[] {
  return modalidades.map((modalidad) => {
    const items = operaciones.filter((item) => item.modalidad === modalidad);
    return {
      modalidad,
      // Una cita sigue contando como programada aunque posteriormente llegue a garita.
      agendadas: items.filter((item) => item.fechaCita && (!reportDate || fechaLima(item.fechaCita) === reportDate)).length,
      garita: items.filter((item) => item.fechaGarita && (!reportDate || fechaLima(item.fechaGarita) === reportDate)).length,
      despacho: items.filter((item) => item.fechaIngresoDespacho && (!reportDate || fechaLima(item.fechaIngresoDespacho) === reportDate)).length,
      completadas: items.filter((item) => item.fechaCompletado && (!reportDate || fechaLima(item.fechaCompletado) === reportDate)).length,
      noCompletadas: items.filter((item) => item.estado === 'NO_COMPLETADA').length
    };
  });
}

