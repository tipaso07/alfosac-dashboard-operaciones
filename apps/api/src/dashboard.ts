import type { Operacion, ResumenModalidad, Modalidad } from './domain.js';

const modalidades: Modalidad[] = ['FCL', 'LCL', 'BB', 'AEREO'];

export function crearResumen(operaciones: Operacion[]): ResumenModalidad[] {
  return modalidades.map((modalidad) => {
    const items = operaciones.filter((item) => item.modalidad === modalidad);
    return {
      modalidad,
      agendadas: items.filter((item) => item.estado === 'AGENDADA').length,
      garita: items.filter((item) => item.estado === 'EN_GARITA').length,
      despacho: items.filter((item) => item.estado === 'EN_DESPACHO').length,
      completadas: items.filter((item) => item.estado === 'COMPLETADA').length,
      noCompletadas: items.filter((item) => item.estado === 'NO_COMPLETADA').length
    };
  });
}

