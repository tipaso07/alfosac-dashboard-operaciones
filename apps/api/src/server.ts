import cors from 'cors';
import express from 'express';
import { crearResumen } from './dashboard.js';
import { operacionesDemo } from './demo-source.js';
import { buscarEventosOperativosFalcon, consultarCitasPorHora, contarCitasPorHora, detalleCitaFalcon, diagnosticarFalcon, listarCitasConControlSalida, listarCitasConEventosLogisticos, vistaPreviaFalcon } from './falcon.js';
import { leerOperacionesAereas, leerOperacionesMaritimas } from './falcon.js';
import { catalogoTecnicoFlujoGits, diagnosticarGits, listarCandidatosOperativosGits, listarObjetosFlujoGits, obtenerMuestrasFlujoGits, trazarVolanteGits } from './gits.js';
import { fechaReporteActual, guardarOperaciones, listarOperaciones, listarPendientesLlegada } from './report-store.js';

const app = express();
const port = Number(process.env.PORT ?? 5100);

function fechaReporteConfigurada() {
  return fechaReporteActual();
}

let lastFalconSyncAt: string | null = null;
let lastFalconSyncError: string | null = null;
let syncRunning = false;

async function importarFalcon() {
  const [maritimas, aereas] = await Promise.all([leerOperacionesMaritimas(), leerOperacionesAereas()]);
  const toOperation = (item: Awaited<ReturnType<typeof leerOperacionesMaritimas>>[number]) => ({
    id: item.id, modalidad: item.modalidad, estado: item.fechaIngresoDespacho ? 'EN_DESPACHO' as const : item.fechaGarita ? 'EN_GARITA' as const : 'AGENDADA' as const,
    volante: item.volante, unidad: item.unidad, fechaCita: item.fechaCita, fechaGarita: item.fechaGarita,
    fechaIngresoDespacho: item.fechaIngresoDespacho, fechaCompletado: null, fuente: 'FALCON' as const
  });
  await guardarOperaciones([...maritimas.map(toOperation), ...aereas.map(toOperation)]);
  return { maritime: maritimas.length, aereo: aereas.length };
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
      message: 'Primera etapa de la traza: tickets por volante. Consulta de solo lectura y sin uniones costosas.',
      trace: await trazarVolanteGits(volante)
    });
  } catch (error) {
    response.status(503).json({ message: error instanceof Error ? error.message : 'No se pudo trazar el volante en GITS.' });
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
  listarOperaciones().then((stored) => response.json({
    mode: stored.length > 0 ? 'reportes' : 'demo',
    updatedAt: new Date().toISOString(),
    reportDate: fechaReporteConfigurada(),
    sources: {
      falcon: process.env.FALCON_SYNC_ENABLED === 'true' ? 'PENDIENTE_DE_CONEXION' : 'DESACTIVADA',
      gits: process.env.GITS_SYNC_ENABLED === 'true' ? 'PENDIENTE_DE_CONEXION' : 'DESACTIVADA'
    },
    summary: crearResumen(stored.length > 0 ? stored : operacionesDemo, fechaReporteActual())
  })).catch(() => response.json({ mode: 'demo', updatedAt: new Date().toISOString(), reportDate: fechaReporteConfigurada(), sources: {}, summary: crearResumen(operacionesDemo, fechaReporteActual()) }));
});

app.get('/api/dashboard/operations', (_request, response) => {
  listarOperaciones().then((stored) => response.json({ mode: stored.length > 0 ? 'reportes' : 'demo', reportDate: fechaReporteConfigurada(), operations: stored.length > 0 ? stored : operacionesDemo }))
    .catch(() => response.json({ mode: 'demo', reportDate: fechaReporteConfigurada(), operations: operacionesDemo }));
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

