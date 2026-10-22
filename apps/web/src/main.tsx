import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

type Modalidad = 'FCL' | 'LCL' | 'BB' | 'AEREO';
type Estado = 'AGENDADA' | 'EN_GARITA' | 'EN_DESPACHO' | 'COMPLETADA' | 'NO_COMPLETADA';

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

type MovimientoFisico = { movimiento: string; placa: string | null; contenedor: string | null; fechaGarita: string | null; fechaSalidaAlmacen: string | null };
type GrupoFlujo = { volante: string; modalidad: Modalidad | null; citas: Operacion[]; movimientos: MovimientoFisico[]; tipo: 'UNICO' | 'MULTIPLE' | 'SIN_CITA' };

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
  const [alertIndex, setAlertIndex] = useState(0);

  useEffect(() => {
    const cargar = async () => {
      try {
        const respuestas = await Promise.all([fetch('/api/dashboard/summary'), fetch('/api/dashboard/operations'), fetch('/api/dashboard/pending-arrivals'), fetch('/api/dashboard/flow')]);
        if (!respuestas.every((response) => response.ok)) return;
        const summaryData = await respuestas[0].json() as { mode: 'demo' | 'reportes'; summary: Resumen[]; updatedAt: string; reportDate: string | null };
        const operationsData = await respuestas[1].json() as { operations: Operacion[]; reportDate: string | null };
        const pendingData = await respuestas[2].json() as { operations: Operacion[] };
        const flowData = await respuestas[3].json() as { groups: GrupoFlujo[] };
        setResumen(summaryData.summary);
        setOperaciones(operationsData.operations);
        setPendientes(pendingData.operations);
        setGrupos(flowData.groups);
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

  const detallesTv = useMemo(() => Object.fromEntries(orden.map((item) => [
    item,
    crearDetalleFlujo(grupos.filter((group) => group.modalidad === item), reportDate)
  ])) as Record<Modalidad, DetalleHora[]>, [grupos, reportDate]);
  const modalidadesConAlerta = useMemo(() => orden.filter((item) => detallesTv[item].some((row) => row.critical)), [detallesTv]);

  useEffect(() => {
    if (!tv) return;
    if (modalidadesConAlerta.length > 0) {
      setAlertIndex(0);
      setIndice(orden.indexOf(modalidadesConAlerta[0]));
      const rotateAlerts = window.setInterval(() => {
        setAlertIndex((current) => {
          const next = (current + 1) % modalidadesConAlerta.length;
          setIndice(orden.indexOf(modalidadesConAlerta[next]));
          return next;
        });
      }, alertRotationMs);
      return () => window.clearInterval(rotateAlerts);
    }
    const rotate = window.setInterval(() => setIndice((actual) => (actual + 1) % orden.length), rotationMs);
    return () => window.clearInterval(rotate);
  }, [tv, modalidadesConAlerta]);

  const modalidad = orden[indice];
  const summary = resumen.find((item) => item.modalidad === modalidad) ?? demoResumen[indice];
  const detalle = detallesTv[modalidad];
  const alertaActiva = modalidadesConAlerta.includes(modalidad);

  return tv
    ? <TvScreen modalidad={modalidad} summary={summary} detalle={detalle} updatedAt={updatedAt} reportDate={reportDate} indice={indice} alertaActiva={alertaActiva} />
    : <InternalScreen resumen={resumen} operaciones={operaciones} grupos={grupos} pendientes={pendientes} updatedAt={updatedAt} reportDate={reportDate} dataMode={dataMode} />;
}

function TvScreen({ modalidad, summary, detalle, updatedAt, reportDate, indice, alertaActiva }: {
  modalidad: Modalidad;
  summary: Resumen;
  detalle: DetalleHora[];
  updatedAt: string;
  reportDate: string | null;
  indice: number;
  alertaActiva: boolean;
}) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(detalle.length / tvPageRows));
  const visibleRows = detalle.slice(page * tvPageRows, (page + 1) * tvPageRows);
  const alertRow = detalle.findIndex((item) => item.critical);
  const alertPage = alertRow >= 0 ? Math.floor(alertRow / tvPageRows) : 0;

  useEffect(() => { setPage(alertaActiva ? alertPage : 0); }, [modalidad, alertaActiva, alertPage]);
  useEffect(() => {
    if (alertaActiva || pageCount <= 1) return;
    const interval = window.setInterval(() => setPage((current) => (current + 1) % pageCount), 7_500);
    return () => window.clearInterval(interval);
  }, [pageCount]);

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

      {summary.noCompletadas > 0 && <p className="tv-alert">Atención: {summary.noCompletadas} operación(es) no completada(s)</p>}

      <section className="tv-kpis" aria-label="Resumen de la operación">
        <Kpi label={modalidad === 'AEREO' ? 'A.R.' : 'Citas agendadas'} value={summary.agendadas} />
        <Kpi label="Registro en garita" value={summary.garita} />
        <Kpi label="Ingreso a despacho" value={summary.despacho} />
        <Kpi label="Completadas" value={summary.completadas} />
      </section>

      <section className="tv-table-wrap">
        <h2>Movimiento por horario</h2>
        <table>
          <thead>
            <tr>
              <th>Hora</th>
              <th>{modalidad === 'AEREO' ? 'A.R.' : 'Citas'}</th>
              <th>Garita</th>
              <th>Ingreso</th>
              <th>Despacho</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.length > 0 ? visibleRows.map((item) => (
              <tr key={item.hora} className={item.critical ? 'critical-row' : undefined}>
                <td>{item.hora}</td>
                <td>{item.citas}</td>
                <td>{item.garita}</td>
                <td>{item.ingreso}</td>
                <td>{item.despacho}</td>
                <td><span className={item.critical ? 'status status-alert' : 'status'}>{item.critical ? 'REVISAR' : 'OPERATIVO'}</span></td>
              </tr>
            )) : <tr><td colSpan={6} className="empty">Sin operaciones para mostrar</td></tr>}
          </tbody>
        </table>
      </section>

      <footer className="tv-footer">
        <div className="rotation" aria-label="Rotación de operaciones">
          {orden.map((item, position) => <span className={position === indice ? 'active' : ''} key={item}>{nombres[item]}</span>)}
        </div>
        <p>{alertaActiva ? 'Alerta prioritaria · visible 25 segundos' : `${pageCount > 1 ? `Página ${page + 1} de ${pageCount} · ` : ''}Cambio automático cada 15 segundos`}</p>
      </footer>
    </main>
  );
}

function InternalScreen({ resumen, operaciones, grupos, pendientes, updatedAt, reportDate, dataMode }: { resumen: Resumen[]; operaciones: Operacion[]; grupos: GrupoFlujo[]; pendientes: Operacion[]; updatedAt: string; reportDate: string | null; dataMode: 'demo' | 'reportes' }) {
  const [filtro, setFiltro] = useState<Modalidad | 'TODAS'>('TODAS');
  const [vista, setVista] = useState<'RESUMEN' | 'LISTA'>('RESUMEN');
  const [seleccionado, setSeleccionado] = useState<GrupoFlujo | null>(null);
  const operacionesFiltradas = filtro === 'TODAS' ? operaciones : operaciones.filter((item) => item.modalidad === filtro);
  const gruposFiltrados = filtro === 'TODAS' ? grupos : grupos.filter((group) => group.modalidad === filtro);
  const resumenHora = crearDetalleFlujo(gruposFiltrados, reportDate);
  const totales = resumen.reduce((acumulado, item) => ({
    agendadas: acumulado.agendadas + item.agendadas,
    garita: acumulado.garita + item.garita,
    despacho: acumulado.despacho + item.despacho,
    completadas: acumulado.completadas + item.completadas,
    noCompletadas: acumulado.noCompletadas + item.noCompletadas
  }), { agendadas: 0, garita: 0, despacho: 0, completadas: 0, noCompletadas: 0 });

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
        <Kpi label="Ingreso a despacho" value={totales.despacho} />
        <Kpi label="Completadas" value={totales.completadas} />
      </section>

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

        <div className="operations-table-wrap">
          {vista === 'RESUMEN' ? <table className="operations-table">
            <thead><tr><th>Hora</th><th>Citas / A.R.</th><th>Registro en garita</th><th>Ingreso</th><th>Despacho</th><th>Estado</th></tr></thead>
            <tbody>{resumenHora.length > 0 ? resumenHora.map((item) => (
              <tr key={item.hora}><td>{item.hora}</td><td>{item.citas}</td><td>{item.garita}</td><td>{item.ingreso}</td><td>{item.despacho}</td><td><span className="state-badge">{item.critical ? 'Revisar' : 'Operativo'}</span></td></tr>
            )) : <tr><td colSpan={6} className="empty">No hay operaciones para este filtro.</td></tr>}</tbody>
          </table> : <table className="operations-table detail-list">
            <thead>
              <tr>
                <th>Volante / A.R.</th><th>Modalidad</th><th>Citas</th><th>Movimientos en garita</th>
                <th>Último registro físico</th><th>Relación</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {gruposFiltrados.length > 0 ? gruposFiltrados.map((group) => (
                <tr key={group.volante}>
                  <td><strong>{group.volante}</strong></td>
                  <td>{group.modalidad ? nombres[group.modalidad] : 'Sin cita vinculada'}</td>
                  <td>{group.citas.length}</td>
                  <td>{group.movimientos.length}</td>
                  <td>{group.movimientos.at(-1)?.fechaGarita ? formatDateTime(group.movimientos.at(-1)!.fechaGarita!) : '—'}</td>
                  <td><span className="state-badge">{group.tipo === 'UNICO' ? 'Vínculo único' : group.tipo === 'MULTIPLE' ? 'Múltiples movimientos' : 'Sin cita'}</span></td>
                  <td><button className="detail-button" onClick={() => setSeleccionado(group)}>Ver detalle</button></td>
                </tr>
              )) : <tr><td colSpan={7} className="empty">No hay operaciones para este filtro.</td></tr>}
            </tbody>
          </table>}
        </div>
      </section>

      <section className="pending-panel">
        <div><p className="brand">SEGUIMIENTO</p><h2>Pendientes de llegada</h2></div>
        {pendientes.length ? <div className="pending-list">{pendientes.map((item) => <article key={item.id}><strong>{item.volante}</strong><span>{nombres[item.modalidad]} · Cita: {item.fechaCita ? formatDateTime(item.fechaCita) : '—'}</span></article>)}</div> : <p>No hay citas vencidas pendientes de registro en garita.</p>}
      </section>

      {seleccionado && <FlowModal group={seleccionado} onClose={() => setSeleccionado(null)} />}
    </main>
  );
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
    NO_COMPLETADA: 'No completada'
  };
  return <span className={estado === 'NO_COMPLETADA' ? 'state-badge state-alert' : 'state-badge'}>{labels[estado]}</span>;
}

function OperationModal({ operacion, onClose }: { operacion: Operacion; onClose: () => void }) {
  const events = [
    ['Cita / A.R.', operacion.fechaCita],
    ['Registro en garita', operacion.fechaGarita],
    ['Ingreso a despacho', operacion.fechaIngresoDespacho],
    ['Despacho / completado', operacion.fechaCompletado]
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
      {group.movimientos.length ? <ol className="timeline">{group.movimientos.map((movement) => <li key={movement.movimiento} className="done"><span>Garita: {movement.fechaGarita ? formatDateTime(movement.fechaGarita) : 'Sin hora'} · Placa: {movement.placa ?? '—'}</span><strong>{movement.contenedor ?? movement.movimiento}</strong></li>)}</ol> : <p>Aún no hay registro físico en GITS.</p>}
    </section>
  </div>;
}

function Kpi({ label, value }: { label: string; value: number }) {
  return <article className="tv-kpi"><span>{label}</span><strong>{value}</strong></article>;
}

function TvIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="12" rx="1"/><path d="M8 21h8M12 17v4"/></svg>;
}

type DetalleHora = { hora: string; citas: number; garita: number; ingreso: number; despacho: number; critical: boolean };

function crearDetalle(operaciones: Operacion[], reportDate: string | null): DetalleHora[] {
  const data = new Map<string, DetalleHora>();
  const add = (date: string | null, field: keyof Pick<DetalleHora, 'citas' | 'garita' | 'ingreso' | 'despacho'>, critical = false) => {
    if (!date || (reportDate && fechaLima(date) !== reportDate)) return;
    const hora = new Intl.DateTimeFormat('es-PE', { hour: '2-digit', hour12: false, timeZone: 'America/Lima' }).format(new Date(date)) + ':00';
    const row = data.get(hora) ?? { hora, citas: 0, garita: 0, ingreso: 0, despacho: 0, critical: false };
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

function crearDetalleFlujo(grupos: GrupoFlujo[], reportDate: string | null): DetalleHora[] {
  const citas = grupos.flatMap((group) => group.citas);
  const physical = grupos.flatMap((group) => group.movimientos.map((movement) => ({
    id: movement.movimiento, modalidad: group.modalidad, fechaGarita: movement.fechaGarita
  }))).filter((item): item is { id: string; modalidad: Modalidad; fechaGarita: string | null } => Boolean(item.modalidad));
  const data = new Map<string, DetalleHora>();
  const add = (date: string | null, field: keyof Pick<DetalleHora, 'citas' | 'garita' | 'ingreso' | 'despacho'>, critical = false) => {
    if (!date || (reportDate && fechaLima(date) !== reportDate)) return;
    const hora = new Intl.DateTimeFormat('es-PE', { hour: '2-digit', hour12: false, timeZone: 'America/Lima' }).format(new Date(date)) + ':00';
    const row = data.get(hora) ?? { hora, citas: 0, garita: 0, ingreso: 0, despacho: 0, critical: false };
    row[field] += 1; row.critical ||= critical; data.set(hora, row);
  };
  citas.forEach((cita) => {
    const critical = cita.estado === 'NO_COMPLETADA';
    add(cita.fechaCita, 'citas', critical);
    add(cita.fechaIngresoDespacho, 'ingreso', critical);
    add(cita.fechaCompletado, 'despacho', critical);
  });
  physical.forEach((movement) => add(movement.fechaGarita, 'garita'));
  return [...data.values()].sort((a, b) => a.hora.localeCompare(b.hora));
}

function formatHour(value: string) {
  return new Intl.DateTimeFormat('es-PE', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'America/Lima'
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

function formatLastUpdate(operacion: Operacion) {
  const values = [operacion.fechaCompletado, operacion.fechaIngresoDespacho, operacion.fechaGarita, operacion.fechaCita].filter((value): value is string => Boolean(value));
  return values.length > 0 ? formatDateTime(values[0]) : 'Sin registro';
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
