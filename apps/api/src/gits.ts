import sql from 'mssql';

/** Estado de la conexión de solo lectura a GITS. */
export interface GitsDiagnostic {
  enabled: boolean;
  configured: boolean;
  connected: boolean;
  database: string | null;
  message: string;
}

function enabled() { return process.env.GITS_SYNC_ENABLED === 'true'; }

function configured() {
  return Boolean(process.env.GITS_DB_HOST && process.env.GITS_DB_NAME && process.env.GITS_DB_USER && process.env.GITS_DB_PASSWORD);
}

function connection(): sql.config {
  const instance = process.env.GITS_DB_INSTANCE?.trim();
  const port = Number(process.env.GITS_DB_PORT ?? '');
  return {
    server: process.env.GITS_DB_HOST ?? '',
    ...(instance ? {} : Number.isFinite(port) && port > 0 ? { port } : {}),
    user: process.env.GITS_DB_USER ?? '',
    password: process.env.GITS_DB_PASSWORD ?? '',
    database: process.env.GITS_DB_NAME ?? '',
    options: {
      encrypt: process.env.GITS_DB_ENCRYPT === 'true',
      trustServerCertificate: process.env.GITS_DB_TRUST_CERTIFICATE !== 'false',
      ...(instance ? { instanceName: instance } : {}),
      appName: 'AlfosacDashboardOperacionesReadOnly'
    },
    connectionTimeout: 5_000,
    requestTimeout: 8_000
  };
}

/** Solo abre la conexión y consulta el nombre de base. No lee tablas ni escribe datos. */
export async function diagnosticarGits(): Promise<GitsDiagnostic> {
  if (!enabled()) return { enabled: false, configured: configured(), connected: false, database: null, message: 'GITS está desactivado hasta validar su acceso de solo lectura y mapeo.' };
  if (!configured()) return { enabled: true, configured: false, connected: false, database: null, message: 'Faltan datos de conexión de GITS.' };
  try {
    const pool = await new sql.ConnectionPool(connection()).connect();
    try {
      const result = await pool.request().query<{ database_name: string }>('SELECT DB_NAME() AS database_name;');
      const database = result.recordset[0]?.database_name ?? null;
      return { enabled: true, configured: true, connected: true, database, message: 'Conexión de solo lectura a GITS validada. Aún no se consultan ni sincronizan operaciones.' };
    } finally { await pool.close(); }
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Error desconocido al conectar con GITS.';
    return { enabled: true, configured: true, connected: false, database: null, message: `No se pudo validar GITS: ${detail}` };
  }
}
