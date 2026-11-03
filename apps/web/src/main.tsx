import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

type Modalidad = 'FCL' | 'LCL' | 'BB' | 'AEREO';
type Estado = 'AGENDADA' | 'EN_GARITA' | 'EN_DESPACHO' | 'COMPLETADA' | 'NO_COMPLETADA' | 'PENDIENTE_ANULACION' | 'ANULADA' | 'PESAJE_LIBRE';

type Operacion = {
  id: string;
  modalidad: Modalidad;
  estado: Estado;
  volante: string;
  unidad: string;
  fechaCita: string | null;
  fechaGarita: string | null;
  fechaIngresoDespacho: string | null;
  fechaCompletado: string | null;
};

type Resumen = {
  modalidad: Modalidad;
  agendadas: number;
  garita: number;
  despacho: number;
  completadas: number;
  noCompletadas: number;
};

type MovimientoFisico = { movimiento: string; placa: string | null; contenedor: string | null; fechaGarita: string | null; fechaIngresoAlmacen: string | null; fechaSalidaAlmacen: string | null; fechaSalidaBalanza: string | null; pesoInicial: number | null; pesoFinal: number | null; pesoNetoBalanza: number | null; pesoMercaderiaDeclarado: number | null };
type GrupoFlujo = { volante: string; modalidad: Modalidad | null; citas: Operacion[]; movimientos: MovimientoFisico[]; tipo: 'UNICO' | 'MULTIPLE' | 'SIN_CITA' };
type IncidenteOperativo = { modalidades: Modalidad[]; message: string };
/** El seguimiento mantiene separados los hitos Falcon de los pesajes GITS. */
type EstadoSeguimiento = 'PROGRAMADA' | 'PROXIMA_GARITA' | 'CITA_SIN_GARITA' | 'EN_GARITA' | 'GARITA_SIN_INGRESO' | 'VINCULO_PENDIENTE' | 'EN_BALANZA' | 'BALANZA_SIN_SALIDA' | 'EN_DESPACHO' | 'INGRESO_SIN_SALIDA' | 'PESO_OBSERVADO' | 'INCIDENCIA_OPERATIVA';
type SeguimientoLlegada = { id: string; volante: string; modalidad: Modalidad; fechaCita: string; placa: string | null; estado: EstadoSeguimiento; minutosRetraso: number; fechaReferencia: string; porcentajePeso?: number | null };
type ResumenSeguimiento = { proximas: number; criticas: number; revisar: number; pesoObservado: number };
type ReporteOperativo = {
  periodo: 'DIARIO' | 'MENSUAL'; fecha: string; modalidad: 'TODAS' | 'FCL' | 'LCL';
  resumen: { programadas: number; atendidas: number; noAtendidas: number; pendientesAnulacion: number; anuladas: number; pesajesLibres: number; porConfirmar: number };
  filas: Array<{ fecha: string | null; horaCita: string | null; modalidad: Modalidad; volante: string; placa: string; estado: Estado; clasificacion: string }>;
  nota: string;
};
type DisponibilidadHistorica = {
  fecha: string;
  capturadaEn: string;
  fuente: string;
  modalidades: Array<{ modalidad: 'FCL' | 'LCL' | 'BB'; horas: Array<{ hora: number; cuposDisponibles: number | null }> }>;
};

const minutosRojoCitaSinGarita = 30;
const minutosNaranjaCitaSinGarita = 45;
const minutosRojoGaritaSinIngreso = 45;
const minutosNaranjaGaritaSinIngreso = 31;
const minutosRojoBalanzaSinSalida = 45;
const minutosNaranjaBalanzaSinSalida = 31;
const minutosRojoIngresoSinSalida = 90;
const minutosNaranjaIngresoSinSalida = 45;
const toleranciaPeso = 0.03;

const orden: Modalidad[] = ['FCL', 'LCL', 'BB', 'AEREO'];
const rotationMs = 15_000;
const alertRotationMs = 25_000;
const tvPageRows = 8;
const nombres: Record<Modalidad, string> = {
  FCL: 'FCL importación',
  LCL: 'LCL importación',
  BB: 'BB importación',
  AEREO: 'Aéreo / A.R.'
};

const demoResumen: Resumen[] = [
  { modalidad: 'FCL', agendadas: 0, garita: 1, despacho: 1, completadas: 0, noCompletadas: 0 },
  { modalidad: 'LCL', agendadas: 1, garita: 0, despacho: 0, completadas: 0, noCompletadas: 1 },
  { modalidad: 'BB', agendadas: 0, garita: 0, despacho: 0, completadas: 1, noCompletadas: 0 },
  { modalidad: 'AEREO', agendadas: 0, garita: 0, despacho: 1, completadas: 0, noCompletadas: 0 }
];

function App() {
  const tv = window.location.pathname === '/tv';
  const [resumen, setResumen] = useState<Resumen[]>(demoResumen);
  const [operaciones, setOperaciones] = useState<Operacion[]>([]);
  const [grupos, setGrupos] = useState<GrupoFlujo[]>([]);
  const [pendientes, setPendientes] = useState<Operacion[]>([]);
  const [updatedAt, setUpdatedAt] = useState(new Date().toISOString());
  const [reportDate, setReportDate] = useState<string | null>(null);
  const [dataMode, setDataMode] = useState<'demo' | 'reportes'>('demo');
  const [indice, setIndice] = useState(0);
  const [alertaPriorizada, setAlertaPriorizada] = useState<string | null>(null);
  const [incidentes, setIncidentes] = useState<IncidenteOperativo[]>([]);

  useEffect(() => {
    const cargar = async () => {
      try {
        const respuestas = await Promise.all([fetch('/api/dashboard/summary'), fetch('/api/dashboard/operations'), fetch('/api/dashboard/pending-arrivals'), fetch('/api/dashboard/flow')]);
        if (!respuestas.every((response) => response.ok)) return;
        const summaryData = await respuestas[0].json() as { mode: 'demo' | 'reportes'; summary: Resumen[]; updatedAt: string; reportDate: string | null };
        const operationsData = await respuestas[1].json() as { operations: Operacion[]; reportDate: string | null };
        const pendingData = await respuestas[2].json() as { operations: Operacion[] };
        const flowData = await respuestas[3].json() as { groups: GrupoFlujo[]; incidents?: IncidenteOperativo[] };
        setResumen(summaryData.summary);
        setOperaciones(operationsData.operations);
        setPendientes(pendingData.operations);
        setGrupos(flowData.groups);
        setIncidentes(flowData.incidents ?? []);
        setUpdatedAt(summaryData.updatedAt);
        setReportDate(summaryData.reportDate ?? operationsData.reportDate ?? null);
        setDataMode(summaryData.mode);
      } catch {
        // Se conserva el último dato visible si la API se reinicia.
      }
    };

    void cargar();
    const refresh = window.setInterval(() => void cargar(), 30_000);
    return () => window.clearInterval(refresh);
  }, []);

  const modalidadesEnIncidencia = useMemo(() => new Set(incidentes.flatMap((item) => item.modalidades)), [incidentes]);
  const seguimiento = useMemo(() => crearSeguimientoLlegadas(grupos, reportDate, new Date(), modalidadesEnIncidencia), [grupos, reportDate, updatedAt, modalidadesEnIncidencia]);
  const detallesTv = useMemo(() => Object.fromEntries(orden.map((modalidad) => [
    modalidad,
    crearDetalleFlujo(grupos.filter((group) => group.modalidad === modalidad), reportDate, seguimiento.filter((item) => item.modalidad === modalidad))
  ])) as Record<Modalidad, DetalleHora[]>, [grupos, reportDate, seguimiento]);
  const modalidadesConAlerta = useMemo(() => orden.filter((item) => seguimiento.some((alerta) => alerta.modalidad === item && esCritico(alerta.estado))), [seguimiento]);
  const resumenSeguimiento = useMemo(() => crearResumenSeguimiento(seguimiento), [seguimiento]);
  const claveAlertas = modalidadesConAlerta.join('|');
  const prioridadActiva = Boolean(tv && claveAlertas && alertaPriorizada !== claveAlertas);

  useEffect(() => {
    if (!tv) return;
    if (claveAlertas && alertaPriorizada !== claveAlertas) {
      setIndice(orden.indexOf(modalidadesConAlerta[0]));
      const prioridad = window.setTimeout(() => setAlertaPriorizada(claveAlertas), alertRotationMs);
      return () => window.clearTimeout(prioridad);
    }
    if (!claveAlertas && alertaPriorizada !== null) setAlertaPriorizada(null);
    const rotate = window.setInterval(() => setIndice((actual) => (actual + 1) % orden.length), rotationMs);
    return () => window.clearInterval(rotate);
  }, [tv, claveAlertas, alertaPriorizada, modalidadesConAlerta]);

  const modalidad = orden[indice];
  const summary = resumen.find((item) => item.modalidad === modalidad) ?? demoResumen[indice];
  const detalle = detallesTv[modalidad];
  const alertaActiva = modalidadesConAlerta.includes(modalidad);
  const seguimientoModalidad = seguimiento.filter((item) => item.modalidad === modalidad);
  const resumenModalidad = resumenSeguimiento[modalidad];

  return tv
    ? <TvScreen modalidad={modalidad} summary={summary} detalle={detalle} seguimiento={seguimientoModalidad} resumenSeguimiento={resumenModalidad} updatedAt={updatedAt} reportDate={reportDate} indice={indice} alertaActiva={alertaActiva} prioridadAlerta={prioridadActiva && alertaActiva} incidentes={incidentes} />
    : <InternalScreen resumen={resumen} grupos={grupos} seguimiento={seguimiento} resumenSeguimiento={resumenSeguimiento} updatedAt={updatedAt} reportDate={reportDate} dataMode={dataMode} incidentes={incidentes} />;
}

function TvScreen({ modalidad, summary, detalle, seguimiento, resumenSeguimiento, updatedAt, reportDate, indice, alertaActiva, prioridadAlerta, incidentes }: {
  modalidad: Modalidad;
  summary: Resumen;
  detalle: DetalleHora[];
  seguimiento: SeguimientoLlegada[];
  resumenSeguimiento: ResumenSeguimiento;
  updatedAt: string;
  reportDate: string | null;
  indice: number;
  alertaActiva: boolean;
  prioridadAlerta: boolean;
  incidentes: IncidenteOperativo[];
}) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(detalle.length / tvPageRows));
  const visibleRows = detalle.slice(page * tvPageRows, (page + 1) * tvPageRows);
  const alertRow = detalle.findIndex((item) => item.critical);
  const alertPage = alertRow >= 0 ? Math.floor(alertRow / tvPageRows) : 0;
  const pendientesPrioritarios = seguimiento
    .filter((item) => esCritico(item.estado))
    .sort((a, b) => b.minutosRetraso - a.minutosRetraso)
    .slice(0, 3);

  useEffect(() => { setPage(prioridadAlerta ? alertPage : 0); }, [modalidad, prioridadAlerta, alertPage]);
  useEffect(() => {
    if (prioridadAlerta || pageCount <= 1) return;
    const interval = window.setInterval(() => setPage((current) => (current + 1) % pageCount), 7_500);
    return () => window.clearInterval(interval);
  }, [pageCount, prioridadAlerta]);

  return (
    <main className="tv-screen">
      <header className="tv-header">
        <div>
          <p className="brand">ALMACENES FORWARDER S.A.C.</p>
          <h1>{nombres[modalidad]}</h1>
          {reportDate && <p>Información del {formatDate(reportDate)}</p>}
        </div>
        <div className="tv-clock">
          <strong>{formatHour(new Date().toISOString())}</strong>
          <span>Actualizado {formatHour(updatedAt)}</span>
          <a className="exit-tv" href="/">Salir TV</a>
        </div>
      </header>

      <section className="tv-summary">
        <IncidentNotice incidentes={incidentes} />
        {resumenSeguimiento.criticas > 0 && <div className="tv-alert"><strong>Atención requerida: {resumenSeguimiento.criticas} alerta(s) operativa(s)</strong><span>{pendientesPrioritarios.map((item) => `${item.volante} · ${etiquetaSeguimiento(item)}`).join('   |   ')}</span></div>}
        <section className="tv-kpis" aria-label="Resumen de la operación">
        {modalidad === 'AEREO' ? <>
          <Kpi label="A.R. atendidos" value={summary.despacho} />
          <Kpi label="Registro en garita" value="N/A" />
          <Kpi label="Seguimiento de llegada" value="N/A" />
          <Kpi label="Cierre validado" value="—" />
        </> : <>
          <Kpi label="Citas programadas" value={summary.agendadas} />
          <Kpi label="Registro en garita" value={summary.garita} />
          <Kpi label="Alertas críticas" value={resumenSeguimiento.criticas} />
          <Kpi label="Próximas alertas" value={resumenSeguimiento.proximas} />
        </>}
        </section>
      </section>

      <section className="tv-table-wrap">
        <h2>{modalidad === 'AEREO' ? 'Actividad por horario' : 'Seguimiento por horario'}</h2>
        <table>
          <thead>
            <tr>
              <th>Hora</th>
              <th>{modalidad === 'AEREO' ? 'A.R.' : 'Citas'}</th>
              <th>{modalidad === 'AEREO' ? 'Garita' : 'Garita Falcon'}</th>
              <th>{modalidad === 'AEREO' ? 'Ingreso' : 'Ingreso Falcon'}</th>
              <th>{modalidad === 'AEREO' ? 'Despacho' : 'Salida Falcon'}</th>
              {modalidad !== 'AEREO' && <th>Por revisar</th>}
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.length > 0 ? visibleRows.map((item) => (
              <tr key={item.hora} className={item.critical ? 'critical-row' : item.warning ? 'warning-row' : undefined}>
                <td>{item.hora}</td>
                <td>{item.citas}</td>
                <td>{item.garita}</td>
                <td>{modalidad === 'AEREO' ? item.ingreso : item.ingreso}</td>
                <td>{modalidad === 'AEREO' ? item.despacho : item.despacho}</td>
                {modalidad !== 'AEREO' && <td>{item.revisar}</td>}
                <td><span className={item.critical ? 'status status-alert' : item.warning ? 'status status-warning' : 'status'}>{item.critical ? `${item.pendientes} ALERTA${item.pendientes === 1 ? '' : 'S'}` : item.warning ? 'PRÓXIMA ALERTA' : item.incidencias ? 'INCIDENCIA GENERAL' : item.revisar ? `${item.revisar} REVISAR` : 'SIN ALERTA'}</span></td>
              </tr>
            )) : <tr><td colSpan={modalidad === 'AEREO' ? 6 : 7} className="empty">Sin operaciones para mostrar</td></tr>}
          </tbody>
        </table>
      </section>

      <footer className="tv-footer">
        <div className="rotation" aria-label="Rotación de operaciones">
          {orden.map((item, position) => <span className={position === indice ? 'active' : ''} key={item}>{nombres[item]}</span>)}
        </div>
        <p>{prioridadAlerta ? 'Alerta prioritaria · visible 25 segundos' : `${pageCount > 1 ? `Página ${page + 1} de ${pageCount} · ` : ''}Cambio automático cada 15 segundos`}</p>
      </footer>
    </main>
  );
}

function InternalScreen({ resumen, grupos, seguimiento, resumenSeguimiento, updatedAt, reportDate, dataMode, incidentes }: { resumen: Resumen[]; grupos: GrupoFlujo[]; seguimiento: SeguimientoLlegada[]; resumenSeguimiento: Record<Modalidad, ResumenSeguimiento>; updatedAt: string; reportDate: string | null; dataMode: 'demo' | 'reportes'; incidentes: IncidenteOperativo[] }) {
  const [filtro, setFiltro] = useState<Modalidad | 'TODAS'>('TODAS');
  const [vista, setVista] = useState<'RESUMEN' | 'LISTA'>('RESUMEN');
  const [seleccionado, setSeleccionado] = useState<GrupoFlujo | null>(null);
  const [busqueda, setBusqueda] = useState('');
  const [horaFiltro, setHoraFiltro] = useState('');
  const [situacionFiltro, setSituacionFiltro] = useState<'TODAS' | 'ALERTA' | 'PROXIMA' | 'SIN_MOVIMIENTOS' | 'PENDIENTE_BALANZA' | 'CON_SALIDA_BALANZA' | 'MULTIPLES'>('TODAS');
  const seguimientoPorCita = useMemo(() => new Map(seguimiento.map((item) => [item.id, item])), [seguimiento]);
  const gruposFiltrados = useMemo(() => grupos.filter((group) => {
    if (filtro !== 'TODAS' && group.modalidad !== filtro) return false;
    const texto = busqueda.trim().toLowerCase();
    const coincideTexto = !texto || [group.volante, ...group.citas.map((cita) => cita.unidad), ...group.movimientos.map((movimiento) => movimiento.placa ?? '')]
      .some((value) => value.toLowerCase().includes(texto));
    if (!coincideTexto) return false;
    const coincideHora = !horaFiltro || group.citas.some((cita) => cita.fechaCita && formatHourShort(cita.fechaCita) === horaFiltro);
    if (!coincideHora) return false;
    const estados = group.citas.map((cita) => seguimientoPorCita.get(cita.id)?.estado).filter((estado): estado is EstadoSeguimiento => Boolean(estado));
    if (situacionFiltro === 'ALERTA') return estados.some(esCritico);
    if (situacionFiltro === 'PROXIMA') return estados.some(esProximo);
    if (situacionFiltro === 'SIN_MOVIMIENTOS') return group.movimientos.length === 0;
    if (situacionFiltro === 'PENDIENTE_BALANZA') return group.movimientos.some((movimiento) => Boolean(movimiento.fechaGarita) && !movimiento.fechaSalidaBalanza);
    if (situacionFiltro === 'CON_SALIDA_BALANZA') return group.movimientos.some((movimiento) => Boolean(movimiento.fechaSalidaBalanza));
    if (situacionFiltro === 'MULTIPLES') return group.tipo === 'MULTIPLE';
    return true;
  }), [grupos, filtro, busqueda, horaFiltro, situacionFiltro, seguimientoPorCita]);
  const seguimientoFiltrado = filtro === 'TODAS' ? seguimiento : seguimiento.filter((item) => item.modalidad === filtro);
  const resumenHora = crearDetalleFlujo(gruposFiltrados, reportDate, seguimientoFiltrado);
  const alertas = seguimientoFiltrado.filter((item) => esCritico(item.estado) || esProximo(item.estado));
  const totales = resumen.reduce((acumulado, item) => ({
    agendadas: acumulado.agendadas + item.agendadas,
    garita: acumulado.garita + item.garita,
    despacho: acumulado.despacho + item.despacho,
    completadas: acumulado.completadas + item.completadas,
    noCompletadas: acumulado.noCompletadas + item.noCompletadas
  }), { agendadas: 0, garita: 0, despacho: 0, completadas: 0, noCompletadas: 0 });
  const seguimientoTotal = orden.reduce((total, modalidad) => ({
    criticas: total.criticas + resumenSeguimiento[modalidad].criticas,
    proximas: total.proximas + resumenSeguimiento[modalidad].proximas,
    pesoObservado: total.pesoObservado + resumenSeguimiento[modalidad].pesoObservado
  }), { criticas: 0, proximas: 0, pesoObservado: 0 });

  return (
    <main className="internal-screen">
      <header className="internal-header">
        <div>
          <p className="brand">ALMACENES FORWARDER S.A.C.</p>
          <h1>Dashboard operativo</h1>
          {reportDate && <p>Información del {formatDate(reportDate)}</p>}
        </div>
        <div className="internal-actions"><a className="tv-mode-button" href="/tv"><TvIcon />Modo TV</a><p>{dataMode === 'reportes' ? 'Datos importados' : 'Modo demostración'} · actualizado {formatHour(updatedAt)}</p></div>
      </header>

      <section className="internal-kpis" aria-label="Resumen general">
        <Kpi label="Citas / A.R." value={totales.agendadas} />
        <Kpi label="Registro en garita" value={totales.garita} />
        <Kpi label="Alertas críticas" value={seguimientoTotal.criticas} />
        <Kpi label="Peso por validar" value={seguimientoTotal.pesoObservado} />
      </section>

      <IncidentNotice incidentes={incidentes} />

      <section className="operations-panel">
        <div className="panel-heading">
          <div>
            <p className="brand">OPERACIONES</p>
            <h2>Seguimiento operativo</h2>
          </div>
          <p>{gruposFiltrados.length} volante(s)</p>
        </div>

        <div className="toolbar-row">
          <div className="filter-row" aria-label="Filtrar por operación">
            <button className={filtro === 'TODAS' ? 'selected' : ''} onClick={() => setFiltro('TODAS')}>Todas</button>
            {orden.map((item) => <button className={filtro === item ? 'selected' : ''} key={item} onClick={() => setFiltro(item)}>{nombres[item]}</button>)}
          </div>
          <div className="view-row" aria-label="Elegir vista">
            <button className={vista === 'RESUMEN' ? 'selected' : ''} onClick={() => setVista('RESUMEN')} title="Resumen agrupado por hora" aria-label="Resumen agrupado por hora">
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/></svg>
            </button>
            <button className={vista === 'LISTA' ? 'selected' : ''} onClick={() => setVista('LISTA')} title="Lista detallada" aria-label="Lista detallada">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M5 12h14M5 17h14"/></svg>
            </button>
          </div>
        </div>

        <div className="advanced-filters" aria-label="Filtros detallados">
          <label>Buscar volante o placa<input value={busqueda} onChange={(event) => setBusqueda(event.target.value)} placeholder="Ej. 162866 o AYK848" /></label>
          <label>Hora de cita<input type="time" value={horaFiltro} onChange={(event) => setHoraFiltro(event.target.value)} /></label>
          <label>Situación<select value={situacionFiltro} onChange={(event) => setSituacionFiltro(event.target.value as typeof situacionFiltro)}>
            <option value="TODAS">Todas</option><option value="ALERTA">Alerta activa</option><option value="PROXIMA">Próxima alerta</option>
            <option value="SIN_MOVIMIENTOS">Sin movimientos GITS</option><option value="PENDIENTE_BALANZA">Ingreso a balanza sin salida</option>
            <option value="CON_SALIDA_BALANZA">Con salida por balanza</option><option value="MULTIPLES">Vínculo múltiple</option>
          </select></label>
          {(busqueda || horaFiltro || situacionFiltro !== 'TODAS') && <button className="clear-filters" onClick={() => { setBusqueda(''); setHoraFiltro(''); setSituacionFiltro('TODAS'); }}>Limpiar filtros</button>}
        </div>

        <div className="operations-table-wrap">
          {vista === 'RESUMEN' ? <table className="operations-table">
            <thead><tr><th>Hora de cita</th><th>Citas / A.R.</th><th>Garita Falcon</th><th>Ingreso Falcon</th><th>Salida Falcon</th><th>Por revisar</th><th>Estado</th></tr></thead>
            <tbody>{resumenHora.length > 0 ? resumenHora.map((item) => (
              <tr key={item.hora} className={item.critical ? 'critical-row' : item.warning ? 'warning-row' : undefined}><td>{item.hora}</td><td>{item.citas}</td><td>{item.garita}</td><td>{item.ingreso}</td><td>{item.despacho}</td><td>{item.revisar}</td><td><span className={item.critical ? 'state-badge state-alert' : 'state-badge'}>{item.critical ? `${item.pendientes} alerta(s)` : item.warning ? 'Próxima alerta' : item.incidencias ? 'Incidencia general' : item.revisar ? 'Por revisar' : 'Sin alerta'}</span></td></tr>
            )) : <tr><td colSpan={7} className="empty">No hay operaciones para este filtro.</td></tr>}</tbody>
          </table> : <table className="operations-table detail-list">
            <thead>
              <tr>
                <th>Volante / A.R.</th><th>Modalidad</th><th>Cita</th><th>Garita Falcon</th><th>Ingreso Falcon</th><th>Salida Falcon</th>
                <th>Ingreso a balanza</th><th>Salida por balanza</th><th>Relación</th><th>Situación</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {gruposFiltrados.length > 0 ? gruposFiltrados.map((group) => (
                <tr key={group.volante}>
                  <td><strong>{group.volante}</strong></td>
                  <td>{group.modalidad ? nombres[group.modalidad] : 'Sin cita vinculada'}</td>
                  <td>{group.citas[0]?.fechaCita ? formatDateTime(group.citas[0].fechaCita) : '—'}{group.citas.length > 1 ? ` +${group.citas.length - 1}` : ''}</td>
                  <td>{group.citas[0]?.fechaGarita ? formatDateTime(group.citas[0].fechaGarita) : '—'}</td>
                  <td>{group.citas[0]?.fechaIngresoDespacho ? formatDateTime(group.citas[0].fechaIngresoDespacho) : '—'}</td>
                  <td>{group.citas[0]?.fechaCompletado ? formatDateTime(group.citas[0].fechaCompletado) : '—'}</td>
                  <td>{group.movimientos.at(-1)?.fechaGarita ? formatDateTime(group.movimientos.at(-1)!.fechaGarita!) : '—'}</td>
                  <td>{group.movimientos.at(-1)?.fechaSalidaBalanza ? formatDateTime(group.movimientos.at(-1)!.fechaSalidaBalanza!) : group.movimientos.length ? 'Pendiente' : '—'}</td>
                  <td><span className="state-badge">{group.tipo === 'UNICO' ? 'Vínculo único' : group.tipo === 'MULTIPLE' ? 'Múltiples movimientos' : 'Sin cita'}</span></td>
                  <td><GroupSituation group={group} seguimientoPorCita={seguimientoPorCita} /></td>
                  <td><button className="detail-button" onClick={() => setSeleccionado(group)}>Ver detalle</button></td>
                </tr>
              )) : <tr><td colSpan={11} className="empty">No hay operaciones para estos filtros.</td></tr>}
            </tbody>
          </table>}
        </div>
      </section>

      <ReportesPanel reportDate={reportDate} />
      <DisponibilidadHistoricaPanel reportDate={reportDate} />

      {seleccionado && <FlowModal group={seleccionado} onClose={() => setSeleccionado(null)} />}
    </main>
  );
}

function GroupSituation({ group, seguimientoPorCita }: { group: GrupoFlujo; seguimientoPorCita: Map<string, SeguimientoLlegada> }) {
  const estados = group.citas.map((cita) => seguimientoPorCita.get(cita.id)).filter((item): item is SeguimientoLlegada => Boolean(item));
  const alerta = estados.find((item) => esCritico(item.estado));
  const proxima = estados.find((item) => esProximo(item.estado));
  if (alerta) return <span className="state-badge state-alert">{etiquetaSeguimiento(alerta)}</span>;
  if (proxima) return <span className="state-badge state-warning">{etiquetaSeguimiento(proxima)}</span>;
  if (group.tipo === 'MULTIPLE') return <span className="state-badge state-warning">Requiere revisión</span>;
  if (!group.movimientos.length) return <span className="state-badge">Sin movimiento GITS</span>;
  if (group.movimientos.some((movement) => movement.fechaGarita && !movement.fechaSalidaBalanza)) return <span className="state-badge state-warning">Salida por balanza pendiente</span>;
  if (group.movimientos.some((movement) => movement.fechaSalidaBalanza)) return <span className="state-badge">Flujo GITS registrado</span>;
  return <span className="state-badge">Sin alerta activa</span>;
}

function ReportesPanel({ reportDate }: { reportDate: string | null }) {
  const [periodo, setPeriodo] = useState<'DIARIO' | 'MENSUAL'>('DIARIO');
  const [fecha, setFecha] = useState(reportDate ?? new Date().toISOString().slice(0, 10));
  const [modalidad, setModalidad] = useState<'TODAS' | 'FCL' | 'LCL'>('TODAS');
  const [reporte, setReporte] = useState<ReporteOperativo | null>(null);
  const [error, setError] = useState('');

  useEffect(() => { if (reportDate) setFecha(reportDate); }, [reportDate]);
  useEffect(() => {
    const params = new URLSearchParams({ periodo, fecha, modalidad });
    void fetch(`/api/reports/operations?${params}`)
      .then(async (response) => response.ok ? response.json() as Promise<ReporteOperativo> : Promise.reject(await response.json()))
      .then((value) => { setReporte(value); setError(''); })
      .catch((reason: { message?: string }) => { setReporte(null); setError(reason.message ?? 'No se pudo generar el reporte.'); });
  }, [periodo, fecha, modalidad]);

  const params = new URLSearchParams({ periodo, fecha, modalidad });
  return <section className="reports-panel">
    <div className="panel-heading"><div><p className="brand">REPORTES</p><h2>Cierre operativo FCL y LCL</h2></div><a className="detail-button" href={`/api/reports/operations.csv?${params}`}>Descargar CSV</a></div>
    <div className="reports-controls">
      <label>Período<select value={periodo} onChange={(event) => setPeriodo(event.target.value as 'DIARIO' | 'MENSUAL')}><option value="DIARIO">Diario</option><option value="MENSUAL">Mensual</option></select></label>
      <label>Fecha<input type={periodo === 'DIARIO' ? 'date' : 'month'} value={periodo === 'DIARIO' ? fecha : fecha.slice(0, 7)} onChange={(event) => setFecha(event.target.value)} /></label>
      <label>Modalidad<select value={modalidad} onChange={(event) => setModalidad(event.target.value as 'TODAS' | 'FCL' | 'LCL')}><option value="TODAS">FCL y LCL</option><option value="FCL">FCL</option><option value="LCL">LCL</option></select></label>
    </div>
    {error ? <p className="empty">{error}</p> : reporte ? <>
      <div className="report-kpis">
        <Kpi label="Programadas" value={reporte.resumen.programadas} /><Kpi label="Atendidas" value={reporte.resumen.atendidas} />
        <Kpi label="No atendidas" value={reporte.resumen.noAtendidas} /><Kpi label="Pendientes de anular" value={reporte.resumen.pendientesAnulacion} />
        <Kpi label="Anuladas" value={reporte.resumen.anuladas} /><Kpi label="Pesaje libre" value={reporte.resumen.pesajesLibres} />
      </div>
      <p className="report-note">{reporte.nota} {reporte.resumen.porConfirmar > 0 ? `${reporte.resumen.porConfirmar} cita(s) aún por confirmar.` : ''}</p>
      <div className="operations-table-wrap"><table className="operations-table"><thead><tr><th>Fecha</th><th>Hora</th><th>Modalidad</th><th>Volante</th><th>Placa</th><th>Estado</th></tr></thead><tbody>{reporte.filas.length ? reporte.filas.map((item) => <tr key={`${item.modalidad}-${item.volante}-${item.horaCita}`}><td>{item.fecha ?? '—'}</td><td>{item.horaCita ?? '—'}</td><td>{item.modalidad}</td><td>{item.volante}</td><td>{item.placa}</td><td><span className={item.clasificacion === 'NO_ATENDIDA' || item.clasificacion === 'PESAJE_LIBRE' ? 'state-badge state-alert' : 'state-badge'}>{item.clasificacion.replaceAll('_', ' ')}</span></td></tr>) : <tr><td colSpan={6} className="empty">No hay citas para este período.</td></tr>}</tbody></table></div>
    </> : <p className="empty">Cargando reporte…</p>}
  </section>;
}

function DisponibilidadHistoricaPanel({ reportDate }: { reportDate: string | null }) {
  const [fecha, setFecha] = useState(reportDate ?? new Date().toISOString().slice(0, 10));
  const [snapshot, setSnapshot] = useState<DisponibilidadHistorica | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { if (reportDate) setFecha(reportDate); }, [reportDate]);
  useEffect(() => {
    setCargando(true);
    void fetch(`/api/availability/history?date=${fecha}`)
      .then(async (response) => response.ok ? response.json() as Promise<{ snapshot: DisponibilidadHistorica | null }> : Promise.reject(await response.json()))
      .then((value) => { setSnapshot(value.snapshot); setError(''); })
      .catch((reason: { message?: string }) => { setSnapshot(null); setError(reason.message ?? 'No se pudo consultar el historial.'); })
      .finally(() => setCargando(false));
  }, [fecha]);

  return <section className="availability-panel">
    <div className="panel-heading"><div><p className="brand">DISPONIBILIDAD</p><h2>Historial de cupos publicados</h2></div><label>Fecha<input type="date" value={fecha} onChange={(event) => setFecha(event.target.value)} /></label></div>
    {error ? <p className="empty">{error}</p> : cargando ? <p className="empty">Consultando historial…</p> : !snapshot ? <p className="report-note">Aún no hay una captura guardada para esta fecha. El historial comenzará a poblarse cuando se habilite la captura programada desde la fuente publicada.</p> : <>
      <p className="report-note">Capturada {formatDateTime(snapshot.capturadaEn)} · fuente: {snapshot.fuente}</p>
      <div className="availability-grids">{snapshot.modalidades.map((modalidad) => <article key={modalidad.modalidad}>
        <h3>{modalidad.modalidad} importación</h3><div className="availability-hours">{modalidad.horas.map((item) => <span key={item.hora}><strong>{String(item.hora).padStart(2, '0')}:00</strong>{item.cuposDisponibles ?? '—'}</span>)}</div>
      </article>)}</div>
    </>}
  </section>;
}

function difference(start: string | null, end: string | null) {
  if (!start || !end) return '—';
  const minutes = Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60_000));
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function primaryDate(operation: Operacion) {
  return operation.fechaCita ?? operation.fechaIngresoDespacho ?? operation.fechaGarita;
}

function fechaLima(value: string | null) {
  if (!value) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date(value));
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function fechaOperacionEnReporte(operation: Operacion, reportDate: string | null) {
  const events = [operation.fechaCita, operation.fechaGarita, operation.fechaIngresoDespacho, operation.fechaCompletado];
  return events.find((value) => value && (!reportDate || fechaLima(value) === reportDate)) ?? primaryDate(operation);
}

function StateBadge({ estado }: { estado: Estado }) {
  const labels: Record<Estado, string> = {
    AGENDADA: 'Agendada',
    EN_GARITA: 'En garita',
    EN_DESPACHO: 'En despacho',
    COMPLETADA: 'Completada',
    NO_COMPLETADA: 'No completada',
    PENDIENTE_ANULACION: 'Pendiente de anular',
    ANULADA: 'Anulada',
    PESAJE_LIBRE: 'Pesaje libre'
  };
  return <span className={estado === 'NO_COMPLETADA' || estado === 'PESAJE_LIBRE' ? 'state-badge state-alert' : 'state-badge'}>{labels[estado]}</span>;
}

function OperationModal({ operacion, onClose }: { operacion: Operacion; onClose: () => void }) {
  const events = [
    ['Cita / A.R.', operacion.fechaCita],
    ['Registro en garita (Falcon)', operacion.fechaGarita],
    ['Ingreso (Falcon)', operacion.fechaIngresoDespacho],
    ['Salida / completado (Falcon)', operacion.fechaCompletado]
  ];

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="operation-modal" role="dialog" aria-modal="true" aria-labelledby="operation-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="modal-header">
          <div>
            <p className="brand">{nombres[operacion.modalidad]}</p>
            <h2 id="operation-title">{operacion.volante}</h2>
          </div>
          <button className="close-button" onClick={onClose} aria-label="Cerrar detalle">×</button>
        </header>

        <div className="modal-summary">
          <p><span>Placa</span><strong>{operacion.unidad}</strong></p>
          <p><span>Estado actual</span><StateBadge estado={operacion.estado} /></p>
        </div>

        <h3>Trazabilidad de la operación</h3>
        <ol className="timeline">
          {events.map(([label, value]) => (
            <li className={value ? 'done' : ''} key={label}>
              <span>{label}</span>
              <strong>{value ? formatDateTime(value) : 'Pendiente'}</strong>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function FlowModal({ group, onClose }: { group: GrupoFlujo; onClose: () => void }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="operation-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
      <header className="modal-header"><div><p className="brand">VOLANTE</p><h2>{group.volante}</h2></div><button className="close-button" onClick={onClose} aria-label="Cerrar detalle">×</button></header>
      <h3>Citas Falcon ({group.citas.length})</h3>
      {group.citas.length ? <ol className="timeline">{group.citas.map((cita) => <li key={cita.id} className="done"><span>{cita.modalidad} · cita {cita.fechaCita ? formatDateTime(cita.fechaCita) : 'sin fecha'}</span><strong>{cita.id}</strong></li>)}</ol> : <p>GITS registró este movimiento sin una cita Falcon vinculable.</p>}
      <h3 className="flow-heading">Movimientos físicos GITS ({group.movimientos.length})</h3>
      {group.movimientos.length ? <ol className="timeline">{group.movimientos.map((movement) => <li key={movement.movimiento} className="done"><span>Ingreso a balanza: {movement.fechaGarita ? formatDateTime(movement.fechaGarita) : 'Sin hora'} · Salida por balanza: {movement.fechaSalidaBalanza ? formatDateTime(movement.fechaSalidaBalanza) : 'Pendiente'} · Placa: {movement.placa ?? '—'}</span><strong>{movement.contenedor ?? movement.movimiento}</strong><small>Pesos de balanza: {formatWeight(movement.pesoInicial)} / {formatWeight(movement.pesoFinal)} / neto {formatWeight(movement.pesoNetoBalanza)} · Mercadería declarada: {formatWeight(movement.pesoMercaderiaDeclarado)}</small></li>)}</ol> : <p>Aún no hay registro físico en GITS.</p>}
    </section>
  </div>;
}

function Kpi({ label, value }: { label: string; value: number | string }) {
  return <article className="tv-kpi"><span>{label}</span><strong>{value}</strong></article>;
}

function IncidentNotice({ incidentes }: { incidentes: IncidenteOperativo[] }) {
  if (!incidentes.length) return null;
  return <div className="incident-notice" role="status">
    {incidentes.map((incidente) => <p key={`${incidente.modalidades.join('|')}-${incidente.message}`}><strong>Incidencia {incidente.modalidades.join(' / ')}</strong> · {incidente.message}</p>)}
  </div>;
}

function TvIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="12" rx="1"/><path d="M8 21h8M12 17v4"/></svg>;
}

type DetalleHora = { hora: string; citas: number; garita: number; ingreso: number; despacho: number; proximas: number; pendientes: number; despachoDemorado: number; incidencias: number; revisar: number; critical: boolean; warning: boolean };

function crearDetalle(operaciones: Operacion[], reportDate: string | null): DetalleHora[] {
  const data = new Map<string, DetalleHora>();
  const add = (date: string | null, field: keyof Pick<DetalleHora, 'citas' | 'garita' | 'ingreso' | 'despacho'>, critical = false) => {
    if (!date || (reportDate && fechaLima(date) !== reportDate)) return;
    const hora = new Intl.DateTimeFormat('es-PE', { hour: '2-digit', hour12: false, timeZone: 'America/Lima' }).format(new Date(date)) + ':00';
    const row = data.get(hora) ?? { hora, citas: 0, garita: 0, ingreso: 0, despacho: 0, proximas: 0, pendientes: 0, despachoDemorado: 0, incidencias: 0, revisar: 0, critical: false, warning: false };
    row[field] += 1;
    row.critical ||= critical;
    data.set(hora, row);
  };
  operaciones.forEach((item) => {
    add(item.fechaCita, 'citas', item.estado === 'NO_COMPLETADA');
    add(item.fechaGarita, 'garita', item.estado === 'NO_COMPLETADA');
    add(item.fechaIngresoDespacho, 'ingreso', item.estado === 'NO_COMPLETADA');
    add(item.fechaCompletado, 'despacho', item.estado === 'NO_COMPLETADA');
  });
  return [...data.values()].sort((a, b) => a.hora.localeCompare(b.hora));
}

function crearDetalleFlujo(grupos: GrupoFlujo[], reportDate: string | null, seguimiento: SeguimientoLlegada[] = []): DetalleHora[] {
  const citas = grupos.flatMap((group) => group.citas);
  const data = new Map<string, DetalleHora>();
  const seguimientoPorCita = new Map(seguimiento.map((item) => [item.id, item]));
  const add = (date: string | null, field: keyof Pick<DetalleHora, 'citas' | 'garita' | 'ingreso' | 'despacho'>, critical = false, warning = false) => {
    if (!date || (reportDate && fechaLima(date) !== reportDate)) return;
    const hora = new Intl.DateTimeFormat('es-PE', { hour: '2-digit', hour12: false, timeZone: 'America/Lima' }).format(new Date(date)) + ':00';
    const row = data.get(hora) ?? { hora, citas: 0, garita: 0, ingreso: 0, despacho: 0, proximas: 0, pendientes: 0, despachoDemorado: 0, incidencias: 0, revisar: 0, critical: false, warning: false };
    row[field] += 1;
    row.critical ||= critical;
    row.warning ||= warning;
    if (warning) row.proximas += 1;
    if (critical) row.pendientes += 1;
    data.set(hora, row);
    return row;
  };
  if (seguimiento.length > 0) {
    citas.forEach((cita) => {
      const seguimientoCita = seguimientoPorCita.get(cita.id);
      const estado = seguimientoCita?.estado;
      const critical = estado ? esCritico(estado) : false;
      const warning = estado ? esProximo(estado) : false;
      const row = add(cita.fechaCita, 'citas', critical, warning);
      if (!row) return;
      if (cita.fechaGarita && (!reportDate || fechaLima(cita.fechaGarita) === reportDate)) row.garita += 1;
      if (cita.fechaIngresoDespacho && (!reportDate || fechaLima(cita.fechaIngresoDespacho) === reportDate)) row.ingreso += 1;
      if (cita.fechaCompletado && (!reportDate || fechaLima(cita.fechaCompletado) === reportDate)) row.despacho += 1;
      if (estado === 'VINCULO_PENDIENTE') row.revisar += 1;
      if (estado === 'PESO_OBSERVADO') row.revisar += 1;
      if (estado === 'INCIDENCIA_OPERATIVA') row.incidencias += 1;
    });
  } else {
    citas.forEach((cita) => {
      const critical = cita.estado === 'NO_COMPLETADA';
      add(cita.fechaCita, 'citas', critical);
      add(cita.fechaGarita, 'garita');
      add(cita.fechaIngresoDespacho, 'ingreso');
      add(cita.fechaCompletado, 'despacho');
    });
  }
  return [...data.values()].sort((a, b) => a.hora.localeCompare(b.hora));
}

function minutosEntre(now: Date, fecha: string) {
  return Math.max(0, Math.floor((now.getTime() - new Date(fecha).getTime()) / 60_000));
}

function esCritico(estado: EstadoSeguimiento) {
  return ['CITA_SIN_GARITA', 'GARITA_SIN_INGRESO', 'BALANZA_SIN_SALIDA', 'INGRESO_SIN_SALIDA', 'PESO_OBSERVADO'].includes(estado);
}

function esProximo(estado: EstadoSeguimiento) {
  return ['PROXIMA_GARITA', 'EN_GARITA', 'EN_BALANZA', 'EN_DESPACHO'].includes(estado);
}

function porcentajeDiferenciaPeso(movimiento: MovimientoFisico) {
  const neto = movimiento.pesoNetoBalanza ?? (movimiento.pesoInicial != null && movimiento.pesoFinal != null
    ? Math.abs(movimiento.pesoFinal - movimiento.pesoInicial) : null);
  const declarado = movimiento.pesoMercaderiaDeclarado;
  if (neto == null || declarado == null || declarado <= 0) return null;
  return Math.abs(neto - declarado) / declarado;
}

/**
 * Falcon aporta garita, ingreso y salida; GITS aporta primer y segundo pesaje.
 * Solo se mezclan ambos orígenes cuando el vínculo volante-cita es único.
 */
function crearSeguimientoLlegadas(grupos: GrupoFlujo[], reportDate: string | null, now: Date, modalidadesEnIncidencia: Set<Modalidad>): SeguimientoLlegada[] {
  const hoy = fechaLima(now.toISOString());
  if (!reportDate || reportDate !== hoy) return [];

  return grupos.flatMap((grupo) => grupo.citas
    .filter((cita) => cita.modalidad !== 'AEREO' && cita.fechaCita && fechaLima(cita.fechaCita) === reportDate)
    .map((cita) => {
      const movimientoUnico = grupo.tipo === 'UNICO' ? grupo.movimientos[0] : undefined;
      const hayMovimientoHoy = grupo.movimientos.some((movimiento) => movimiento.fechaGarita && fechaLima(movimiento.fechaGarita) === reportDate);
      const primerPesaje = movimientoUnico?.fechaGarita && fechaLima(movimientoUnico.fechaGarita) === reportDate ? movimientoUnico.fechaGarita : null;
      const segundoPesaje = movimientoUnico?.fechaSalidaBalanza && fechaLima(movimientoUnico.fechaSalidaBalanza) === reportDate ? movimientoUnico.fechaSalidaBalanza : null;
      const minutosHastaCita = Math.ceil((new Date(cita.fechaCita!).getTime() - now.getTime()) / 60_000);
      let estado: EstadoSeguimiento;
      let fechaReferencia = cita.fechaCita!;
      let minutosRetraso = 0;
      let porcentajePeso: number | null | undefined;

      if (grupo.tipo !== 'UNICO' && hayMovimientoHoy) {
        estado = 'VINCULO_PENDIENTE';
      } else if (primerPesaje && !segundoPesaje) {
        fechaReferencia = primerPesaje;
        minutosRetraso = minutosEntre(now, primerPesaje);
        estado = minutosRetraso >= minutosRojoBalanzaSinSalida ? 'BALANZA_SIN_SALIDA'
          : minutosRetraso >= minutosNaranjaBalanzaSinSalida ? 'EN_BALANZA' : 'PROGRAMADA';
      } else if (movimientoUnico && segundoPesaje && (porcentajePeso = porcentajeDiferenciaPeso(movimientoUnico)) != null && porcentajePeso > toleranciaPeso) {
        fechaReferencia = segundoPesaje;
        minutosRetraso = minutosEntre(now, segundoPesaje);
        estado = 'PESO_OBSERVADO';
      } else if (cita.fechaIngresoDespacho && !cita.fechaCompletado) {
        fechaReferencia = cita.fechaIngresoDespacho;
        minutosRetraso = minutosEntre(now, fechaReferencia);
        estado = minutosRetraso >= minutosRojoIngresoSinSalida ? 'INGRESO_SIN_SALIDA'
          : minutosRetraso >= minutosNaranjaIngresoSinSalida ? 'EN_DESPACHO' : 'PROGRAMADA';
      } else if (cita.fechaGarita && !cita.fechaIngresoDespacho) {
        fechaReferencia = cita.fechaGarita;
        minutosRetraso = minutosEntre(now, fechaReferencia);
        estado = minutosRetraso >= minutosRojoGaritaSinIngreso ? 'GARITA_SIN_INGRESO'
          : minutosRetraso >= minutosNaranjaGaritaSinIngreso ? 'EN_GARITA' : 'PROGRAMADA';
      } else if (!cita.fechaGarita) {
        estado = minutosHastaCita <= minutosRojoCitaSinGarita ? 'CITA_SIN_GARITA'
          : minutosHastaCita <= minutosNaranjaCitaSinGarita ? 'PROXIMA_GARITA' : 'PROGRAMADA';
        minutosRetraso = Math.max(0, -minutosHastaCita);
      } else estado = 'PROGRAMADA';

      if (modalidadesEnIncidencia.has(cita.modalidad) && esProximo(estado)) estado = 'INCIDENCIA_OPERATIVA';
      return {
        id: cita.id, volante: cita.volante, modalidad: cita.modalidad, fechaCita: cita.fechaCita!,
        placa: movimientoUnico?.placa ?? grupo.movimientos.find((movimiento) => movimiento.fechaGarita)?.placa ?? cita.unidad ?? null,
        estado, minutosRetraso, fechaReferencia, porcentajePeso
      };
    }));
}

function crearResumenSeguimiento(seguimiento: SeguimientoLlegada[]): Record<Modalidad, ResumenSeguimiento> {
  const resumen = Object.fromEntries(orden.map((modalidad) => [modalidad, { proximas: 0, criticas: 0, revisar: 0, pesoObservado: 0 }])) as Record<Modalidad, ResumenSeguimiento>;
  for (const item of seguimiento) {
    if (esProximo(item.estado)) resumen[item.modalidad].proximas += 1;
    if (esCritico(item.estado)) resumen[item.modalidad].criticas += 1;
    if (item.estado === 'VINCULO_PENDIENTE' || item.estado === 'INCIDENCIA_OPERATIVA') resumen[item.modalidad].revisar += 1;
    if (item.estado === 'PESO_OBSERVADO') resumen[item.modalidad].pesoObservado += 1;
  }
  return resumen;
}

function etiquetaSeguimiento(item: SeguimientoLlegada) {
  if (item.estado === 'INCIDENCIA_OPERATIVA') return 'Incidencia operativa: seguimiento general activo';
  if (item.estado === 'CITA_SIN_GARITA') return `Sin registro en garita Falcon · ${item.minutosRetraso ? `${item.minutosRetraso} min vencida` : 'faltan menos de 30 min'}`;
  if (item.estado === 'PROXIMA_GARITA') return 'Sin registro en garita Falcon · faltan entre 31 y 45 min';
  if (item.estado === 'GARITA_SIN_INGRESO') return `Garita Falcon sin ingreso · ${item.minutosRetraso} min`;
  if (item.estado === 'BALANZA_SIN_SALIDA') return `Primer pesaje GITS sin salida por balanza · ${item.minutosRetraso} min`;
  if (item.estado === 'INGRESO_SIN_SALIDA') return `Ingreso Falcon sin salida Falcon · ${item.minutosRetraso} min`;
  if (item.estado === 'PESO_OBSERVADO') return `Diferencia de peso ${((item.porcentajePeso ?? 0) * 100).toFixed(1)}% · supera 3%`;
  if (item.estado === 'VINCULO_PENDIENTE') return 'Hay más de una cita o movimiento: requiere validación';
  return 'Sin alerta activa';
}

function formatHour(value: string) {
  return new Intl.DateTimeFormat('es-PE', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'America/Lima'
  }).format(new Date(value));
}

function formatHourShort(value: string) {
  return new Intl.DateTimeFormat('es-PE', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Lima'
  }).format(new Date(value));
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('es-PE', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Lima' })
    .format(new Date(`${value}T12:00:00-05:00`));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('es-PE', {
    dateStyle: 'short', timeStyle: 'medium', timeZone: 'America/Lima'
  }).format(new Date(value));
}

function formatWeight(value: number | null) {
  return value === null ? '—' : new Intl.NumberFormat('es-PE', { maximumFractionDigits: 2 }).format(value);
}

function formatLastUpdate(operacion: Operacion) {
  const values = [operacion.fechaCompletado, operacion.fechaIngresoDespacho, operacion.fechaGarita, operacion.fechaCita].filter((value): value is string => Boolean(value));
  return values.length > 0 ? formatDateTime(values[0]) : 'Sin registro';
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
