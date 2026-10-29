import cors from 'cors';
import express from 'express';
import { crearResumen } from './dashboard.js';
import { crearFlujoOperativo, resumenDeFlujo } from './operational-flow.js';
import { movimientosDemo, operacionesDemo } from './demo-source.js';
import { crearReporteOperativo, reporteACsv, type ModalidadReporte, type PeriodoReporte } from './reports.js';
import { buscarEventosOperativosFalcon, consultarCitasPorHora, contarCitasPorHora, detalleCitaFalcon, diagnosticarFalcon, listarCitasConControlSalida, listarCitasConEventosLogisticos, vistaPreviaFalcon } from './falcon.js';
import { leerOperacionesAereas, leerOperacionesMaritimas } from './falcon.js';
import { buscarReferenciasGaritaGits, catalogoEnlacesGits, catalogoGaritaGits, catalogoTecnicoFlujoGits, consultarFlujoDiarioGits, correlacionSeguraGits, diagnosticarGits, listarCandidatosOperativosGits, listarObjetosFlujoGits, obtenerMuestrasFlujoGits, trazarAtencionTicketGits, trazarGaritaGits, trazarVolanteGits } from './gits.js';
import { fechaReporteActual, guardarOperaciones, listarOperaciones, listarOperacionesParaReporte, listarPendientesLlegada } from './report-store.js';

const app = express();
const port = Number(process.env.PORT ?? 5100);

/** Modo local y reversible para presentaciones sin usar fuentes externas. */
function modoDemostracion() {
  return process.env.DASHBOARD_DEMO_MODE === 'true';
}

function fechaReporteConfigurada() {
  return fechaReporteActual();
}

type ModalidadIncidente = 'FCL' | 'LCL' | 'BB' | 'AEREO';

/**
 * Permite declarar una incidencia conocida sin convertir cada cita afectada
 * en una alerta individual. Solo se aplica a la fecha indicada explícitamente.
 */
function incidenciasOperativas() {
  if (process.env.DASHBOARD_INCIDENT_DATE !== fechaReporteActual()) return [];
  const modalidades = (process.env.DASHBOARD_INCIDENT_MODALITIES ?? '')
    .split(',')
    .map((item) => item.trim().toUpperCase())
    .filter((item): item is ModalidadIncidente => ['FCL', 'LCL', 'BB', 'AEREO'].includes(item));
  if (!modalidades.length) return [];
  return [{
    modalidades,
    message: process.env.DASHBOARD_INCIDENT_MESSAGE?.trim() || 'Incidencia operativa en seguimiento manual.'
  }];
}

let lastFalconSyncAt: string | null = null;
let lastFalconSyncError: string | null = null;
let syncRunning = false;
let flowCache: { date: string; expiresAt: number; groups: ReturnType<typeof crearFlujoOperativo>; summary: ReturnType<typeof resumenDeFlujo> } | null = null;

async function cargarFlujoDashboard() {
  const date = fechaReporteActual();
  if (modoDemostracion()) {
    const groups = crearFlujoOperativo(operacionesDemo, movimientosDemo);
    return { date, expiresAt: Date.now() + 25_000, groups, summary: resumenDeFlujo(operacionesDemo, groups, date) };
  }
  if (flowCache && flowCache.date === date && flowCache.expiresAt > Date.now()) return flowCache;
  const citas = await listarOperaciones();
  let movements: Awaited<ReturnType<typeof consultarFlujoDiarioGits>> = [];
  if (process.env.GITS_SYNC_ENABLED === 'true') {
    try { movements = await consultarFlujoDiarioGits(date, 1_000); } catch { /* Conserva Falcon si GITS se encuentra temporalmente no disponible. */ }
  }
  flowCache = { date, expiresAt: Date.now() + 25_000, groups: crearFlujoOperativo(citas, movements), summary: resumenDeFlujo(citas, crearFlujoOperativo(citas, movements), date) };
  return flowCache;
}

async function enriquecerMaritimasConGits(maritimas: Awaited<ReturnType<typeof leerOperacionesMaritimas>>) {
  if (process.env.GITS_ENRICH_FALCON_ENABLED !== 'true') return maritimas;
  const events = await consultarFlujoDiarioGits(fechaReporteActual(), 1_000);
  return maritimas.map((cita) => {
    const correlation = correlacionSeguraGits({
      volante: cita.volante,
      placa: cita.unidad,
      contenedor: cita.contenedor
    }, events);
    if (!correlation) return cita;
    return {
      ...cita,
      unidad: correlation.event.placa ?? cita.unidad,
      fechaGarita: correlation.event.fechaGarita ?? cita.fechaGarita
    };
  });
}

async function importarFalcon() {
  const [maritimasSource, aereas] = await Promise.all([leerOperacionesMaritimas(), leerOperacionesAereas()]);
  const maritimas = await enriquecerMaritimasConGits(maritimasSource);
  const toOperation = (item: Awaited<ReturnType<typeof leerOperacionesMaritimas>>[number]) => ({
    id: item.id, modalidad: item.modalidad, estado: item.fechaIngresoDespacho ? 'EN_DESPACHO' as const : item.fechaGarita ? 'EN_GARITA' as const : 'AGENDADA' as const,
    volante: item.volante, unidad: item.unidad, fechaCita: item.fechaCita, fechaGarita: item.fechaGarita,
    fechaIngresoDespacho: item.fechaIngresoDespacho, fechaCompletado: null, fuente: 'FALCON' as const
  });
  await guardarOperaciones([...maritimas.map(toOperation), ...aereas.map(toOperation)]);
  return { maritime: maritimas.length, aereo: aereas.length, gitsEnrichment: process.env.GITS_ENRICH_FALCON_ENABLED === 'true' };
}

async function syncFalconIfEnabled() {
  if (process.env.FALCON_AUTO_SYNC_ENABLED !== 'true' || syncRunning) return;
  syncRunning = true;
  try {
    await importarFalcon();
    lastFalconSyncAt = new Date().toISOString();
    lastFalconSyncError = null;
  } catch (error) {
    lastFalconSyncError = error instanceof Error ? error.message : 'No se pudo sincronizar Falcon.';
  } finally {
    syncRunning = false;
  }
}

app.use(cors());
app.use(express.json());

app.get('/api/health', async (_request, response) => {
  response.json({
    status: 'ok', timestamp: new Date().toISOString(), reportDate: fechaReporteActual(),
    falcon: { autoSync: process.env.FALCON_AUTO_SYNC_ENABLED === 'true', lastSyncAt: lastFalconSyncAt, lastError: lastFalconSyncError },
    gits: await diagnosticarGits()
  });
});

app.get('/api/integrations/falcon', async (_request, response) => {
  response.json({ ...(await diagnosticarFalcon()), autoSync: process.env.FALCON_AUTO_SYNC_ENABLED === 'true', lastSyncAt: lastFalconSyncAt, lastError: lastFalconSyncError });
});

app.get('/api/integrations/gits', async (_request, response) => {
  response.json(await diagnosticarGits());
});

app.get('/api/integrations/gits/schema-candidates', async (_request, response) => {
  try {
    response.json({
      message: 'Catálogo limitado de tablas y campos candidatos para citas, garita y despacho. Consulta de metadatos: no lee operaciones ni modifica GITS.',
      candidates: await listarCandidatosOperativosGits()
    });
  } catch (error) {
    response.status(503).json({ message: error instanceof Error ? error.message : 'No se pudo inspeccionar el catálogo de GITS.' });
  }
});

app.get('/api/integrations/gits/gate-catalog', async (_request, response) => {
  try {
    response.json({
      message: 'Catálogo técnico de vigilancia, tarja y balanza para identificar el registro previo de garita. Consulta de metadatos; no lee operaciones ni modifica GITS.',
      catalog: await catalogoGaritaGits()
    });
  } catch (error) {
    response.status(503).json({ message: error instanceof Error ? error.message : 'No se pudo consultar el catálogo de garita en GITS.' });
  }
});

app.get('/api/integrations/gits/gate-search', async (_request, response) => {
  try {
    response.json({
      message: 'Búsqueda amplia de metadatos para localizar una posible fuente de garita o atención. No consulta operaciones ni modifica GITS.',
      search: await buscarReferenciasGaritaGits()
    });
  } catch (error) {
    response.status(503).json({ message: error instanceof Error ? error.message : 'No se pudo buscar referencias de garita en GITS.' });
  }
});

app.get('/api/integrations/gits/ticket-attention-trace', async (request, response) => {
  const volante = String(request.query.volante ?? '').trim();
  if (!/^\d{1,30}$/.test(volante)) {
    response.status(400).json({ message: 'Indica un volante numérico: ?volante=147797.' });
    return;
  }
  try {
    response.json({
      message: 'Marcas del módulo de tickets/atención por volante para validar una posible hora de garita. Consulta de solo lectura.',
      trace: await trazarAtencionTicketGits(volante)
    });
  } catch (error) {
    response.status(503).json({ message: error instanceof Error ? error.message : 'No se pudo trazar la atención del ticket en GITS.' });
  }
});

app.get('/api/integrations/gits/gate-trace', async (request, response) => {
  const movimiento = String(request.query.movimiento ?? '').trim();
  if (!/^\d{1,30}$/.test(movimiento)) {
    response.status(400).json({ message: 'Indica el número de movimiento GITS: ?movimiento=000000000341741.' });
    return;
  }
  try {
    response.json({
      message: 'Marcas de vigilancia y tarja asociadas a un movimiento de balanza. Consulta de solo lectura para validar el registro de garita.',
      trace: await trazarGaritaGits(movimiento)
    });
  } catch (error) {
    response.status(503).json({ message: error instanceof Error ? error.message : 'No se pudo trazar vigilancia y tarja en GITS.' });
  }
});

app.get('/api/integrations/gits/flow-samples', async (_request, response) => {
  try {
    response.json({
      message: 'Muestra técnica de hasta 12 filas por origen para validar llaves entre volante, movimiento de balanza y salida. Consulta de solo lectura.',
      samples: await obtenerMuestrasFlujoGits()
    });
  } catch (error) {
    response.status(503).json({ message: error instanceof Error ? error.message : 'No se pudieron consultar las muestras de GITS.' });
  }
});

app.get('/api/integrations/gits/flow-catalog', async (_request, response) => {
  try {
    response.json({
      message: 'Estructura técnica de las tablas candidatas: columnas, índices y relaciones declaradas. Consulta de metadatos; no lee ni modifica operaciones.',
      catalog: await catalogoTecnicoFlujoGits()
    });
  } catch (error) {
    response.status(503).json({ message: error instanceof Error ? error.message : 'No se pudo consultar el catálogo técnico de GITS.' });
  }
});

app.get('/api/integrations/gits/trace', async (request, response) => {
  const volante = String(request.query.volante ?? '').trim();
  if (!/^\d{1,30}$/.test(volante)) {
    response.status(400).json({ message: 'Indica un volante numérico: ?volante=123456.' });
    return;
  }
  try {
    response.json({
      message: 'Historial físico por volante: balanza, ingreso a almacén y salida. Consulta de solo lectura; un volante puede tener varios movimientos.',
      trace: await trazarVolanteGits(volante)
    });
  } catch (error) {
    response.status(503).json({ message: error instanceof Error ? error.message : 'No se pudo trazar el volante en GITS.' });
  }
});

/**
 * Expediente acotado para validar un caso que Operaciones ya conoce.
 * No acepta SQL ni realiza escrituras: reúne la cita Falcon con las marcas
 * físicas GITS y las trazas de vigilancia/tarja de sus movimientos.
 */
app.get('/api/investigations/case', async (request, response) => {
  const citaId = String(request.query.citaId ?? '').trim();
  const volante = String(request.query.volante ?? '').trim();
  if (!/^\d{1,30}$/.test(citaId) || !/^\d{1,30}$/.test(volante)) {
    response.status(400).json({ message: 'Indica citaId y volante numéricos, por ejemplo ?citaId=331984&volante=162866.' });
    return;
  }
  try {
    const [falcon, fisico, tickets] = await Promise.all([
      detalleCitaFalcon(citaId),
      trazarVolanteGits(volante),
      trazarAtencionTicketGits(volante)
    ]);
    const movimientos = fisico.events
      .map((item) => item.movimiento)
      .filter((item): item is string => Boolean(item))
      .slice(0, 8);
    const garita = await Promise.all(movimientos.map((movimiento) => trazarGaritaGits(movimiento)));
    response.json({
      message: 'Expediente de validación de solo lectura. No clasifica los eventos: la confirmación corresponde a Operaciones.',
      citaId,
      volante,
      falcon,
      gits: { fisico, tickets, garita }
    });
  } catch (error) {
    response.status(503).json({ message: error instanceof Error ? error.message : 'No se pudo reunir el expediente de investigación.' });
  }
});

app.get('/api/integrations/gits/flow-objects', async (_request, response) => {
  try {
    response.json({
      message: 'Vistas y tablas candidatas del flujo GITS. Consulta de metadatos; no lee ni modifica operaciones.',
      objects: await listarObjetosFlujoGits()
    });
  } catch (error) {
    response.status(503).json({ message: error instanceof Error ? error.message : 'No se pudieron consultar los objetos de GITS.' });
  }
});

app.get('/api/integrations/gits/bridge-catalog', async (_request, response) => {
  try {
    response.json({
      message: 'Catálogo de las tablas puente entre volante, autorización de retiro, balanza y documento. Consulta de metadatos; no lee ni modifica operaciones.',
      catalog: await catalogoEnlacesGits()
    });
  } catch (error) {
    response.status(503).json({ message: error instanceof Error ? error.message : 'No se pudo consultar el catálogo de enlaces de GITS.' });
  }
});

app.get('/api/integrations/gits/daily-flow', async (request, response) => {
  const date = String(request.query.date ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    response.status(400).json({ message: 'Indica la fecha con ?date=AAAA-MM-DD.' });
    return;
  }
  try {
    const items = await consultarFlujoDiarioGits(date);
    response.json({
      date,
      count: items.length,
      message: 'Muestra diaria desde balanza y sus enlaces a documento, almacén y salida. Consulta de solo lectura; no sincroniza datos.',
      items
    });
  } catch (error) {
    response.status(503).json({ message: error instanceof Error ? error.message : 'No se pudo consultar el flujo diario de GITS.' });
  }
});

app.get('/api/integrations/falcon/preview', async (request, response) => {
  const requestedLimit = Number(request.query.limit ?? 15);
  const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(Math.floor(requestedLimit), 1), 30) : 15;
  response.json(await vistaPreviaFalcon(limit));
});

app.get('/api/integrations/falcon/counts', async (request, response) => {
  const date = String(request.query.date ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    response.status(400).json({ message: 'Indica la fecha con ?date=AAAA-MM-DD.' });
    return;
  }
  try { response.json({ date, items: await contarCitasPorHora(date) }); }
  catch (error) { response.status(503).json({ message: error instanceof Error ? error.message : 'No se pudo consultar Falcon.' }); }
});

app.get('/api/integrations/falcon/event-candidates', async (_request, response) => {
  try {
    response.json({
      message: 'Catálogo de tablas y campos candidatos. Consulta de solo lectura; no incluye registros.',
      candidates: await buscarEventosOperativosFalcon()
    });
  } catch (error) {
    response.status(503).json({ message: error instanceof Error ? error.message : 'No se pudo inspeccionar Falcon.' });
  }
});

app.get('/api/integrations/falcon/with-exit-control', async (request, response) => {
  const requestedLimit = Number(request.query.limit ?? 10);
  const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 20) : 10;
  try {
    response.json({
      message: 'Citas vinculadas a control de salida. Consulta de solo lectura para análisis.',
      items: await listarCitasConControlSalida(limit)
    });
  } catch (error) {
    response.status(503).json({ message: error instanceof Error ? error.message : 'No se pudo consultar Falcon.' });
  }
});

app.get('/api/integrations/falcon/with-logistic-events', async (request, response) => {
  const requestedLimit = Number(request.query.limit ?? 5);
  const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 10) : 5;
  try {
    response.json({
      message: 'Muestra limitada de citas históricas con tarja o salida. Consulta de solo lectura para validar el flujo.',
      items: await listarCitasConEventosLogisticos(limit)
    });
  } catch (error) {
    response.status(503).json({ message: error instanceof Error ? error.message : 'No se pudo consultar Falcon.' });
  }
});

app.get('/api/integrations/falcon/citas', async (request, response) => {
  const date = String(request.query.date ?? '');
  const modalidad = String(request.query.modalidad ?? '').toUpperCase();
  const hour = Number(request.query.hour ?? Number.NaN);
  const modalidades = ['FCL', 'LCL', 'BB'] as const;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    response.status(400).json({ message: 'Indica la fecha con ?date=AAAA-MM-DD.' });
    return;
  }
  if (!modalidades.includes(modalidad as typeof modalidades[number])) {
    response.status(400).json({ message: 'Indica ?modalidad=FCL, LCL o BB.' });
    return;
  }
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    response.status(400).json({ message: 'Indica ?hour=0 hasta 23.' });
    return;
  }

  try {
    const items = await consultarCitasPorHora(date, modalidad as typeof modalidades[number], hour);
    response.json({ date, modalidad, hour: String(hour).padStart(2, '0'), count: items.length, items });
  } catch (error) {
    response.status(503).json({ message: error instanceof Error ? error.message : 'No se pudo consultar Falcon.' });
  }
});

app.get('/api/integrations/falcon/citas/:citaId', async (request, response) => {
  response.json(await detalleCitaFalcon(request.params.citaId));
});

app.get('/api/dashboard/summary', (_request, response) => {
  cargarFlujoDashboard().then((flow) => response.json({
    mode: modoDemostracion() ? 'demo' : 'reportes',
    updatedAt: new Date().toISOString(),
    reportDate: fechaReporteConfigurada(),
    sources: modoDemostracion() ? { demo: 'ACTIVA' } : {
      falcon: process.env.FALCON_SYNC_ENABLED === 'true' ? 'PENDIENTE_DE_CONEXION' : 'DESACTIVADA',
      gits: process.env.GITS_SYNC_ENABLED === 'true' ? 'PENDIENTE_DE_CONEXION' : 'DESACTIVADA'
    },
    summary: flow.summary
  })).catch(() => response.json({ mode: 'demo', updatedAt: new Date().toISOString(), reportDate: fechaReporteConfigurada(), sources: {}, summary: crearResumen(operacionesDemo, fechaReporteActual()) }));
});

app.get('/api/dashboard/flow', (_request, response) => {
  cargarFlujoDashboard().then((flow) => response.json({ reportDate: flow.date, groups: flow.groups, incidents: incidenciasOperativas() }))
    .catch((error) => response.status(503).json({ message: error instanceof Error ? error.message : 'No se pudo cargar el flujo operativo.' }));
});

app.get('/api/dashboard/operations', (_request, response) => {
  if (modoDemostracion()) {
    response.json({ mode: 'demo', reportDate: fechaReporteConfigurada(), operations: operacionesDemo });
    return;
  }
  listarOperaciones().then((stored) => response.json({ mode: stored.length > 0 ? 'reportes' : 'demo', reportDate: fechaReporteConfigurada(), operations: stored.length > 0 ? stored : operacionesDemo }))
    .catch(() => response.json({ mode: 'demo', reportDate: fechaReporteConfigurada(), operations: operacionesDemo }));
});

app.get('/api/reports/operations', async (request, response) => {
  const periodo = String(request.query.periodo ?? 'DIARIO').toUpperCase() as PeriodoReporte;
  const fecha = String(request.query.fecha ?? fechaReporteActual());
  const modalidad = String(request.query.modalidad ?? 'TODAS').toUpperCase() as ModalidadReporte;
  if (!['DIARIO', 'MENSUAL'].includes(periodo)) {
    response.status(400).json({ message: 'Indica periodo=DIARIO o periodo=MENSUAL.' });
    return;
  }
  if (!(periodo === 'DIARIO' ? /^\d{4}-\d{2}-\d{2}$/ : /^\d{4}-\d{2}(-\d{2})?$/.test(fecha))) {
    response.status(400).json({ message: periodo === 'DIARIO' ? 'Indica fecha=AAAA-MM-DD.' : 'Indica fecha=AAAA-MM o AAAA-MM-DD.' });
    return;
  }
  if (!['TODAS', 'FCL', 'LCL'].includes(modalidad)) {
    response.status(400).json({ message: 'Indica modalidad=TODAS, FCL o LCL.' });
    return;
  }
  try {
    const operations = modoDemostracion() ? operacionesDemo : await listarOperacionesParaReporte(periodo, fecha);
    response.json(crearReporteOperativo(operations, periodo, fecha, modalidad));
  } catch (error) {
    response.status(503).json({ message: error instanceof Error ? error.message : 'No se pudo generar el reporte.' });
  }
});

app.get('/api/reports/operations.csv', async (request, response) => {
  const periodo = String(request.query.periodo ?? 'DIARIO').toUpperCase() as PeriodoReporte;
  const fecha = String(request.query.fecha ?? fechaReporteActual());
  const modalidad = String(request.query.modalidad ?? 'TODAS').toUpperCase() as ModalidadReporte;
  if (!['DIARIO', 'MENSUAL'].includes(periodo) || !['TODAS', 'FCL', 'LCL'].includes(modalidad)) {
    response.status(400).json({ message: 'Parámetros de reporte no válidos.' });
    return;
  }
  try {
    const operations = modoDemostracion() ? operacionesDemo : await listarOperacionesParaReporte(periodo, fecha);
    const report = crearReporteOperativo(operations, periodo, fecha, modalidad);
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader('Content-Disposition', `attachment; filename="reporte-${periodo.toLowerCase()}-${fecha}-${modalidad.toLowerCase()}.csv"`);
    response.send(`\uFEFF${reporteACsv(report)}`);
  } catch (error) {
    response.status(503).json({ message: error instanceof Error ? error.message : 'No se pudo descargar el reporte.' });
  }
});

app.get('/api/dashboard/pending-arrivals', (_request, response) => {
  listarPendientesLlegada().then((operations) => response.json({ operations }))
    .catch(() => response.json({ operations: [] }));
});

app.post('/api/integrations/falcon/import/maritime', async (_request, response) => {
  if (process.env.FALCON_IMPORT_ENABLED !== 'true') {
    response.status(409).json({ imported: false, message: 'La importación está desactivada. Define FALCON_IMPORT_ENABLED=true para habilitarla explícitamente.' });
    return;
  }
  try {
    const source = await leerOperacionesMaritimas();
    const operations = source.map((item) => ({
      id: item.id, modalidad: item.modalidad, estado: item.fechaGarita ? 'EN_GARITA' as const : 'AGENDADA' as const,
      volante: item.volante, unidad: item.unidad, fechaCita: item.fechaCita, fechaGarita: item.fechaGarita,
      fechaIngresoDespacho: item.fechaIngresoDespacho, fechaCompletado: null, fuente: 'FALCON' as const
    }));
    await guardarOperaciones(operations);
    response.json({ imported: true, count: operations.length, message: 'Importación marítima completada en la base propia del dashboard.' });
  } catch (error) {
    response.status(503).json({ imported: false, message: error instanceof Error ? error.message : 'No se pudo importar Falcon.' });
  }
});

app.post('/api/integrations/falcon/import', async (_request, response) => {
  if (process.env.FALCON_IMPORT_ENABLED !== 'true') {
    response.status(409).json({ imported: false, message: 'La importación está desactivada. Define FALCON_IMPORT_ENABLED=true para habilitarla explícitamente.' });
    return;
  }
  try {
    const result = await importarFalcon();
    lastFalconSyncAt = new Date().toISOString();
    lastFalconSyncError = null;
    response.json({ imported: true, ...result, message: 'Datos de Falcon actualizados en la base propia del dashboard.' });
  } catch (error) {
    response.status(503).json({ imported: false, message: error instanceof Error ? error.message : 'No se pudo importar Falcon.' });
  }
});

app.listen(port, () => {
  console.log(`Dashboard API disponible en el puerto ${port}`);
  const configuredInterval = Number(process.env.FALCON_SYNC_INTERVAL_SECONDS ?? 300);
  const intervalSeconds = Number.isFinite(configuredInterval) ? Math.max(60, Math.floor(configuredInterval)) : 300;
  void syncFalconIfEnabled();
  setInterval(() => void syncFalconIfEnabled(), intervalSeconds * 1_000);
});

