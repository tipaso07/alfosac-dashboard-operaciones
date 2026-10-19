import cors from 'cors';
import express from 'express';
import { crearResumen } from './dashboard.js';
import { operacionesDemo } from './demo-source.js';
import { detalleCitaFalcon, diagnosticarFalcon, vistaPreviaFalcon } from './falcon.js';
import { leerOperacionesAereas, leerOperacionesMaritimas } from './falcon.js';
import { guardarOperaciones, listarOperaciones, listarPendientesLlegada } from './report-store.js';

const app = express();
const port = Number(process.env.PORT ?? 5100);

function fechaReporteConfigurada() {
  const value = process.env.DASHBOARD_REPORT_DATE?.trim();
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

app.use(cors());
app.use(express.json());

app.get('/api/health', (_request, response) => {
  response.json({ status: 'ok', mode: 'demo', timestamp: new Date().toISOString() });
});

app.get('/api/integrations/falcon', async (_request, response) => {
  response.json(await diagnosticarFalcon());
});

app.get('/api/integrations/falcon/preview', async (request, response) => {
  const requestedLimit = Number(request.query.limit ?? 15);
  const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(Math.floor(requestedLimit), 1), 30) : 15;
  response.json(await vistaPreviaFalcon(limit));
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
    summary: crearResumen(stored.length > 0 ? stored : operacionesDemo)
  })).catch(() => response.json({ mode: 'demo', updatedAt: new Date().toISOString(), reportDate: fechaReporteConfigurada(), sources: {}, summary: crearResumen(operacionesDemo) }));
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
    const [maritimas, aereas] = await Promise.all([leerOperacionesMaritimas(), leerOperacionesAereas()]);
    const toOperation = (item: Awaited<ReturnType<typeof leerOperacionesMaritimas>>[number]) => ({
      id: item.id, modalidad: item.modalidad, estado: item.fechaIngresoDespacho ? 'EN_DESPACHO' as const : item.fechaGarita ? 'EN_GARITA' as const : 'AGENDADA' as const,
      volante: item.volante, unidad: item.unidad, fechaCita: item.fechaCita, fechaGarita: item.fechaGarita,
      fechaIngresoDespacho: item.fechaIngresoDespacho, fechaCompletado: null, fuente: 'FALCON' as const
    });
    await guardarOperaciones([...maritimas.map(toOperation), ...aereas.map(toOperation)]);
    response.json({ imported: true, maritime: maritimas.length, aereo: aereas.length, message: 'Datos de Falcon actualizados en la base propia del dashboard.' });
  } catch (error) {
    response.status(503).json({ imported: false, message: error instanceof Error ? error.message : 'No se pudo importar Falcon.' });
  }
});

app.listen(port, () => {
  console.log(`Dashboard API disponible en el puerto ${port}`);
});

