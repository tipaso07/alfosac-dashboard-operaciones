import type { Modalidad, Operacion, ResumenModalidad } from './domain.js';
import type { GitsDailyFlowItem } from './gits.js';

export type TipoGrupoFlujo = 'UNICO' | 'MULTIPLE' | 'SIN_CITA';

export interface GrupoFlujoOperativo {
  volante: string;
  modalidad: Modalidad | null;
  citas: Operacion[];
  movimientos: GitsDailyFlowItem[];
  tipo: TipoGrupoFlujo;
}

function volanteNormalizado(value: string | null | undefined) {
  const normalized = value?.trim().replace(/\s+/g, '').replace(/^0+(?=\d)/, '') ?? '';
  return normalized || null;
}

function fechaLima(value: string | null) {
  if (!value) return null;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** Agrupa sin atribuir un movimiento físico a una cita cuando no es único. */
export function crearFlujoOperativo(citas: Operacion[], movimientos: GitsDailyFlowItem[]) {
  const citasPorVolante = new Map<string, Operacion[]>();
  for (const cita of citas) {
    const volante = volanteNormalizado(cita.volante);
    if (!volante) continue;
    citasPorVolante.set(volante, [...(citasPorVolante.get(volante) ?? []), cita]);
  }
  const movimientosPorVolante = new Map<string, GitsDailyFlowItem[]>();
  for (const movimiento of movimientos) {
    const volante = volanteNormalizado(movimiento.volante);
    if (!volante) continue;
    movimientosPorVolante.set(volante, [...(movimientosPorVolante.get(volante) ?? []), movimiento]);
  }

  const volantes = new Set([...citasPorVolante.keys(), ...movimientosPorVolante.keys()]);
  const groups: GrupoFlujoOperativo[] = [...volantes].map((volante) => {
    const citasDelVolante = citasPorVolante.get(volante) ?? [];
    const movimientosDelVolante = (movimientosPorVolante.get(volante) ?? []).sort((a, b) => (a.fechaGarita ?? '').localeCompare(b.fechaGarita ?? ''));
    const modalidades = [...new Set(citasDelVolante.map((cita) => cita.modalidad))];
    return {
      volante,
      modalidad: modalidades.length === 1 ? modalidades[0] : null,
      citas: citasDelVolante,
      movimientos: movimientosDelVolante,
      tipo: citasDelVolante.length === 0 ? 'SIN_CITA' : citasDelVolante.length === 1 && movimientosDelVolante.length === 1 ? 'UNICO' : 'MULTIPLE'
    };
  });
  return groups.sort((a, b) => (b.movimientos.at(-1)?.fechaGarita ?? b.citas.at(-1)?.fechaCita ?? '').localeCompare(a.movimientos.at(-1)?.fechaGarita ?? a.citas.at(-1)?.fechaCita ?? ''));
}

export function resumenDeFlujo(citas: Operacion[], groups: GrupoFlujoOperativo[], reportDate: string): ResumenModalidad[] {
  const modalities: Modalidad[] = ['FCL', 'LCL', 'BB', 'AEREO'];
  return modalities.map((modalidad) => ({
    modalidad,
    agendadas: citas.filter((cita) => cita.modalidad === modalidad && cita.fechaCita && fechaLima(cita.fechaCita) === reportDate).length,
    garita: groups.filter((group) => group.modalidad === modalidad).flatMap((group) => group.movimientos).filter((event) => fechaLima(event.fechaGarita) === reportDate).length,
    despacho: citas.filter((cita) => cita.modalidad === modalidad && cita.fechaIngresoDespacho && fechaLima(cita.fechaIngresoDespacho) === reportDate).length,
    completadas: citas.filter((cita) => cita.modalidad === modalidad && cita.fechaCompletado && fechaLima(cita.fechaCompletado) === reportDate).length,
    noCompletadas: citas.filter((cita) => cita.modalidad === modalidad && cita.estado === 'NO_COMPLETADA').length
  }));
}
