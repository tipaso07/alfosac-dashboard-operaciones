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

const orden: Modalidad[] = ['FCL', 'LCL', 'BB', 'AEREO'];
const rotationMs = 15_000;
const nombres: Record<Modalidad, string> = {
  FCL: 'FCL marítimo',
  LCL: 'LCL marítimo',
  BB: 'BB marítimo',
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
  const [updatedAt, setUpdatedAt] = useState(new Date().toISOString());
  const [indice, setIndice] = useState(0);

  useEffect(() => {
    const cargar = async () => {
      try {
        const respuestas = await Promise.all([fetch('/api/dashboard/summary'), fetch('/api/dashboard/operations')]);
        if (!respuestas[0].ok || !respuestas[1].ok) return;
        const summaryData = await respuestas[0].json() as { summary: Resumen[]; updatedAt: string };
        const operationsData = await respuestas[1].json() as { operations: Operacion[] };
        setResumen(summaryData.summary);
        setOperaciones(operationsData.operations);
        setUpdatedAt(summaryData.updatedAt);
      } catch {
        // Se conserva el último dato visible si la API se reinicia.
      }
    };

    void cargar();
    const refresh = window.setInterval(() => void cargar(), 30_000);
    return () => window.clearInterval(refresh);
  }, []);

  useEffect(() => {
    if (!tv) return;
    const rotate = window.setInterval(() => setIndice((actual) => (actual + 1) % orden.length), rotationMs);
    return () => window.clearInterval(rotate);
  }, [tv]);

  const modalidad = orden[indice];
  const summary = resumen.find((item) => item.modalidad === modalidad) ?? demoResumen[indice];
  const detalle = useMemo(() => crearDetalle(operaciones.filter((item) => item.modalidad === modalidad)), [modalidad, operaciones]);

  return tv
    ? <TvScreen modalidad={modalidad} summary={summary} detalle={detalle} updatedAt={updatedAt} indice={indice} />
    : <InternalScreen resumen={resumen} operaciones={operaciones} updatedAt={updatedAt} />;
}

function TvScreen({ modalidad, summary, detalle, updatedAt, indice }: {
  modalidad: Modalidad;
  summary: Resumen;
  detalle: DetalleHora[];
  updatedAt: string;
  indice: number;
}) {
  return (
    <main className="tv-screen">
      <header className="tv-header">
        <div>
          <p className="brand">ALMACENES FORWARDER S.A.C.</p>
          <h1>{nombres[modalidad]}</h1>
        </div>
        <div className="tv-clock">
          <strong>{formatHour(new Date().toISOString())}</strong>
          <span>Actualizado {formatHour(updatedAt)}</span>
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
            {detalle.length > 0 ? detalle.map((item) => (
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
        <p>Cambio automático cada 15 segundos</p>
      </footer>
    </main>
  );
}

function InternalScreen({ resumen, operaciones, updatedAt }: { resumen: Resumen[]; operaciones: Operacion[]; updatedAt: string }) {
  const [filtro, setFiltro] = useState<Modalidad | 'TODAS'>('TODAS');
  const [vista, setVista] = useState<'RESUMEN' | 'LISTA'>('RESUMEN');
  const [seleccionada, setSeleccionada] = useState<Operacion | null>(null);
  const operacionesFiltradas = filtro === 'TODAS' ? operaciones : operaciones.filter((item) => item.modalidad === filtro);
  const resumenHora = crearDetalle(operacionesFiltradas);
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
        </div>
        <p>Modo demostración · actualizado {formatHour(updatedAt)}</p>
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
          <p>{operacionesFiltradas.length} registro(s)</p>
        </div>

        <div className="filter-row" aria-label="Filtrar por operación">
          <button className={filtro === 'TODAS' ? 'selected' : ''} onClick={() => setFiltro('TODAS')}>Todas</button>
          {orden.map((item) => <button className={filtro === item ? 'selected' : ''} key={item} onClick={() => setFiltro(item)}>{nombres[item]}</button>)}
        </div>

        <div className="view-row" aria-label="Elegir vista">
          <button className={vista === 'RESUMEN' ? 'selected' : ''} onClick={() => setVista('RESUMEN')}>Resumen agrupado por hora</button>
          <button className={vista === 'LISTA' ? 'selected' : ''} onClick={() => setVista('LISTA')}>Lista detallada</button>
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
                <th>Fecha</th><th>Hora</th><th>Modalidad</th><th>Volante / A.R.</th>
                <th>Placa / unidad</th>
                <th>Registro garita</th><th>Espera</th><th>Ingreso</th><th>Despacho</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {operacionesFiltradas.length > 0 ? operacionesFiltradas.map((item) => (
                <tr key={item.id}>
                  <td>{item.fechaCita ? new Intl.DateTimeFormat('es-PE', { dateStyle: 'short' }).format(new Date(item.fechaCita)) : '—'}</td>
                  <td>{item.fechaCita ? formatHour(item.fechaCita) : '—'}</td>
                  <td>{nombres[item.modalidad]}</td>
                  <td><strong>{item.volante}</strong></td>
                  <td>{item.unidad}</td>
                  <td>{item.fechaGarita ? formatHour(item.fechaGarita) : '—'}</td>
                  <td>{difference(item.fechaCita, item.fechaGarita)}</td>
                  <td>{item.fechaIngresoDespacho ? formatHour(item.fechaIngresoDespacho) : '—'}</td>
                  <td>{item.fechaCompletado ? formatHour(item.fechaCompletado) : '—'}</td>
                  <td><button className="detail-button" onClick={() => setSeleccionada(item)}>Ver detalle</button></td>
                </tr>
              )) : <tr><td colSpan={6} className="empty">No hay operaciones para este filtro.</td></tr>}
            </tbody>
          </table>}
        </div>
      </section>

      {seleccionada && <OperationModal operacion={seleccionada} onClose={() => setSeleccionada(null)} />}
    </main>
  );
}

function difference(start: string | null, end: string | null) {
  if (!start || !end) return '—';
  const minutes = Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60_000));
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
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
          <p><span>Unidad</span><strong>{operacion.unidad}</strong></p>
          <p><span>Estado actual</span><StateBadge estado={operacion.estado} /></p>
          <p><span>Fuente</span><strong>Demostración</strong></p>
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

function Kpi({ label, value }: { label: string; value: number }) {
  return <article className="tv-kpi"><span>{label}</span><strong>{value}</strong></article>;
}

type DetalleHora = { hora: string; citas: number; garita: number; ingreso: number; despacho: number; critical: boolean };

function crearDetalle(operaciones: Operacion[]): DetalleHora[] {
  const data = new Map<string, DetalleHora>();
  const add = (date: string | null, field: keyof Pick<DetalleHora, 'citas' | 'garita' | 'ingreso' | 'despacho'>, critical = false) => {
    if (!date) return;
    const hora = new Intl.DateTimeFormat('es-PE', { hour: '2-digit', hour12: false }).format(new Date(date)) + ':00';
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

function formatHour(value: string) {
  return new Intl.DateTimeFormat('es-PE', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(value));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('es-PE', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value));
}

function formatLastUpdate(operacion: Operacion) {
  const values = [operacion.fechaCompletado, operacion.fechaIngresoDespacho, operacion.fechaGarita, operacion.fechaCita].filter((value): value is string => Boolean(value));
  return values.length > 0 ? formatDateTime(values[0]) : 'Sin registro';
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
