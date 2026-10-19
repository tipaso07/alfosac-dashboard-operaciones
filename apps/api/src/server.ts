import cors from 'cors';
import express from 'express';
import { crearResumen } from './dashboard.js';
import { operacionesDemo } from './demo-source.js';
import { diagnosticarFalcon } from './falcon.js';

const app = express();
const port = Number(process.env.PORT ?? 5100);

app.use(cors());
app.use(express.json());

app.get('/api/health', (_request, response) => {
  response.json({ status: 'ok', mode: 'demo', timestamp: new Date().toISOString() });
});

app.get('/api/integrations/falcon', async (_request, response) => {
  response.json(await diagnosticarFalcon());
});

app.get('/api/dashboard/summary', (_request, response) => {
  response.json({
    mode: 'demo',
    updatedAt: new Date().toISOString(),
    sources: {
      falcon: process.env.FALCON_SYNC_ENABLED === 'true' ? 'PENDIENTE_DE_CONEXION' : 'DESACTIVADA',
      gits: process.env.GITS_SYNC_ENABLED === 'true' ? 'PENDIENTE_DE_CONEXION' : 'DESACTIVADA'
    },
    summary: crearResumen(operacionesDemo)
  });
});

app.get('/api/dashboard/operations', (_request, response) => {
  response.json({ mode: 'demo', operations: operacionesDemo });
});

app.listen(port, () => {
  console.log(`Dashboard API disponible en el puerto ${port}`);
});

