import { StrictMode, useEffect, useMemo, useState, type FormEvent } from 'react';
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
  /** Peso recibido por Falcon cuando está disponible. */
  pesoDeclarado?: number | null;
  /** Falcon aún no entrega este dato; se reserva para el contacto operativo futuro. */
  telefonoContacto?: string | null;
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
type AereoAsociado = { volante: string; placa: string; fechaGarita: string; primerPesaje: string | null; segundoPesaje: string | null; pesoDeclarado: number | null; diferenciaMinutos: number };
type GrupoFlujo = { volante: string; modalidad: Modalidad | null; citas: Operacion[]; movimientos: MovimientoFisico[]; tipo: 'UNICO' | 'MULTIPLE' | 'SIN_CITA' | 'SIN_MOVIMIENTO'; aereosAsociados?: AereoAsociado[] };
type IncidenteOperativo = { modalidades: Modalidad[]; message: string };
/** El seguimiento mantiene separados los hitos Falcon de los pesajes GITS. */
type EstadoSeguimiento = 'PROGRAMADA' | 'CITA_POR_VENCER' | 'CITA_VENCIDA' | 'EN_GARITA' | 'GARITA_SIN_INGRESO' | 'VINCULO_PENDIENTE' | 'EN_ATENCION' | 'EN_BALANZA' | 'BALANZA_SIN_SALIDA' | 'PESO_OBSERVADO' | 'INCIDENCIA_OPERATIVA';
type SeguimientoLlegada = { id: string; volante: string; modalidad: Modalidad; fechaCita: string; placa: string | null; estado: EstadoSeguimiento; minutosRetraso: number; fechaReferencia: string; porcentajePeso?: number | null };
type DiagnosticoAlerta = { key: string; tone: 'warning' | 'alert'; level: string; title: string; cita: Operacion; fechaReferencia: string; duracion?: string; porcentajePeso?: number | null; contact?: boolean };
type ResumenSeguimiento = { proximas: number; criticas: number; revisar: number; pesoObservado: number };
type ReporteOperativo = {
  periodo: 'DIARIO' | 'MENSUAL' | 'RANGO'; fecha: string; hasta: string | null; modalidad: 'TODAS' | 'FCL' | 'LCL';
  resumen: { programadas: number; atendidas: number; noAtendidas: number; pendientesAnulacion: number; anuladas: number; pesajesLibres: number; porConfirmar: number };
  estadisticas: { citasAgendadas: number; registroGarita: number; primerPesaje: number | null; salidaBalanza: number | null; esperaPromedioMinutos: number | null; atencionPromedioMinutos: number | null; gitsDisponible: boolean };
  cierre: { atendidas: number | null; anuladas: number | null; sinAtencion: number | null; pendienteAnulacion: number | null; disponible: boolean };
  filas: Array<{ fecha: string | null; horaCita: string | null; modalidad: Modalidad; volante: string; placa: string; estado: Estado; clasificacion: string }>;
  nota: string;
};
type DisponibilidadHistorica = {
  fecha: string;
  capturadaEn: string;
  fuente: string;
  modalidades: Array<{ modalidad: 'FCL' | 'LCL' | 'BB'; horas: Array<{ hora: number; cuposDisponibles: number | null }> }>;
};
type ConteoCitasFalcon = { modalidad: 'FCL' | 'LCL' | 'BB'; hora: string; cantidad: number };
type UsuarioSesion = { id: string; email: string; nombre: string; rol: 'ADMIN' | 'OPERADOR' | 'LECTURA' };
type UsuarioAdministrable = UsuarioSesion & { activo: boolean; creadoEn: string };
type EstadoAutenticacion = { enabled: boolean; user: UsuarioSesion | null };

/** Reglas operativas confirmadas por ATC para FCL y LCL. */
const minutosCitaPorVencer = 30;
// Si no hay registro de garita, ATC empieza a gestionar a los 30 minutos
// y la cita pasa a vencida a los 45 minutos desde la hora programada.
const minutosToleranciaCita = 45;
const minutosRojoEsperaVigente = 30;
const minutosNaranjaEsperaVigente = 15;
const minutosRojoEsperaVencida = 60;
const minutosNaranjaEsperaVencida = 30;
const minutosRojoAtencion = 45;
const minutosNaranjaAtencion = 30;
/** Diferencia máxima aceptada entre peso neto y declarado, confirmada por operación. */
const toleranciaPeso = 0.05;

const orden: Modalidad[] = ['FCL', 'LCL', 'BB', 'AEREO'];
/** BB y Aéreo se mantienen en los datos, pero se ocultan temporalmente de la operación visible. */
const modalidadesVisibles: Modalidad[] = ['FCL', 'LCL'];
const dashboardCacheKey = 'alfosac.dashboard.operacion.v1';
const dashboardCacheMaxAgeMs = 60_000;
const nombres: Record<Modalidad, string> = {
  FCL: 'FCL importación',
  LCL: 'LCL importación',
  BB: 'BB importación',
  AEREO: 'Aéreo / A.R.'
};

function App() {
  const [auth, setAuth] = useState<EstadoAutenticacion | null>(null);

  useEffect(() => {
    void fetch('/api/auth/me', { credentials: 'same-origin' })
      .then(async (response) => response.ok ? response.json() as Promise<EstadoAutenticacion> : { enabled: true, user: null })
      .then(setAuth)
      .catch(() => setAuth({ enabled: true, user: null }));
  }, []);

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    setAuth({ enabled: true, user: null });
  };

  if (!auth) return <main className="auth-loading">Verificando acceso seguro…</main>;
  if (auth.enabled && !auth.user) return <LoginScreen onLogin={(user) => setAuth({ enabled: true, user })} />;
  return <DashboardApp user={auth.user} authEnabled={auth.enabled} onLogout={logout} />;
}

type DashboardCache = {
  cachedAt: number;
  resumen: Resumen[];
  operaciones: Operacion[];
  pendientes: Operacion[];
  grupos: GrupoFlujo[];
  incidentes: IncidenteOperativo[];
  updatedAt: string;
  reportDate: string | null;
  dataMode: 'demo' | 'reportes';
};

function leerCacheDashboard(): DashboardCache | null {
  try {
    const raw = window.sessionStorage.getItem(dashboardCacheKey);
    if (!raw) return null;
    const cache = JSON.parse(raw) as DashboardCache;
    if (!cache.cachedAt || Date.now() - cache.cachedAt > dashboardCacheMaxAgeMs) {
      window.sessionStorage.removeItem(dashboardCacheKey);
      return null;
    }
    return cache;
  } catch {
    return null;
  }
}

function guardarCacheDashboard(cache: Omit<DashboardCache, 'cachedAt'>) {
  try {
    window.sessionStorage.setItem(dashboardCacheKey, JSON.stringify({ ...cache, cachedAt: Date.now() }));
  } catch {
    // La caché mejora la navegación, pero el panel sigue funcionando si el navegador la bloquea.
  }
}

function DashboardApp({ user, authEnabled, onLogout }: { user: UsuarioSesion | null; authEnabled: boolean; onLogout: () => Promise<void> }) {
  const tv = window.location.pathname === '/tv';
  const cacheInicial = leerCacheDashboard();
  const [resumen, setResumen] = useState<Resumen[]>(() => cacheInicial?.resumen ?? []);
  const [operaciones, setOperaciones] = useState<Operacion[]>(() => cacheInicial?.operaciones ?? []);
  const [grupos, setGrupos] = useState<GrupoFlujo[]>(() => cacheInicial?.grupos ?? []);
  const [pendientes, setPendientes] = useState<Operacion[]>(() => cacheInicial?.pendientes ?? []);
  const [updatedAt, setUpdatedAt] = useState(() => cacheInicial?.updatedAt ?? new Date().toISOString());
  const [reportDate, setReportDate] = useState<string | null>(() => cacheInicial?.reportDate ?? null);
  const [dataMode, setDataMode] = useState<'demo' | 'reportes'>(() => cacheInicial?.dataMode ?? 'demo');
  const [incidentes, setIncidentes] = useState<IncidenteOperativo[]>(() => cacheInicial?.incidentes ?? []);
  const [estadoCarga, setEstadoCarga] = useState<'CARGANDO' | 'LISTO'>(() => cacheInicial ? 'LISTO' : 'CARGANDO');

  useEffect(() => {
    const cargar = async () => {
      try {
        const respuestas = await Promise.all([fetch('/api/dashboard/summary'), fetch('/api/dashboard/operations'), fetch('/api/dashboard/pending-arrivals'), fetch('/api/dashboard/flow')]);
        if (!respuestas.every((response) => response.ok)) throw new Error('No se pudo consultar el resumen operativo.');
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
        guardarCacheDashboard({
          resumen: summaryData.summary,
          operaciones: operationsData.operations,
          pendientes: pendingData.operations,
          grupos: flowData.groups,
          incidentes: flowData.incidents ?? [],
          updatedAt: summaryData.updatedAt,
          reportDate: summaryData.reportDate ?? operationsData.reportDate ?? null,
          dataMode: summaryData.mode
        });
        setEstadoCarga('LISTO');
      } catch {
        // Mantiene el indicador hasta el siguiente intento automático, sin mostrar cifras incompletas.
        setEstadoCarga((actual) => actual === 'LISTO' ? actual : 'CARGANDO');
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
  const resumenSeguimiento = useMemo(() => crearResumenSeguimiento(seguimiento), [seguimiento]);
  if (estadoCarga !== 'LISTO') return <DataLoadingScreen />;

  return tv
    ? <TvScreen resumen={resumen} detalles={detallesTv} grupos={grupos} seguimiento={seguimiento} resumenSeguimiento={resumenSeguimiento} updatedAt={updatedAt} reportDate={reportDate} />
    : <InternalScreen resumen={resumen} grupos={grupos} seguimiento={seguimiento} resumenSeguimiento={resumenSeguimiento} updatedAt={updatedAt} reportDate={reportDate} dataMode={dataMode} incidentes={incidentes} user={user} authEnabled={authEnabled} onLogout={onLogout} />;
}

function DataLoadingScreen() {
  return <main className="data-loading"><section><span className="data-loading-dot" aria-hidden="true" />
    <h1>Cargando información…</h1>
  </section></main>;
}

function LoginScreen({ onLogin }: { onLogin: (user: UsuarioSesion) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/auth/login', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
      const data = await response.json() as { user?: UsuarioSesion; message?: string };
      if (!response.ok || !data.user) throw new Error(data.message ?? 'No se pudo iniciar sesión.');
      onLogin(data.user);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo iniciar sesión.');
    } finally {
      setLoading(false);
    }
  };
  return <main className="login-screen"><section className="login-card">
    <p className="brand">ALMACENES FORWARDER S.A.C.</p><h1>Dashboard operativo</h1><p className="login-subtitle">Acceso restringido a personal autorizado.</p>
    <form onSubmit={submit}><label>Correo corporativo<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" required /></label><label>Contraseña<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label>{error && <p className="login-error" role="alert">{error}</p>}<button type="submit" disabled={loading}>{loading ? 'Ingresando…' : 'Ingresar'}</button></form>
    <p className="login-note">La actividad de acceso queda registrada.</p>
  </section></main>;
}

function TvScreen({ resumen, detalles, grupos, seguimiento, resumenSeguimiento, updatedAt, reportDate }: {
  resumen: Resumen[];
  detalles: Record<Modalidad, DetalleHora[]>;
  grupos: GrupoFlujo[];
  seguimiento: SeguimientoLlegada[];
  resumenSeguimiento: Record<Modalidad, ResumenSeguimiento>;
  updatedAt: string;
  reportDate: string | null;
}) {
  const [horaInspeccion, setHoraInspeccion] = useState<{ hora: string; modalidad: Modalidad } | null>(null);
  const [ahora, setAhora] = useState(() => new Date());
  const horaActual = horaLima(ahora);

  useEffect(() => {
    const interval = window.setInterval(() => setAhora(new Date()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <main className="tv-screen">
      <header className="tv-header">
        <div>
          <h1>Seguimiento por horario</h1>
        </div>
        <div className="tv-header-actions">
          <a className="exit-tv" href="/" aria-label="Salir del modo TV" title="Salir del modo TV"><LogoutIcon /></a>
          <div className="tv-clock">
            <strong>{formatHour(ahora.toISOString())}</strong>
            <span>{reportDate ? formatDate(reportDate) : 'Hoy'} · actualizado {formatHour(updatedAt)}</span>
          </div>
        </div>
      </header>

      <section className="tv-modalities" aria-label="Seguimiento FCL y LCL">
        {modalidadesVisibles.map((modalidad) => {
          const summary = resumen.find((item) => item.modalidad === modalidad) ?? { modalidad, agendadas: 0, garita: 0, despacho: 0, completadas: 0, noCompletadas: 0 };
          const filas = ventanaOperativaPorHora(detalles[modalidad], horaActual);
          return <section className="tv-modality-panel" key={modalidad}>
            <div className="tv-modality-heading"><div><h2>{nombres[modalidad]}</h2><span>Ventana: {filas[0]?.hora} a {filas.at(-1)?.hora}</span></div></div>
            <div className="tv-panel-kpis">
              <Kpi label="Citas agendadas" value={summary.agendadas} />
              <Kpi label="Registro en garita" value={summary.garita} />
              <Kpi label="Ingreso" value={summary.despacho} />
              <Kpi label="Despacho" value={summary.completadas} />
            </div>
            <div className="tv-panel-table"><table><thead><tr><th>Hora</th><th>Citas</th><th>Garita</th><th>Ingreso</th><th>Salida</th><th>Revisar</th><th>Estado</th></tr></thead><tbody>
              {filas.map((item) => <tr key={item.hora} className={`tv-hour-row ${item.critical ? 'critical-row' : item.warning ? 'warning-row' : ''}`} onClick={() => setHoraInspeccion({ hora: item.hora, modalidad })}>
                <td>{item.hora}</td><td>{item.citas}</td><td>{item.garita}</td><td>{item.ingreso}</td><td>{item.despacho}</td><td>{item.revisar}</td>
                <td><span className={item.critical ? 'status status-alert' : item.warning ? 'status status-warning' : 'status'}>{item.critical ? `${item.pendientes} ALERTA${item.pendientes === 1 ? '' : 'S'}` : item.warning ? 'PRÓXIMA ALERTA' : item.incidencias ? 'INCIDENCIA GENERAL' : item.revisar ? `${item.revisar} REVISAR` : 'SIN ALERTA'}</span></td>
              </tr>)}
            </tbody></table></div>
          </section>;
        })}
      </section>
      <footer className="tv-footer"><p>Selecciona una hora para revisar el detalle de una operación.</p><p>Vista actualizada automáticamente.</p></footer>
      {horaInspeccion && <HourInspectionModal hora={horaInspeccion.hora} modalidad={horaInspeccion.modalidad} grupos={grupos.filter((group) => group.modalidad === horaInspeccion.modalidad)} seguimiento={seguimiento.filter((item) => item.modalidad === horaInspeccion.modalidad)} reportDate={reportDate} onClose={() => setHoraInspeccion(null)} />}
    </main>
  );
}

function InternalScreen({ resumen, grupos, seguimiento, resumenSeguimiento, updatedAt, reportDate, dataMode, incidentes, user, authEnabled, onLogout }: { resumen: Resumen[]; grupos: GrupoFlujo[]; seguimiento: SeguimientoLlegada[]; resumenSeguimiento: Record<Modalidad, ResumenSeguimiento>; updatedAt: string; reportDate: string | null; dataMode: 'demo' | 'reportes'; incidentes: IncidenteOperativo[]; user: UsuarioSesion | null; authEnabled: boolean; onLogout: () => Promise<void> }) {
  const seccion = window.location.pathname === '/configuracion' ? 'CONFIGURACION' : window.location.pathname === '/reportes' ? 'REPORTES' : 'OPERACION';
  const [menuContraido, setMenuContraido] = useState(false);
  const [filtro, setFiltro] = useState<Modalidad | 'TODAS'>('TODAS');
  const [vista, setVista] = useState<'RESUMEN' | 'LISTA'>('RESUMEN');
  const [seleccionado, setSeleccionado] = useState<GrupoFlujo | null>(null);
  const [horaInspeccion, setHoraInspeccion] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState('');
  const [horaFiltro, setHoraFiltro] = useState('');
  const [situacionFiltro, setSituacionFiltro] = useState<'TODAS' | 'ALERTA' | 'PROXIMA' | 'SIN_MOVIMIENTOS' | 'PENDIENTE_BALANZA' | 'CON_SALIDA_BALANZA' | 'MULTIPLES'>('TODAS');
  const seguimientoPorCita = useMemo(() => new Map(seguimiento.map((item) => [item.id, item])), [seguimiento]);
  const gruposFiltrados = useMemo(() => grupos.filter((group) => {
    if (!group.modalidad || !modalidadesVisibles.includes(group.modalidad)) return false;
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
    if (situacionFiltro === 'PENDIENTE_BALANZA') return group.movimientos.some((movimiento) => Boolean(movimiento.fechaGarita) && !tieneSegundoPesajeValido(movimiento));
    if (situacionFiltro === 'CON_SALIDA_BALANZA') return group.movimientos.some(tieneSegundoPesajeValido);
    if (situacionFiltro === 'MULTIPLES') return group.tipo === 'MULTIPLE';
    return true;
  }), [grupos, filtro, busqueda, horaFiltro, situacionFiltro, seguimientoPorCita]);
  const citasOrdenadas = useMemo(() => gruposFiltrados
    .flatMap((group) => group.citas.map((cita) => ({ group, cita })))
    .sort((a, b) => (a.cita.fechaCita ?? '').localeCompare(b.cita.fechaCita ?? '') || a.group.volante.localeCompare(b.group.volante)), [gruposFiltrados]);
  const seguimientoFiltrado = seguimiento.filter((item) => modalidadesVisibles.includes(item.modalidad) && (filtro === 'TODAS' || item.modalidad === filtro));
  const resumenHora = crearDetalleFlujo(gruposFiltrados, reportDate, seguimientoFiltrado);
  const alertas = seguimientoFiltrado.filter((item) => esCritico(item.estado) || esProximo(item.estado));
  const totales = resumen.filter((item) => modalidadesVisibles.includes(item.modalidad)).reduce((acumulado, item) => ({
    agendadas: acumulado.agendadas + item.agendadas,
    garita: acumulado.garita + item.garita,
    despacho: acumulado.despacho + item.despacho,
    completadas: acumulado.completadas + item.completadas,
    noCompletadas: acumulado.noCompletadas + item.noCompletadas
  }), { agendadas: 0, garita: 0, despacho: 0, completadas: 0, noCompletadas: 0 });
  const seguimientoTotal = modalidadesVisibles.reduce((total, modalidad) => ({
    criticas: total.criticas + resumenSeguimiento[modalidad].criticas,
    proximas: total.proximas + resumenSeguimiento[modalidad].proximas,
    pesoObservado: total.pesoObservado + resumenSeguimiento[modalidad].pesoObservado
  }), { criticas: 0, proximas: 0, pesoObservado: 0 });

  return (
    <main className={`internal-screen ${menuContraido ? 'sidebar-collapsed' : ''}`}>
      {seccion === 'OPERACION' && <header className="internal-header">
        <div>
          <h1>Dashboard operativo</h1>
          {reportDate && <p>Información del {formatDate(reportDate)}</p>}
        </div>
        <div className="internal-actions"><a className="tv-mode-button" href="/tv"><TvIcon />Modo TV</a><p>{dataMode === 'reportes' ? 'Datos importados' : 'Modo demostración'} · actualizado {formatHour(updatedAt)}</p></div>
      </header>}
      {authEnabled && user && <button className="logout-button" onClick={() => void onLogout()} aria-label={`Cerrar sesión de ${user.nombre}`} title="Cerrar sesión"><LogoutIcon /></button>}

      <nav className={`section-nav ${menuContraido ? 'collapsed' : ''}`} aria-label="Secciones del dashboard">
        <div className="sidebar-brand"><img src="/alfosac-logo-blanco.png" alt="Alfosac" /></div>
        <button className="sidebar-toggle" onClick={() => setMenuContraido((value) => !value)} aria-label={menuContraido ? 'Desplegar menú' : 'Contraer menú'} title={menuContraido ? 'Desplegar menú' : 'Contraer menú'}>{menuContraido ? '›' : '‹'}</button>
        <a className={seccion === 'OPERACION' ? 'selected' : ''} href="/" title="Seguimiento en vivo"><span className="nav-symbol">◉</span><span>Seguimiento en vivo</span></a>
        <a className={seccion === 'REPORTES' ? 'selected' : ''} href="/reportes" title="Reportes"><span className="nav-symbol">⇩</span><span>Reportes</span></a>
        <a className={seccion === 'CONFIGURACION' ? 'selected' : ''} href="/configuracion" title="Configuración"><span className="nav-symbol">⚙</span><span>Configuración</span></a>
      </nav>

      {seccion === 'OPERACION' && <>
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
            {modalidadesVisibles.map((item) => <button className={filtro === item ? 'selected' : ''} key={item} onClick={() => setFiltro(item)}>{nombres[item]}</button>)}
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
            <thead><tr><th>Hora de cita</th><th>Citas</th><th>Garita Falcon</th><th>Ingreso a balanza</th><th>Salida por balanza</th><th>Por revisar</th><th>Estado</th></tr></thead>
            <tbody>{resumenHora.length > 0 ? resumenHora.map((item) => (
              <tr key={item.hora} className={`summary-hour-row ${item.critical ? 'critical-row' : item.warning ? 'warning-row' : ''}`} onClick={() => setHoraInspeccion(item.hora)}><td>{item.hora}</td><td>{item.citas}</td><td>{item.garita}</td><td>{item.ingreso}</td><td>{item.despacho}</td><td>{item.revisar}</td><td><span className={item.critical ? 'state-badge state-alert' : 'state-badge'}>{item.critical ? `${item.pendientes} alerta(s)` : item.warning ? 'Próxima alerta' : item.incidencias ? 'Incidencia general' : item.revisar ? 'Por revisar' : 'Sin alerta'}</span></td></tr>
            )) : <tr><td colSpan={7} className="empty">No hay operaciones para este filtro.</td></tr>}</tbody>
          </table> : <table className="operations-table detail-list">
            <thead>
              <tr>
                <th>F. cita</th><th>Hora cita</th><th>Volante / A.R.</th><th>Placa</th><th>Registro</th><th>T. espera</th>
                <th>Ingreso</th><th>Salida</th><th>T. atención</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {citasOrdenadas.length ? citasOrdenadas.map(({ group, cita }) => {
                const movimientos = movimientosConfirmados(group);
                const esMultiple = esAtencionMultiple(group);
                const movimiento = movimientos.length === 1 ? movimientos[0] : undefined;
                const placa = esMultiple ? `${movimientos.length} unidades` : movimiento?.placa ?? cita.unidad ?? '—';
                const visual = esMultiple ? groupVisualState(group, seguimientoPorCita) : citaVisualState(cita, movimiento, seguimientoPorCita.get(cita.id));
                return <tr key={`${group.volante}-${cita.id}`}>
                  <td>{cita.fechaCita ? formatDateShort(cita.fechaCita) : '—'}</td>
                  <td>{cita.fechaCita ? formatTime(cita.fechaCita) : '—'}</td>
                  <td><strong>{group.volante}</strong></td>
                  <td>{placa}</td>
                  <td>{cita.fechaGarita ? formatTime(cita.fechaGarita) : '—'}</td>
                  {esMultiple ? <><td className="duration-cell">Ver detalle</td><td>{movimientos.length} ingresos</td><td>{movimientos.filter(tieneSegundoPesajeValido).length} salidas</td><td className="duration-cell">Por unidad</td></> : <><DurationTableCell start={cita.fechaGarita} end={movimiento?.fechaGarita ?? null} tipo="ESPERA" cita={cita} /><td>{movimiento?.fechaGarita ? formatTime(movimiento.fechaGarita) : '—'}</td><td>{movimiento && tieneSegundoPesajeValido(movimiento) ? formatTime(movimiento.fechaSalidaBalanza!) : '—'}</td><DurationTableCell start={movimiento?.fechaGarita ?? null} end={movimiento && tieneSegundoPesajeValido(movimiento) ? movimiento.fechaSalidaBalanza : null} tipo="ATENCION" /></>}
                  <td><button className={`health-face health-face-${visual}`} onClick={() => setSeleccionado(group)} title="Ver detalle de la operación" aria-label={`Ver detalle: ${faceLabel(visual)}`}><HealthFace state={visual} /></button></td>
                </tr>;
              }) : <tr><td colSpan={10} className="empty">No hay operaciones para estos filtros.</td></tr>}
            </tbody>
          </table>}
        </div>
      </section>
      </>}

      {seccion === 'REPORTES' && <ReportesPanel reportDate={reportDate} />}
      {seccion === 'CONFIGURACION' && user && <ConfiguracionPanel user={user} />}

      {seleccionado && <FlowModal group={seleccionado} seguimiento={seguimientoPorCita} onClose={() => setSeleccionado(null)} />}
      {horaInspeccion && <HourInspectionModal hora={horaInspeccion} modalidad={filtro === 'TODAS' ? null : filtro} grupos={gruposFiltrados} seguimiento={seguimientoFiltrado} reportDate={reportDate} onClose={() => setHoraInspeccion(null)} />}
    </main>
  );
}

type VisualState = 'ok' | 'warning' | 'alert' | 'unknown';

function groupVisualState(group: GrupoFlujo, seguimientoPorCita: Map<string, SeguimientoLlegada>): VisualState {
  const estados = group.citas.map((cita) => seguimientoPorCita.get(cita.id)).filter((item): item is SeguimientoLlegada => Boolean(item));
  // En vivo, la carita debe expresar la etapa actual. La demora ya terminada
  // de garita a primer pesaje se conserva como hito, no como alerta vigente.
  if (estados.length) {
    if (estados.some((item) => esCritico(item.estado))) return 'alert';
    const amarillosActivos = estados.filter((item) => esProximo(item.estado)).length;
    if (amarillosActivos >= 2) return 'warning';
    // Una cita que finalizó vuelve a PROGRAMADA. En ese caso se continúa
    // abajo con los tiempos históricos para no mostrarla como desconocida.
    if (estados.some((item) => item.estado !== 'PROGRAMADA') || amarillosActivos > 0) return 'ok';
  }
  const movimientos = movimientosConfirmados(group);
  const tonosEspera = group.citas.flatMap((cita) => movimientos.map((movimiento) => durationTone(durationSeconds(cita.fechaGarita, movimiento.fechaGarita), 'ESPERA', cita)));
  const tonosAtencion = movimientos.map((movimiento) => durationTone(duracionAtencionVisible(movimiento), 'ATENCION'));
  if (tonosEspera.includes('alert') || tonosAtencion.includes('alert')) return 'alert';
  const amarillosPorTiempo = tonosEspera.filter((tono) => tono === 'warning').length + tonosAtencion.filter((tono) => tono === 'warning').length;
  const amarillosActivos = estados.filter((item) => esProximo(item.estado)).length;
  if (amarillosPorTiempo + amarillosActivos >= 2) return 'warning';
  if (tonosEspera.some((tono) => tono !== null) || tonosAtencion.some((tono) => tono !== null) || amarillosActivos > 0) return 'ok';
  return 'unknown';
}

/** Una cita con varios movimientos del mismo volante representa un retiro fraccionado confirmado por ATC. */
function esAtencionMultiple(group: GrupoFlujo) {
  return group.citas.length === 1 && group.movimientos.length > 1;
}

/** Solo se atribuyen pesajes cuando el vínculo es único o es un retiro fraccionado válido. */
function movimientosConfirmados(group: GrupoFlujo) {
  return group.tipo === 'UNICO' || esAtencionMultiple(group) ? group.movimientos : [];
}

function citaVisualState(cita: Operacion, movimiento: MovimientoFisico | undefined, seguimiento: SeguimientoLlegada | undefined): VisualState {
  if (seguimiento) {
    if (esCritico(seguimiento.estado)) return 'alert';
    // Al finalizar un movimiento el seguimiento vuelve a PROGRAMADA. No se
    // debe perder el semáforo histórico: se evalúan abajo sus dos duraciones.
    if (seguimiento.estado !== 'PROGRAMADA') return 'ok';
  }
  const espera = durationSeconds(cita.fechaGarita, movimiento?.fechaGarita ?? null);
  const atencion = movimiento ? duracionAtencionVisible(movimiento) : null;
  const tonoEspera = durationTone(espera, 'ESPERA', cita);
  const tonoAtencion = durationTone(atencion, 'ATENCION');
  if (tonoEspera === 'alert' || tonoAtencion === 'alert') return 'alert';
  const amarillosPorTiempo = Number(tonoEspera === 'warning') + Number(tonoAtencion === 'warning');
  if (amarillosPorTiempo >= 2) return 'warning';
  if (espera !== null || atencion !== null) return 'ok';
  return 'unknown';
}

function faceLabel(state: VisualState) {
  return state === 'ok' ? 'operación sin rojos y con máximo una alerta amarilla' : state === 'warning' ? 'operación con dos o más alertas amarillas' : state === 'alert' ? 'operación con una alerta roja' : 'sin tiempos suficientes';
}

function HealthFace({ state }: { state: VisualState }) {
  const mouth = state === 'ok' ? 'M6 11.5c1 2.4 6 2.4 7 0' : state === 'warning' || state === 'unknown' ? 'M6.5 13h6' : 'M6 14c1-2.2 6-2.2 7 0';
  return <svg viewBox="0 0 19 19" aria-hidden="true"><circle className="face-base" cx="9.5" cy="9.5" r="8"/><circle className="face-eye" cx="6.9" cy="7.7" r=".95"/><circle className="face-eye" cx="12.1" cy="7.7" r=".95"/><path className="face-mouth" d={mouth}/></svg>;
}

function DurationTableCell({ start, end, tipo, cita }: { start: string | null; end: string | null; tipo: 'ESPERA' | 'ATENCION'; cita?: Operacion }) {
  const seconds = durationSeconds(start, end);
  if (seconds === null) return <td className="duration-cell">—</td>;
  return <td className={`duration-cell duration-${durationTone(seconds, tipo, cita)}`}>{formatDuration(seconds)}</td>;
}

function ReportesPanel({ reportDate }: { reportDate: string | null }) {
  const [periodo, setPeriodo] = useState<'DIARIO' | 'MENSUAL' | 'RANGO'>('DIARIO');
  const [fecha, setFecha] = useState(reportDate ?? new Date().toISOString().slice(0, 10));
  const [hasta, setHasta] = useState(reportDate ?? new Date().toISOString().slice(0, 10));
  const [modalidad, setModalidad] = useState<'TODAS' | 'FCL' | 'LCL'>('TODAS');
  const [reporte, setReporte] = useState<ReporteOperativo | null>(null);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(true);

  useEffect(() => { if (reportDate) setFecha(reportDate); }, [reportDate]);
  const cambiarPeriodo = (siguiente: 'DIARIO' | 'MENSUAL' | 'RANGO') => {
    setPeriodo(siguiente);
    if (siguiente !== 'MENSUAL' && /^\d{4}-\d{2}$/.test(fecha)) setFecha(`${fecha}-01`);
  };
  useEffect(() => {
    let vigente = true;
    const params = new URLSearchParams({ periodo, fecha, modalidad });
    if (periodo === 'RANGO') params.set('hasta', hasta);
    setCargando(true);
    setReporte(null);
    setError('');
    void fetch(`/api/reports/operations?${params}`)
      .then(async (response) => response.ok ? response.json() as Promise<ReporteOperativo> : Promise.reject(await response.json()))
      .then((value) => { if (vigente) { setReporte(value); setError(''); } })
      .catch((reason: { message?: string }) => { if (vigente) { setReporte(null); setError(reason.message ?? 'No se pudo generar el reporte.'); } })
      .finally(() => { if (vigente) setCargando(false); });
    return () => { vigente = false; };
  }, [periodo, fecha, hasta, modalidad]);

  const params = new URLSearchParams({ periodo, fecha, modalidad });
  if (periodo === 'RANGO') params.set('hasta', hasta);
  const estadoCierre = reporte ? [
    { label: 'Atendidas en garita', value: reporte.estadisticas.registroGarita, tone: 'ok' },
    { label: 'Anuladas', value: reporte.cierre.anuladas ?? reporte.resumen.anuladas, tone: 'neutral' },
    { label: 'Canceladas / no atendidas', value: reporte.cierre.sinAtencion ?? reporte.resumen.noAtendidas, tone: 'alert' }
  ] : [];
  const anuladasReporte = reporte ? (reporte.cierre.anuladas ?? reporte.resumen.anuladas) : 0;
  const citasActivas = reporte?.estadisticas.citasAgendadas ?? 0;
  // El cierre entregado por Operaciones considera atenciones en garita y anulaciones.
  // Las no atendidas y los hitos GITS se muestran como información independiente.
  const totalCierreReporte = (reporte?.estadisticas.registroGarita ?? 0) + anuladasReporte;
  return <section className="reports-panel">
    <div className="panel-heading"><div><p className="brand">REPORTES</p><h2>Cierre operativo FCL y LCL</h2></div><a className="detail-button" href={`/api/reports/operations.xlsx?${params}`}>Descargar para Excel</a></div>
    <div className="reports-controls">
      <label>Período<select value={periodo} onChange={(event) => cambiarPeriodo(event.target.value as 'DIARIO' | 'MENSUAL' | 'RANGO')}><option value="DIARIO">Diario</option><option value="RANGO">Rango de fechas</option><option value="MENSUAL">Mensual</option></select></label>
      <label>{periodo === 'RANGO' ? 'Desde' : 'Fecha'}<input type={periodo === 'MENSUAL' ? 'month' : 'date'} value={periodo === 'MENSUAL' ? fecha.slice(0, 7) : fecha} onChange={(event) => setFecha(event.target.value)} /></label>
      {periodo === 'RANGO' && <label>Hasta<input type="date" min={fecha} value={hasta} onChange={(event) => setHasta(event.target.value)} /></label>}
      <label>Modalidad<select value={modalidad} onChange={(event) => setModalidad(event.target.value as 'TODAS' | 'FCL' | 'LCL')}><option value="TODAS">FCL y LCL</option><option value="FCL">FCL</option><option value="LCL">LCL</option></select></label>
    </div>
    {error ? <p className="empty">{error}</p> : reporte ? <>
      <div className="report-summary-grid">
        <section className="report-chart-card">
          <div className="report-card-heading"><div><p className="brand">CIERRE DE CITAS</p><h3>Resultado del período</h3><p className="report-active-caption">Citas activas: <b>{citasActivas}</b></p></div><strong>{totalCierreReporte}<small>total de cierre</small></strong></div>
          <ReportBarChart items={estadoCierre} />
        </section>
        <section className="report-performance-card">
          <div className="report-card-heading"><div><p className="brand">DESEMPEÑO OPERATIVO</p><h3>Hitos y tiempos</h3></div></div>
          <div className="report-metrics">
            <Kpi label="Registro en garita" value={reporte.estadisticas.registroGarita} />
            <Kpi label="Primer pesaje" value={reporte.estadisticas.primerPesaje ?? '—'} />
            <Kpi label="Salida por balanza" value={reporte.estadisticas.salidaBalanza ?? '—'} />
            <Kpi label="Espera promedio" value={reporte.estadisticas.esperaPromedioMinutos === null ? '—' : formatDuration(reporte.estadisticas.esperaPromedioMinutos * 60)} />
            <Kpi label="Atención promedio" value={reporte.estadisticas.atencionPromedioMinutos === null ? '—' : formatDuration(reporte.estadisticas.atencionPromedioMinutos * 60)} />
          </div>
        </section>
      </div>
      <div className="report-footnotes"><span>Por confirmar: {reporte.resumen.porConfirmar}</span><span>Pesaje libre: {reporte.resumen.pesajesLibres}</span></div>
    </> : cargando ? <ReportesSkeleton /> : <p className="empty">No hay información para los filtros seleccionados.</p>}
  </section>;
}

function ReportesSkeleton() {
  return <div className="report-skeleton" aria-label="Cargando reporte" role="status">
    <div className="report-skeleton-card"><i /><i /><i /></div>
    <div className="report-skeleton-card"><i /><i /><i /><i /></div>
  </div>;
}

function ConfiguracionPanel({ user }: { user: UsuarioSesion }) {
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const [mensajeClave, setMensajeClave] = useState('');
  const [usuarios, setUsuarios] = useState<UsuarioAdministrable[]>([]);
  const [nombre, setNombre] = useState('');
  const [correo, setCorreo] = useState('');
  const [claveUsuario, setClaveUsuario] = useState('');
  const [rol, setRol] = useState<UsuarioSesion['rol']>('LECTURA');
  const [mensajeUsuarios, setMensajeUsuarios] = useState('');

  const cargarUsuarios = () => {
    if (user.rol !== 'ADMIN') return;
    void fetch('/api/auth/users', { credentials: 'same-origin' })
      .then(async (response) => response.ok ? response.json() as Promise<{ users: UsuarioAdministrable[] }> : Promise.reject(await response.json()))
      .then((value) => setUsuarios(value.users))
      .catch(() => setMensajeUsuarios('No se pudo cargar la lista de usuarios.'));
  };

  useEffect(() => { cargarUsuarios(); }, [user.rol]);

  const guardarClave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (nueva !== confirmacion) { setMensajeClave('La confirmación no coincide.'); return; }
    try {
      const response = await fetch('/api/auth/password', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contrasenaActual: actual, contrasenaNueva: nueva })
      });
      if (!response.ok) throw await response.json();
      setActual(''); setNueva(''); setConfirmacion(''); setMensajeClave('Contraseña actualizada. Las demás sesiones de esta cuenta se cerraron.');
    } catch (reason: unknown) { setMensajeClave(reason instanceof Error ? reason.message : (typeof reason === 'object' && reason && 'message' in reason ? String(reason.message) : 'No se pudo actualizar la contraseña.')); }
  };

  const crearCuenta = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      const response = await fetch('/api/auth/users', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre, email: correo, password: claveUsuario, rol })
      });
      if (!response.ok) throw await response.json();
      setNombre(''); setCorreo(''); setClaveUsuario(''); setRol('LECTURA');
      setMensajeUsuarios('Usuario creado correctamente.');
      cargarUsuarios();
    } catch (reason: unknown) { setMensajeUsuarios(reason instanceof Error ? reason.message : (typeof reason === 'object' && reason && 'message' in reason ? String(reason.message) : 'No se pudo crear el usuario.')); }
  };

  return <section className="settings-panel">
    <div className="panel-heading"><div><p className="brand">CONFIGURACIÓN</p><h2>Acceso y usuarios</h2></div><p>{user.email}</p></div>
    <div className="settings-grid">
      <form className="settings-card" onSubmit={(event) => void guardarClave(event)}>
        <div><h3>Actualizar contraseña</h3></div>
        <label>Contraseña actual<input type="password" autoComplete="current-password" value={actual} onChange={(event) => setActual(event.target.value)} required /></label>
        <label>Nueva contraseña<input type="password" autoComplete="new-password" minLength={14} value={nueva} onChange={(event) => setNueva(event.target.value)} required /></label>
        <label>Confirmar nueva contraseña<input type="password" autoComplete="new-password" minLength={14} value={confirmacion} onChange={(event) => setConfirmacion(event.target.value)} required /></label>
        {mensajeClave && <p className="settings-message">{mensajeClave}</p>}
        <button className="settings-submit" type="submit">Guardar contraseña</button>
      </form>
      {user.rol === 'ADMIN' && <form className="settings-card" onSubmit={(event) => void crearCuenta(event)}>
        <div><h3>Crear usuario</h3></div>
        <label>Nombre<input value={nombre} onChange={(event) => setNombre(event.target.value)} minLength={2} required /></label>
        <label>Correo<input type="email" value={correo} onChange={(event) => setCorreo(event.target.value)} required /></label>
        <label>Contraseña inicial<input type="password" autoComplete="new-password" value={claveUsuario} onChange={(event) => setClaveUsuario(event.target.value)} minLength={14} required /></label>
        <label>Perfil<select value={rol} onChange={(event) => setRol(event.target.value as UsuarioSesion['rol'])}><option value="LECTURA">Lectura</option><option value="OPERADOR">Operador</option><option value="ADMIN">Administrador</option></select></label>
        {mensajeUsuarios && <p className="settings-message">{mensajeUsuarios}</p>}
        <button className="settings-submit" type="submit">Crear usuario</button>
      </form>}
    </div>
    {user.rol === 'ADMIN' && <section className="settings-users"><h3>Usuarios registrados</h3><div className="operations-table-wrap"><table><thead><tr><th>Nombre</th><th>Correo</th><th>Perfil</th><th>Estado</th></tr></thead><tbody>{usuarios.map((item) => <tr key={item.id}><td>{item.nombre}</td><td>{item.email}</td><td>{item.rol}</td><td>{item.activo ? 'Activo' : 'Inactivo'}</td></tr>)}</tbody></table></div></section>}
  </section>;
}

function ReportBarChart({ items }: { items: Array<{ label: string; value: number | null; tone: string }> }) {
  const max = Math.max(1, ...items.map((item) => item.value ?? 0));
  return <div className="report-bars" role="img" aria-label="Gráfico de cierre de citas">
    {items.map((item) => {
      const value = item.value ?? 0;
      return <div className="report-bar-row" key={item.label}>
        <div className="report-bar-label"><span>{item.label}</span><strong>{item.value ?? '—'}</strong></div>
        <div className="report-bar-track"><i className={`report-bar report-bar-${item.tone}`} style={{ width: `${item.value === null ? 0 : Math.max(3, (value / max) * 100)}%` }} /></div>
      </div>;
    })}
  </div>;
}

function ExportacionPanel({ reportDate }: { reportDate: string | null }) {
  const [periodo, setPeriodo] = useState<'DIARIO' | 'MENSUAL'>('DIARIO');
  const [fecha, setFecha] = useState(reportDate ?? new Date().toISOString().slice(0, 10));
  const [modalidad, setModalidad] = useState<'TODAS' | 'FCL' | 'LCL'>('TODAS');
  useEffect(() => { if (reportDate) setFecha(reportDate); }, [reportDate]);
  const params = new URLSearchParams({ periodo, fecha, modalidad });
  return <section className="export-panel">
    <div className="panel-heading"><div><p className="brand">EXPORTACIÓN</p><h2>Descargar reporte operativo</h2></div></div>
    <p className="report-note">Genera un archivo CSV compatible con Excel. No realiza cambios en Falcon ni en GITS.</p>
    <div className="reports-controls">
      <label>Período<select value={periodo} onChange={(event) => setPeriodo(event.target.value as 'DIARIO' | 'MENSUAL')}><option value="DIARIO">Diario</option><option value="MENSUAL">Mensual</option></select></label>
      <label>Fecha<input type={periodo === 'DIARIO' ? 'date' : 'month'} value={periodo === 'DIARIO' ? fecha : fecha.slice(0, 7)} onChange={(event) => setFecha(event.target.value)} /></label>
      <label>Modalidad<select value={modalidad} onChange={(event) => setModalidad(event.target.value as 'TODAS' | 'FCL' | 'LCL')}><option value="TODAS">FCL y LCL</option><option value="FCL">FCL</option><option value="LCL">LCL</option></select></label>
    </div>
    <a className="export-download" href={`/api/reports/operations.xlsx?${params}`}>Descargar archivo para Excel</a>
  </section>;
}

function sumarDias(fecha: string, dias: number) {
  const value = new Date(`${fecha}T12:00:00`);
  value.setDate(value.getDate() + dias);
  return value.toISOString().slice(0, 10);
}

function DisponibilidadHistoricaPanel({ reportDate }: { reportDate: string | null }) {
  const [fecha, setFecha] = useState(reportDate ?? new Date().toISOString().slice(0, 10));
  const [modalidad, setModalidad] = useState<'FCL' | 'LCL' | 'BB'>('FCL');
  const [snapshots, setSnapshots] = useState<Array<Pick<DisponibilidadHistorica, 'fecha' | 'modalidades'>>>([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');
  const dias = useMemo(() => Array.from({ length: 7 }, (_, index) => sumarDias(fecha, index)), [fecha]);
  const hasta = dias.at(-1) ?? fecha;
  const hoyLima = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const esHistorico = fecha < hoyLima;

  useEffect(() => { if (reportDate) setFecha(reportDate); }, [reportDate]);
  useEffect(() => {
    setCargando(true);
    const endpoint = esHistorico ? `/api/availability/history-range?desde=${fecha}&hasta=${hasta}` : `/api/availability/current?desde=${fecha}&dias=7`;
    void fetch(endpoint)
      .then(async (response) => response.ok ? response.json() as Promise<{ snapshots: DisponibilidadHistorica[] }> : Promise.reject(await response.json()))
      .then((value) => { setSnapshots(value.snapshots); setError(''); })
      .catch((reason: { message?: string }) => { setSnapshots([]); setError(reason.message ?? 'No se pudo consultar el historial.'); })
      .finally(() => setCargando(false));
  }, [fecha, hasta, esHistorico]);

  const horasFuente = [...new Set(snapshots.flatMap((item) => item.modalidades.find((value) => value.modalidad === modalidad)?.horas.map((value) => value.hora) ?? []))].sort((a, b) => a - b);
  const horas = horasFuente.length ? horasFuente : modalidad === 'FCL' ? Array.from({ length: 24 }, (_, index) => index) : Array.from({ length: 14 }, (_, index) => index + 7);
  const cupo = (dia: string, hora: number) => snapshots.find((item) => item.fecha === dia)?.modalidades.find((item) => item.modalidad === modalidad)?.horas.find((item) => item.hora === hora)?.cuposDisponibles ?? null;
  const estadoCupo = (value: number | null) => value === null ? 'availability-empty' : value === 0 ? 'availability-full' : value <= 2 ? 'availability-low' : 'availability-open';

  return <section className="availability-panel">
    <div className="availability-title"><p className="brand">CITAS AGENDADAS</p><h2>Disponibilidad de citas</h2><p>Selecciona el tipo de servicio para consultar los cupos disponibles.</p><label>Fecha inicial<input type="date" value={fecha} onChange={(event) => setFecha(event.target.value)} /></label></div>
    <div className="availability-toolbar"><div className="filter-row"><button className={modalidad === 'FCL' ? 'selected' : ''} onClick={() => setModalidad('FCL')}>FCL IMP</button><button className={modalidad === 'LCL' ? 'selected' : ''} onClick={() => setModalidad('LCL')}>LCL IMP</button><button className={modalidad === 'BB' ? 'selected' : ''} onClick={() => setModalidad('BB')}>BB IMP</button></div><p><span className="availability-key availability-open">3+</span> Disponibles <span className="availability-key availability-low">1–2</span> Últimos cupos <span className="availability-key availability-full">0</span> Sin cupos <span className="availability-key availability-empty">—</span> Sin horario</p></div>
    {error ? <p className="empty">{error}</p> : cargando ? <p className="empty">Consultando disponibilidad…</p> : <>
      <p className="report-note">{esHistorico ? `Vista histórica: ${snapshots.length} día(s) con captura almacenada.` : 'Disponibilidad actual consultada en Falcon.'} Las capturas nocturnas se guardan a las 11:59 p. m.</p>
      <div className="availability-range-wrap"><table className="availability-range-table"><thead><tr><th>Fecha</th>{horas.map((hora) => <th key={hora}>{String(hora).padStart(2, '0')}:00</th>)}</tr></thead><tbody>{dias.map((dia) => <tr key={dia}><td>{formatDate(dia)}</td>{horas.map((hora) => { const value = cupo(dia, hora); return <td className={estadoCupo(value)} key={hora}>{value ?? '—'}</td>; })}</tr>)}</tbody></table></div>
    </>}
  </section>;
}

function difference(start: string | null, end: string | null) {
  if (!start || !end) return '—';
  const minutes = Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60_000));
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function durationSeconds(start: string | null, end: string | null) {
  if (!start || !end) return null;
  return Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1_000));
}

function formatDuration(seconds: number) {
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainingSeconds = seconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
}

function formatMinutes(minutes: number) {
  return formatDuration(Math.max(0, minutes) * 60);
}

function citaVencida(cita: Operacion | undefined) {
  if (!cita?.fechaCita || !cita.fechaGarita) return false;
  return new Date(cita.fechaGarita).getTime() > new Date(cita.fechaCita).getTime() + minutosToleranciaCita * 60_000;
}

function durationTone(seconds: number | null, tipo: 'ESPERA' | 'ATENCION', cita?: Operacion): 'ok' | 'warning' | 'alert' | null {
  if (seconds === null) return null;
  const minutes = seconds / 60;
  if (tipo === 'ESPERA') {
    const limiteNaranja = citaVencida(cita) ? minutosNaranjaEsperaVencida : minutosNaranjaEsperaVigente;
    const limiteRojo = citaVencida(cita) ? minutosRojoEsperaVencida : minutosRojoEsperaVigente;
    if (minutes > limiteRojo) return 'alert';
    if (minutes > limiteNaranja) return 'warning';
    return 'ok';
  }
  if (minutes > minutosRojoAtencion) return 'alert';
  if (minutes > minutosNaranjaAtencion) return 'warning';
  return 'ok';
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

function FlowModal({ group, seguimiento, onClose }: { group: GrupoFlujo; seguimiento: Map<string, SeguimientoLlegada>; onClose: () => void }) {
  const alertas = alertasDiagnosticoGrupo(group, seguimiento);
  const visual = groupVisualState(group, seguimiento);
  const telefono = group.citas.map((cita) => cita.telefonoContacto).find(Boolean) ?? null;
  const aereos = group.aereosAsociados ?? [];
  const pesoAereo = pesoAereoAsociado(group);
  const pesoRecibido = pesoRecibidoFalcon(group);
  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="operation-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
      <header className="modal-header"><div><p className="brand">VOLANTE</p><h2>{group.volante}</h2></div><button className="close-button" onClick={onClose} aria-label="Cerrar detalle">×</button></header>
      <section className="alerts-section">
        <div className="alerts-heading"><div><p className="brand">DIAGNÓSTICO</p><h3>{alertas.length ? 'Alertas detectadas' : 'Operación sin alertas activas'}</h3></div><span className={`alert-count alert-count-${visual}`}>{alertas.length || 'OK'}</span></div>
        {alertas.length ? <div className="alert-cards">{alertas.map((alerta) => <DiagnosticAlertCard key={alerta.key} alerta={alerta} telefono={telefono} />)}</div>
          : <p className="no-alerts">Los hitos disponibles se encuentran dentro de los tiempos de referencia.</p>}
      </section>
      <h3>Citas Falcon ({group.citas.length})</h3>
      {group.citas.length ? <ol className="timeline">{group.citas.map((cita) => <li key={cita.id} className="done"><span>{cita.modalidad} · cita {cita.fechaCita ? formatDateTime(cita.fechaCita) : 'sin fecha'}</span><strong>{cita.id}</strong></li>)}</ol> : <p>GITS registró este movimiento sin una cita Falcon vinculable.</p>}
      {esAtencionMultiple(group) && <p className="multiple-attention-note"><strong>Atención múltiple confirmada</strong> · {group.movimientos.length} unidades retiraron el mismo volante. Los tiempos se evalúan por placa y los pesos se consolidan.</p>}
      {aereos.length > 0 && <><h3 className="flow-heading">Retiros aéreos asociados ({aereos.length})</h3><ol className="timeline">{aereos.map((aereo) => <li key={`${aereo.volante}-${aereo.fechaGarita}`} className="done"><span>Volante {aereo.volante} · placa {aereo.placa} · garita {formatDateTime(aereo.fechaGarita)} · diferencia {aereo.diferenciaMinutos.toFixed(1)} min</span><strong>{aereo.pesoDeclarado == null ? 'Peso sin dato' : `${formatWeight(aereo.pesoDeclarado)} declarado`}</strong><small>Primer pesaje: {aereo.primerPesaje ? formatDateTime(aereo.primerPesaje) : 'Pendiente'} · Salida: {aereo.segundoPesaje ? formatDateTime(aereo.segundoPesaje) : 'Pendiente'}</small></li>)}</ol></>}
      <h3 className="flow-heading">Movimientos físicos GITS ({group.movimientos.length})</h3>
      {group.movimientos.length ? <ol className="timeline">{group.movimientos.map((movement) => {
        const citaRelacionada = group.citas[0];
        const espera = durationSeconds(citaRelacionada?.fechaGarita ?? null, movement.fechaGarita);
        const tonoEspera = durationTone(espera, 'ESPERA', citaRelacionada);
        return <li key={movement.movimiento} className="done"><span>Ingreso a balanza: {movement.fechaGarita ? formatDateTime(movement.fechaGarita) : 'Sin hora'} · Salida por balanza: {tieneSegundoPesajeValido(movement) ? formatDateTime(movement.fechaSalidaBalanza!) : 'Pendiente de segundo pesaje'} · Placa: {movement.placa ?? '—'}</span><strong>{movement.contenedor ?? movement.movimiento}</strong><small>{espera !== null && <>Espera desde garita: <b className={`duration-${tonoEspera}`}>{formatDuration(espera)}</b> · </>}Pesos de balanza: {formatWeight(movement.pesoInicial)} / {formatWeight(movement.pesoFinal)} / neto {formatWeight(movement.pesoNetoBalanza)} · Peso recibido Falcon: {formatWeight(pesoRecibido)} · Manifestado GITS: {formatWeight(movement.pesoMercaderiaDeclarado)}{aereos.length > 0 && <> · Aéreo asociado: {formatWeight(pesoAereo)} · Total recibido: {formatWeight(pesoNumerico(pesoRecibido) + pesoAereo)}</>}</small></li>;
      })}</ol> : <p>Aún no hay registro físico en GITS.</p>}
    </section>
  </div>;
}

function DiagnosticAlertCard({ alerta, telefono }: { alerta: DiagnosticoAlerta; telefono: string | null }) {
  return <article className={`alert-card alert-card-${alerta.tone}`}>
    <div className="alert-card-top"><span className={`alert-severity alert-severity-${alerta.tone}`}>{alerta.level}</span><strong>{alerta.title}</strong></div>
    <dl className="alert-metrics">
      <div><dt>Referencia</dt><dd>{formatDateTime(alerta.fechaReferencia)}</dd></div>
      {alerta.duracion && <div><dt>Tiempo</dt><dd>{alerta.duracion}</dd></div>}
      {alerta.porcentajePeso != null && <div><dt>Diferencia</dt><dd>{(alerta.porcentajePeso * 100).toFixed(1)}%</dd></div>}
    </dl>
    {alerta.contact && <div className="alert-contact"><strong>Contacto</strong><span>{telefono ? telefono : 'Pendiente de registro en Falcon'}</span>{!telefono && <small>Cuando Falcon incorpore el teléfono, se mostrará aquí para que ATC contacte al responsable.</small>}</div>}
    <small className="alert-citation">Cita {alerta.cita.fechaCita ? formatDateTime(alerta.cita.fechaCita) : 'sin fecha'} · {alerta.cita.modalidad}</small>
  </article>;
}

/**
 * El detalle debe explicar la misma señal que dibuja la carita. El seguimiento
 * en vivo solo existe para la fecha actual; estas reglas también revisan hitos
 * ya terminados para que un reporte histórico no quede con una carita roja sin
 * diagnóstico.
 */
function alertasDiagnosticoGrupo(group: GrupoFlujo, seguimiento: Map<string, SeguimientoLlegada>): DiagnosticoAlerta[] {
  const alertas: DiagnosticoAlerta[] = [];
  const claves = new Set<string>();
  const agregar = (alerta: DiagnosticoAlerta) => {
    if (!claves.has(alerta.key)) {
      claves.add(alerta.key);
      alertas.push(alerta);
    }
  };

  group.citas.forEach((cita) => {
    const item = seguimiento.get(cita.id);
    if (!item || item.estado === 'PROGRAMADA') return;
    const detail = alertDetail(item);
    if (detail.tone === 'ok') return;
    agregar({
      key: `seguimiento-${cita.id}-${item.estado}`,
      tone: detail.tone as 'warning' | 'alert', level: detail.level, title: detail.title, cita,
      fechaReferencia: item.fechaReferencia,
      duracion: detail.showElapsed ? formatMinutes(item.minutosRetraso) : undefined,
      porcentajePeso: item.estado === 'PESO_OBSERVADO' ? item.porcentajePeso : undefined,
      contact: detail.contact
    });
  });

  const movimientos = movimientosConfirmados(group);
  const cita = group.citas[0];
  if (!movimientos.length || !cita) return alertas;
  const tieneSeguimientoEnVivo = group.citas.some((citaGrupo) => seguimiento.has(citaGrupo.id));
  const seguimientoAtencion = group.citas.some((citaGrupo) => {
    const estado = seguimiento.get(citaGrupo.id)?.estado;
    return estado === 'BALANZA_SIN_SALIDA' || estado === 'EN_BALANZA';
  });

  movimientos.forEach((movimiento) => {
    const espera = durationSeconds(cita.fechaGarita, movimiento.fechaGarita);
    const tonoEspera = durationTone(espera, 'ESPERA', cita);
    if (!tieneSeguimientoEnVivo && espera !== null && (tonoEspera === 'warning' || tonoEspera === 'alert')) {
      agregar({ key: `espera-${cita.id}-${movimiento.movimiento}`, tone: tonoEspera, level: tonoEspera === 'alert' ? 'CRÍTICA' : 'SEGUIMIENTO', title: `Demora de garita a primer pesaje${esAtencionMultiple(group) ? ` · ${movimiento.placa ?? 'sin placa'}` : ''}`, cita, fechaReferencia: cita.fechaGarita!, duracion: formatDuration(espera) });
    }

    const atencion = duracionAtencionVisible(movimiento);
    const tonoAtencion = durationTone(atencion, 'ATENCION');
    if (!seguimientoAtencion && atencion !== null && (tonoAtencion === 'warning' || tonoAtencion === 'alert')) {
      const sinSalida = !tieneSegundoPesajeValido(movimiento);
      agregar({ key: `atencion-${cita.id}-${movimiento.movimiento}`, tone: tonoAtencion, level: tonoAtencion === 'alert' ? 'CRÍTICA' : 'SEGUIMIENTO', title: `${sinSalida ? 'Primer pesaje GITS sin salida por balanza' : 'Demora en atención operativa'}${esAtencionMultiple(group) ? ` · ${movimiento.placa ?? 'sin placa'}` : ''}`, cita, fechaReferencia: movimiento.fechaGarita!, duracion: formatDuration(atencion) });
    }
  });

  const porcentajePeso = cita.modalidad === 'LCL' ? porcentajeDiferenciaPesoGrupo(group) : null;
  // El seguimiento ya genera PESO_OBSERVADO para esta misma cita. La
  // comprobación local solo es un respaldo para datos históricos sin ese
  // seguimiento, de modo que no se presenten dos tarjetas iguales.
  const pesoYaDiagnosticado = group.citas.some((citaGrupo) => seguimiento.get(citaGrupo.id)?.estado === 'PESO_OBSERVADO');
  if (porcentajePeso != null && porcentajePeso > toleranciaPeso && !pesoYaDiagnosticado) {
    const ultimoMovimiento = movimientos.at(-1)!;
    agregar({ key: `peso-${cita.id}`, tone: 'alert', level: 'CRÍTICA', title: 'Diferencia de peso por validar', cita, fechaReferencia: ultimoMovimiento.fechaSalidaBalanza ?? ultimoMovimiento.fechaGarita!, porcentajePeso });
  }
  return alertas;
}

function alertDetail(item: SeguimientoLlegada) {
  switch (item.estado) {
    case 'CITA_VENCIDA': return { tone: 'alert', level: 'CRÍTICA', title: 'Cita vencida', contact: true, showElapsed: true };
    case 'CITA_POR_VENCER': return { tone: 'warning', level: 'SEGUIMIENTO', title: 'Cita por vencer', contact: true, showElapsed: true };
    case 'GARITA_SIN_INGRESO': return { tone: 'alert', level: 'CRÍTICA', title: 'Demora para ingreso al DT', contact: true, showElapsed: true };
    case 'EN_GARITA': return { tone: 'warning', level: 'SEGUIMIENTO', title: 'Demora desde garita', contact: false, showElapsed: true };
    case 'BALANZA_SIN_SALIDA': return { tone: 'alert', level: 'CRÍTICA', title: 'Primer pesaje sin salida', contact: false, showElapsed: true };
    case 'EN_BALANZA': return { tone: 'warning', level: 'SEGUIMIENTO', title: 'Demora en balanza / despacho', contact: false, showElapsed: true };
    case 'PESO_OBSERVADO': return { tone: 'alert', level: 'CRÍTICA', title: 'Diferencia de peso por validar', contact: false, showElapsed: false };
    case 'VINCULO_PENDIENTE': return { tone: 'warning', level: 'REVISAR', title: 'Vínculo de datos pendiente', contact: false, showElapsed: false };
    case 'INCIDENCIA_OPERATIVA': return { tone: 'warning', level: 'REVISAR', title: 'Incidencia operativa activa', contact: false, showElapsed: false };
    default: return { tone: 'ok', level: 'OK', title: 'Operación controlada', contact: false, showElapsed: false };
  }
}

function HourInspectionModal({ hora, modalidad, grupos, seguimiento, reportDate, onClose }: { hora: string; modalidad: Modalidad | null; grupos: GrupoFlujo[]; seguimiento: SeguimientoLlegada[]; reportDate: string | null; onClose: () => void }) {
  const seguimientoPorCita = new Map(seguimiento.map((item) => [item.id, item]));
  const filasBase = grupos.flatMap((group) => {
    const movimientos = movimientosConfirmados(group);
    return group.citas
      .filter((cita) => cita.fechaCita
        && (!reportDate || fechaLima(cita.fechaCita) === reportDate)
        && formatTime(cita.fechaCita).slice(0, 5) === hora.slice(0, 5))
      .flatMap((cita) => (movimientos.length ? movimientos : [undefined]).map((movimiento) => {
        const estado = seguimientoPorCita.get(cita.id);
        const esRojo = Boolean(estado && esCritico(estado.estado));
        const esAmarillo = Boolean(estado && esProximo(estado.estado));
        const atencion = movimiento ? duracionAtencionVisible(movimiento) : null;
        const tonoTiempo = durationTone(atencion, 'ATENCION');
        const sinSalida = Boolean(movimiento && !tieneSegundoPesajeValido(movimiento));
        const etiqueta = esRojo || esAmarillo ? etiquetaSeguimiento(estado!)
          : sinSalida && tonoTiempo === 'alert' ? `Primer pesaje GITS sin salida por balanza · ${formatDuration(atencion!)}`
          : sinSalida && tonoTiempo === 'warning' ? `Primer pesaje GITS sin salida por balanza · ${formatDuration(atencion!)}`
          : estado?.estado === 'EN_ATENCION' ? 'En almacén / atención en curso'
          : movimiento && tieneSegundoPesajeValido(movimiento) ? 'Completado'
            : movimiento?.fechaGarita ? 'En balanza'
              : cita.fechaGarita ? 'En garita'
                : 'Programada';
        return { cita, movimiento, etiqueta: esAtencionMultiple(group) ? `${etiqueta} · atención múltiple` : etiqueta, tono: esRojo || tonoTiempo === 'alert' ? 'alert' : esAmarillo || tonoTiempo === 'warning' ? 'warning' : estado?.estado === 'EN_ATENCION' || movimiento && tieneSegundoPesajeValido(movimiento) ? 'ok' : 'unknown' };
      }));
  });
  // Mantiene juntas las citas atendidas por la misma unidad. Esto permite
  // reconocer visualmente un retiro conjunto sin duplicar los movimientos.
  const vistos = new Set<string>();
  const filas = filasBase.flatMap((fila) => {
    const placa = (fila.movimiento?.placa ?? fila.cita.unidad ?? '').trim().toUpperCase();
    if (!placa || placa === '-' || vistos.has(placa)) return [];
    vistos.add(placa);
    const asociadas = filasBase.filter((candidata) => (candidata.movimiento?.placa ?? candidata.cita.unidad ?? '').trim().toUpperCase() === placa);
    return asociadas.map((asociada, indice) => ({ ...asociada, grupoPlaca: asociadas.length > 1 ? { placa, indice, total: asociadas.length } : null }));
  });
  // Las filas sin placa se mantienen en el orden original y no se consideran
  // asociadas entre sí: Falcon aún no permite afirmar que son la misma UT.
  filas.push(...filasBase.filter((fila) => {
    const placa = (fila.movimiento?.placa ?? fila.cita.unidad ?? '').trim().toUpperCase();
    return !placa || placa === '-';
  }).map((fila) => ({ ...fila, grupoPlaca: null })));
  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="hour-inspection-modal" role="dialog" aria-modal="true" aria-label={`Inspección de ${hora}`} onMouseDown={(event) => event.stopPropagation()}>
      <header className="hour-inspection-header"><div><p>INSPECCIÓN POR HORA</p><h2>{hora} · {modalidad ? nombres[modalidad] : 'FCL y LCL'}</h2></div><button className="close-button" onClick={onClose} aria-label="Cerrar inspección">×</button></header>
      <div className="hour-inspection-note"><span>Detalle de citas, garita y pesajes asociados a este horario.</span><strong>{filas.length} {filas.length === 1 ? 'cita' : 'citas'}</strong></div>
      <div className="hour-inspection-table-wrap"><table className="hour-inspection-table"><thead><tr><th>Placa</th><th>Volante</th><th>Hora cita</th><th>T. espera</th><th>T. atención</th><th>Estado actual</th></tr></thead>
        <tbody>{filas.length ? filas.map(({ cita, movimiento, etiqueta, tono, grupoPlaca }) => {
          const espera = durationSeconds(cita.fechaGarita, movimiento?.fechaGarita ?? null);
          const atencion = movimiento ? duracionAtencionVisible(movimiento) : null;
          const claseGrupo = grupoPlaca ? ` inspection-associated inspection-associated-${grupoPlaca.indice === 0 ? 'start' : grupoPlaca.indice === grupoPlaca.total - 1 ? 'end' : 'middle'}` : '';
          return <tr className={claseGrupo} key={`${cita.id}-${movimiento?.movimiento ?? 'sin-movimiento'}`}><td>{movimiento?.placa ?? cita.unidad ?? '—'}</td><td>{cita.volante}</td><td>{cita.fechaCita ? formatTime(cita.fechaCita) : '—'}</td><td className={espera === null ? '' : `inspection-time duration-${durationTone(espera, 'ESPERA', cita)}`}>{espera === null ? '—' : formatDuration(espera)}</td><td className={atencion === null ? '' : `inspection-time duration-${durationTone(atencion, 'ATENCION')}`}>{atencion === null ? '—' : formatDuration(atencion)}</td><td><span className={`inspection-status inspection-status-${tono}`}>{etiqueta}</span></td></tr>;
        }) : <tr><td colSpan={6} className="empty">No hay citas para este horario.</td></tr>}</tbody>
      </table></div>
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

function LogoutIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /><path d="M10 17l5-5-5-5" /><path d="M15 12H3" /></svg>;
}

type DetalleHora = { hora: string; citas: number; garita: number; ingreso: number; despacho: number; proximas: number; pendientes: number; despachoDemorado: number; incidencias: number; revisar: number; critical: boolean; warning: boolean };

function horaLima(fecha: Date) {
  return Number(new Intl.DateTimeFormat('en-US', { hour: '2-digit', hourCycle: 'h23', timeZone: 'America/Lima' }).format(fecha));
}

function detalleHoraVacio(hora: number): DetalleHora {
  return { hora: `${String(hora).padStart(2, '0')}:00`, citas: 0, garita: 0, ingreso: 0, despacho: 0, proximas: 0, pendientes: 0, despachoDemorado: 0, incidencias: 0, revisar: 0, critical: false, warning: false };
}

/** Muestra solo la ventana operativa: dos horas previas, la actual y dos posteriores. */
function ventanaOperativaPorHora(detalle: DetalleHora[], horaActual: number) {
  const porHora = new Map(detalle.map((item) => [Number(item.hora.slice(0, 2)), item]));
  return [-2, -1, 0, 1, 2].map((desfase) => {
    const hora = (horaActual + desfase + 24) % 24;
    return porHora.get(hora) ?? detalleHoraVacio(hora);
  });
}

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
    grupos.forEach((group) => {
      const movimientos = movimientosConfirmados(group);
      group.citas.forEach((cita) => {
      const seguimientoCita = seguimientoPorCita.get(cita.id);
      const estado = seguimientoCita?.estado;
      const critical = estado ? esCritico(estado) : false;
      const warning = estado ? esProximo(estado) : false;
      const row = add(cita.fechaCita, 'citas', critical, warning);
      if (!row) return;
      if (cita.fechaGarita && (!reportDate || fechaLima(cita.fechaGarita) === reportDate)) row.garita += 1;
      movimientos.forEach((movimiento) => {
        if (movimiento.fechaGarita && (!reportDate || fechaLima(movimiento.fechaGarita) === reportDate)) row.ingreso += 1;
        if (tieneSegundoPesajeValido(movimiento) && (!reportDate || fechaLima(movimiento.fechaSalidaBalanza!) === reportDate)) row.despacho += 1;
      });
      if (estado === 'VINCULO_PENDIENTE') row.revisar += 1;
      if (estado === 'PESO_OBSERVADO') row.revisar += 1;
      if (estado === 'INCIDENCIA_OPERATIVA') row.incidencias += 1;
      });
    });
  } else {
    grupos.forEach((group) => group.citas.forEach((cita) => {
      const critical = cita.estado === 'NO_COMPLETADA';
      const row = add(cita.fechaCita, 'citas', critical);
      if (!row) return;
      if (cita.fechaGarita && (!reportDate || fechaLima(cita.fechaGarita) === reportDate)) row.garita += 1;
      movimientosConfirmados(group).forEach((movimiento) => {
        if (movimiento.fechaGarita && (!reportDate || fechaLima(movimiento.fechaGarita) === reportDate)) row.ingreso += 1;
        if (tieneSegundoPesajeValido(movimiento) && (!reportDate || fechaLima(movimiento.fechaSalidaBalanza!) === reportDate)) row.despacho += 1;
      });
    }));
  }
  return [...data.values()].sort((a, b) => a.hora.localeCompare(b.hora));
}

function minutosEntre(now: Date, fecha: string) {
  return Math.max(0, Math.floor((now.getTime() - new Date(fecha).getTime()) / 60_000));
}

function esCritico(estado: EstadoSeguimiento) {
  return ['CITA_VENCIDA', 'GARITA_SIN_INGRESO', 'BALANZA_SIN_SALIDA', 'PESO_OBSERVADO'].includes(estado);
}

function esProximo(estado: EstadoSeguimiento) {
  return ['CITA_POR_VENCER', 'EN_GARITA', 'EN_BALANZA'].includes(estado);
}

function pesoAereoAsociado(group: GrupoFlujo) {
  // PostgreSQL entrega NUMERIC como texto en algunas respuestas JSON. Se
  // normaliza aquí para que una suma de pesos nunca termine como "NaN".
  return (group.aereosAsociados ?? []).reduce((total, aereo) => total + pesoNumerico(aereo.pesoDeclarado), 0);
}

/** El peso recibido en Falcon es la referencia operativa de la carga marítima. */
function pesoRecibidoFalcon(group: GrupoFlujo) {
  return group.citas
    .map((cita) => pesoNumericoOpcional(cita.pesoDeclarado))
    .find((peso): peso is number => peso != null) ?? null;
}

function pesoNetoMovimiento(movimiento: MovimientoFisico) {
  const netoDirecto = pesoNumericoOpcional(movimiento.pesoNetoBalanza);
  const inicial = pesoNumericoOpcional(movimiento.pesoInicial);
  const final = pesoNumericoOpcional(movimiento.pesoFinal);
  return netoDirecto ?? (inicial != null && final != null ? Math.abs(final - inicial) : null);
}

/** En retiro múltiple se suman los netos de todas las unidades, pero el peso declarado del volante se toma una sola vez. */
function porcentajeDiferenciaPesoGrupo(group: GrupoFlujo) {
  const movimientos = movimientosConfirmados(group);
  if (!movimientos.length || movimientos.some((movimiento) => !tieneSegundoPesajeValido(movimiento))) return null;
  const netos = movimientos.map(pesoNetoMovimiento);
  if (netos.some((neto) => neto == null)) return null;
  const neto = netos.reduce<number>((total, item) => total + (item ?? 0), 0);
  const recibidoMaritimo = pesoRecibidoFalcon(group);
  const declarado = recibidoMaritimo == null ? null : recibidoMaritimo + pesoAereoAsociado(group);
  if (neto == null || declarado == null || declarado <= 0) return null;
  return Math.abs(neto - declarado) / declarado;
}

function pesoNumericoOpcional(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function pesoNumerico(value: unknown) {
  return pesoNumericoOpcional(value) ?? 0;
}

/** Un segundo pesaje debe tener peso final positivo y ocurrir después del primer pesaje. */
function tieneSegundoPesajeValido(movimiento: MovimientoFisico) {
  if (!movimiento.fechaGarita || !movimiento.fechaSalidaBalanza || movimiento.pesoFinal == null || movimiento.pesoFinal <= 0) return false;
  return new Date(movimiento.fechaSalidaBalanza).getTime() > new Date(movimiento.fechaGarita).getTime();
}

/**
 * Mientras una unidad sigue dentro del almacén, el reloj operativo continúa
 * desde el primer pesaje. Esto permite alertar una salida pendiente aunque
 * todavía no exista segundo pesaje en GITS.
 */
function duracionAtencionVisible(movimiento: MovimientoFisico) {
  if (!movimiento.fechaGarita) return null;
  if (tieneSegundoPesajeValido(movimiento)) {
    return durationSeconds(movimiento.fechaGarita, movimiento.fechaSalidaBalanza);
  }
  const hoy = fechaLima(new Date().toISOString());
  if (fechaLima(movimiento.fechaGarita) !== hoy) return null;
  return durationSeconds(movimiento.fechaGarita, new Date().toISOString());
}

/**
 * Falcon aporta el registro en garita. GITS aporta el primer y segundo pesaje:
 * espera = garita a primer pesaje; atención = primer a segundo pesaje.
 * Solo se mezclan ambos orígenes cuando el vínculo volante-cita es único.
 */
function crearSeguimientoLlegadas(grupos: GrupoFlujo[], reportDate: string | null, now: Date, modalidadesEnIncidencia: Set<Modalidad>): SeguimientoLlegada[] {
  const hoy = fechaLima(now.toISOString());
  if (!reportDate || reportDate !== hoy) return [];

  return grupos.flatMap((grupo) => grupo.citas
    .filter((cita) => cita.modalidad !== 'AEREO' && cita.fechaCita && fechaLima(cita.fechaCita) === reportDate)
    .map((cita) => {
      const movimientos = movimientosConfirmados(grupo);
      const movimientoPrincipal = movimientos[0];
      const hayMovimientoHoy = grupo.movimientos.some((movimiento) => movimiento.fechaGarita && fechaLima(movimiento.fechaGarita) === reportDate);
      const primerPesaje = movimientoPrincipal?.fechaGarita && fechaLima(movimientoPrincipal.fechaGarita) === reportDate ? movimientoPrincipal.fechaGarita : null;
      const todosConSalida = movimientos.length > 0 && movimientos.every((movimiento) => tieneSegundoPesajeValido(movimiento) && fechaLima(movimiento.fechaSalidaBalanza!) === reportDate);
      const segundoPesaje = todosConSalida ? movimientos.at(-1)?.fechaSalidaBalanza ?? null : null;
      let estado: EstadoSeguimiento;
      let fechaReferencia = cita.fechaCita!;
      let minutosRetraso = 0;
      let porcentajePeso: number | null | undefined;

      if (!movimientos.length && hayMovimientoHoy) {
        estado = 'VINCULO_PENDIENTE';
      } else if (!cita.fechaGarita) {
        const inicioPorVencer = new Date(new Date(cita.fechaCita!).getTime() + minutosCitaPorVencer * 60_000).toISOString();
        const vencimiento = new Date(new Date(cita.fechaCita!).getTime() + minutosToleranciaCita * 60_000).toISOString();
        if (now.getTime() > new Date(vencimiento).getTime()) {
          estado = 'CITA_VENCIDA';
          fechaReferencia = vencimiento;
          minutosRetraso = minutosEntre(now, vencimiento);
        } else if (now.getTime() >= new Date(inicioPorVencer).getTime()) {
          estado = 'CITA_POR_VENCER';
          fechaReferencia = inicioPorVencer;
          minutosRetraso = minutosEntre(now, inicioPorVencer);
        } else estado = 'PROGRAMADA';
      } else if (!primerPesaje) {
        fechaReferencia = cita.fechaGarita;
        minutosRetraso = minutosEntre(now, fechaReferencia);
        const limiteNaranja = citaVencida(cita) ? minutosNaranjaEsperaVencida : minutosNaranjaEsperaVigente;
        const limiteRojo = citaVencida(cita) ? minutosRojoEsperaVencida : minutosRojoEsperaVigente;
        estado = minutosRetraso > limiteRojo ? 'GARITA_SIN_INGRESO'
          : minutosRetraso > limiteNaranja ? 'EN_GARITA' : 'PROGRAMADA';
      } else if (primerPesaje && !segundoPesaje) {
        fechaReferencia = primerPesaje;
        minutosRetraso = minutosEntre(now, primerPesaje);
        estado = minutosRetraso > minutosRojoAtencion ? 'BALANZA_SIN_SALIDA'
          : minutosRetraso > minutosNaranjaAtencion ? 'EN_BALANZA' : 'EN_ATENCION';
      /** El control peso neto vs. mercancía declarada aplica a carga suelta (LCL), no a contenedores FCL. */
      } else if (cita.modalidad === 'LCL' && movimientos.length > 0 && segundoPesaje && (porcentajePeso = porcentajeDiferenciaPesoGrupo(grupo)) != null && porcentajePeso > toleranciaPeso) {
        fechaReferencia = segundoPesaje;
        minutosRetraso = minutosEntre(now, segundoPesaje);
        estado = 'PESO_OBSERVADO';
      } else estado = 'PROGRAMADA';

      if (modalidadesEnIncidencia.has(cita.modalidad) && esProximo(estado)) estado = 'INCIDENCIA_OPERATIVA';
      return {
        id: cita.id, volante: cita.volante, modalidad: cita.modalidad, fechaCita: cita.fechaCita!,
        placa: movimientoPrincipal?.placa ?? grupo.movimientos.find((movimiento) => movimiento.fechaGarita)?.placa ?? cita.unidad ?? null,
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
  if (item.estado === 'CITA_VENCIDA') return `Cita vencida: sin registro en garita Falcon · ${item.minutosRetraso} min`;
  if (item.estado === 'CITA_POR_VENCER') return 'Cita por vencer: sin registro en garita Falcon';
  if (item.estado === 'GARITA_SIN_INGRESO') return `Demora para ingreso al DT · ${item.minutosRetraso} min`;
  if (item.estado === 'BALANZA_SIN_SALIDA') return `Primer pesaje GITS sin salida por balanza · ${item.minutosRetraso} min`;
  if (item.estado === 'EN_ATENCION') return 'En almacén / atención en curso';
  if (item.estado === 'PESO_OBSERVADO') return `Diferencia de peso ${((item.porcentajePeso ?? 0) * 100).toFixed(1)}% · supera 5%`;
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
  return new Intl.DateTimeFormat('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Lima' })
    .format(new Date(`${value}T12:00:00-05:00`));
}

function formatDateShort(value: string) {
  return new Intl.DateTimeFormat('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Lima' }).format(new Date(value));
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('es-PE', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'America/Lima' }).format(new Date(value));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('es-PE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'America/Lima'
  }).format(new Date(value));
}

function formatWeight(value: number | null) {
  const peso = pesoNumericoOpcional(value);
  return peso === null ? '—' : new Intl.NumberFormat('es-PE', { maximumFractionDigits: 2 }).format(peso);
}

function formatLastUpdate(operacion: Operacion) {
  const values = [operacion.fechaCompletado, operacion.fechaIngresoDespacho, operacion.fechaGarita, operacion.fechaCita].filter((value): value is string => Boolean(value));
  return values.length > 0 ? formatDateTime(values[0]) : 'Sin registro';
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
