import type { Modalidad, Operacion, ResumenModalidad } from './domain.js';
import type { GitsDailyFlowItem } from './gits.js';

export type TipoGrupoFlujo = 'UNICO' | 'MULTIPLE' | 'SIN_CITA' | 'SIN_MOVIMIENTO';

export interface GrupoFlujoOperativo {
  volante: string;
  modalidad: Modalidad | null;
  citas: Operacion[];
  movimientos: GitsDailyFlowItem[];
  tipo: TipoGrupoFlujo;
  aereosAsociados: Array<{
    volante: string;
    placa: string;
    fechaGarita: string;
    primerPesaje: string | null;
    segundoPesaje: string | null;
    pesoDeclarado: number | null;
    diferenciaMinutos: number;
  }>;
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

function keyFecha(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  return typeof value === 'string' ? value : '';
}

function placaNormalizada(value: string | null | undefined) {
  const placa = value?.trim().replace(/[-\s]/g, '').toUpperCase() ?? '';
  return placa && placa !== '-' ? placa : null;
}

function diferenciaMinutos(a: string, b: string) {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 60_000;
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
      aereosAsociados: [],
      tipo: citasDelVolante.length === 0 ? 'SIN_CITA'
        : movimientosDelVolante.length === 0 ? 'SIN_MOVIMIENTO'
          : citasDelVolante.length === 1 && movimientosDelVolante.length === 1 ? 'UNICO' : 'MULTIPLE'
    };
  });
  const maritimas = groups.filter((group) => group.modalidad === 'FCL' || group.modalidad === 'LCL');
  const aereas = citas.filter((cita) => cita.modalidad === 'AEREO' && placaNormalizada(cita.unidad) && cita.fechaGarita);
  for (const aereo of aereas) {
    const plate = placaNormalizada(aereo.unidad);
    if (!plate || !aereo.fechaGarita) continue;
    const candidatas = maritimas.filter((group) => {
      // Falcon puede no tener placa en la cita marítima; GITS la confirma
      // cuando el vínculo volante-movimiento ya es único.
      const mismaPlaca = group.citas.some((maritima) => placaNormalizada(maritima.unidad) === plate)
        || group.movimientos.some((movimiento) => placaNormalizada(movimiento.placa) === plate);
      const garitaCoincidente = group.citas.some((maritima) => Boolean(maritima.fechaGarita)
        && fechaLima(maritima.fechaGarita) === fechaLima(aereo.fechaGarita)
        && diferenciaMinutos(maritima.fechaGarita!, aereo.fechaGarita!) <= 10);
      return mismaPlaca && garitaCoincidente;
    });
    // Se enlaza solo si hay una operación marítima inequívoca en la ventana aprobada por ATC.
    if (candidatas.length !== 1) continue;
    const destinataria = candidatas[0];
    const registrosGarita = destinataria.citas
      .map((cita) => cita.fechaGarita)
      .filter((fecha): fecha is string => Boolean(fecha) && fechaLima(fecha) === fechaLima(aereo.fechaGarita))
      .sort((a, b) => diferenciaMinutos(a, aereo.fechaGarita!) - diferenciaMinutos(b, aereo.fechaGarita!));
    destinataria.aereosAsociados.push({
      volante: aereo.volante,
      placa: aereo.unidad,
      fechaGarita: aereo.fechaGarita,
      primerPesaje: aereo.fechaIngresoDespacho,
      segundoPesaje: aereo.fechaCompletado,
      pesoDeclarado: aereo.pesoDeclarado ?? null,
      diferenciaMinutos: diferenciaMinutos(registrosGarita[0] ?? aereo.fechaGarita, aereo.fechaGarita)
    });
  }
  return groups.sort((a, b) =>
    keyFecha(b.movimientos.at(-1)?.fechaGarita ?? b.citas.at(-1)?.fechaCita)
      .localeCompare(keyFecha(a.movimientos.at(-1)?.fechaGarita ?? a.citas.at(-1)?.fechaCita))
  );
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
