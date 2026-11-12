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
  retiroConjunto?: {
    placa: string;
    volantes: string[];
    pesoDeclarado: number | null;
    pesoNetoBalanza: number | null;
    porcentajePeso: number | null;
  } | null;
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

function pesoNeto(movimiento: GitsDailyFlowItem) {
  if (movimiento.pesoNetoBalanza != null) return movimiento.pesoNetoBalanza;
  if (movimiento.pesoInicial != null && movimiento.pesoFinal != null) return Math.abs(movimiento.pesoFinal - movimiento.pesoInicial);
  return null;
}

function movimientosConfirmados(group: GrupoFlujoOperativo) {
  // Las anulaciones quedan como historial visual, pero no vuelven ambiguo el
  // vínculo de la única cita activa con su movimiento físico.
  const citasActivas = group.citas.filter((cita) => cita.estado !== 'ANULADA');
  return citasActivas.length === 1
    ? group.movimientos
    : [];
}

/**
 * Una misma UT puede retirar varios volantes LCL. Si comparten placa y su
 * primer pesaje ocurre en la ventana validada por ATC (10 minutos), el peso
 * debe compararse como viaje conjunto, nunca contra cada volante aislado.
 */
function marcarRetirosConjuntos(groups: GrupoFlujoOperativo[]) {
  const lcl = groups.filter((group) => group.modalidad === 'LCL');
  for (const group of lcl) {
    const movimientoReferencia = movimientosConfirmados(group).find((movimiento) => movimiento.placa && movimiento.fechaGarita);
    if (!movimientoReferencia?.placa || !movimientoReferencia.fechaGarita) continue;
    const placa = placaNormalizada(movimientoReferencia.placa);
    if (!placa) continue;
    const asociados = lcl.filter((candidate) => movimientosConfirmados(candidate).some((movimiento) =>
      placaNormalizada(movimiento.placa) === placa
      && Boolean(movimiento.fechaGarita)
      && diferenciaMinutos(movimiento.fechaGarita!, movimientoReferencia.fechaGarita!) <= 10
    ));
    if (asociados.length < 2) continue;

    const movimientos = [...new Map(asociados
      .flatMap((candidate) => movimientosConfirmados(candidate))
      .filter((movimiento) => placaNormalizada(movimiento.placa) === placa)
      .map((movimiento) => [`${movimiento.empresa}:${movimiento.movimiento}`, movimiento])
    ).values()];
    const netos = movimientos.map(pesoNeto);
    const declarados = asociados.map((candidate) => candidate.citas
      .map((cita) => cita.pesoDeclarado)
      .find((peso): peso is number => peso != null));
    const pesoNetoBalanza = netos.every((peso): peso is number => peso != null)
      ? netos.reduce((total, peso) => total + peso, 0)
      : null;
    const pesoDeclarado = declarados.every((peso): peso is number => peso != null)
      ? declarados.reduce((total, peso) => total + peso, 0)
      : null;
    const porcentajePeso = pesoNetoBalanza != null && pesoDeclarado != null && pesoDeclarado > 0
      ? Math.abs(pesoNetoBalanza - pesoDeclarado) / pesoDeclarado
      : null;
    const resumen = { placa, volantes: asociados.map((candidate) => candidate.volante).sort(), pesoDeclarado, pesoNetoBalanza, porcentajePeso };
    asociados.forEach((candidate) => { candidate.retiroConjunto = resumen; });
  }
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
  marcarRetirosConjuntos(groups);
  return groups.sort((a, b) =>
    keyFecha(b.movimientos.at(-1)?.fechaGarita ?? b.citas.at(-1)?.fechaCita)
      .localeCompare(keyFecha(a.movimientos.at(-1)?.fechaGarita ?? a.citas.at(-1)?.fechaCita))
  );
}

export function resumenDeFlujo(citas: Operacion[], groups: GrupoFlujoOperativo[], reportDate: string): ResumenModalidad[] {
  const modalities: Modalidad[] = ['FCL', 'LCL', 'BB', 'AEREO'];
  return modalities.map((modalidad) => {
    // Las anuladas se conservan para trazabilidad visual, pero no son citas
    // agendadas ni deben alimentar los indicadores operativos.
    const citasDeModalidad = citas.filter((cita) => cita.modalidad === modalidad && cita.estado !== 'ANULADA');
    // Un mismo camión puede atender más de un volante. El movimiento se
    // muestra en cada volante relacionado, pero se cuenta una sola vez en
    // los indicadores físicos de balanza.
    const movimientosUnicos = [...new Map(
      groups
        .filter((group) => group.modalidad === modalidad)
        .flatMap((group) => group.movimientos)
        .map((movement) => [`${movement.empresa}:${movement.movimiento}`, movement])
    ).values()];
    return {
      modalidad,
      // Cita y registro se originan en Falcon; los pesajes físicos, en GITS.
      // Así los indicadores superiores representan los mismos hitos de las filas por horario.
      agendadas: citasDeModalidad.filter((cita) => cita.fechaCita && fechaLima(cita.fechaCita) === reportDate).length,
      garita: citasDeModalidad.filter((cita) => cita.fechaGarita && fechaLima(cita.fechaGarita) === reportDate).length,
      despacho: movimientosUnicos.filter((event) => event.fechaGarita && fechaLima(event.fechaGarita) === reportDate).length,
      completadas: movimientosUnicos.filter((event) => event.fechaSalidaBalanza && fechaLima(event.fechaSalidaBalanza) === reportDate).length,
      noCompletadas: citasDeModalidad.filter((cita) => cita.estado === 'NO_COMPLETADA').length
    };
  });
}
