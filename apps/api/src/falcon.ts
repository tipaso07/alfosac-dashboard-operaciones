import sql from 'mssql';

export interface FalconDiagnostic {
  enabled: boolean;
  configured: boolean;
  connected: boolean;
  checkedAt: string;
  databases: Record<string, { configured: boolean; tables: Record<string, boolean> }>;
  message: string;
}

const requiredExtranetTables = ['citas_programadas', 'citas_programadas_aereo', 'transportistas_citas'];

function enabled() {
  return process.env.FALCON_SYNC_ENABLED === 'true';
}

function configured() {
  return Boolean(
    process.env.FALCON_DB_HOST
    && process.env.FALCON_EXTRANET_DB
    && process.env.FALCON_DB_USER
    && process.env.FALCON_DB_PASSWORD
  );
}

function connection(database: string): sql.config {
  return {
    server: process.env.FALCON_DB_HOST ?? '',
    port: Number(process.env.FALCON_DB_PORT ?? 1433),
    user: process.env.FALCON_DB_USER ?? '',
    password: process.env.FALCON_DB_PASSWORD ?? '',
    database,
    options: {
      encrypt: process.env.FALCON_DB_ENCRYPT === 'true',
      trustServerCertificate: process.env.FALCON_DB_TRUST_CERTIFICATE !== 'false',
      appName: 'AlfosacDashboardOperacionesReadOnly'
    },
    connectionTimeout: 5_000,
    requestTimeout: 8_000
  };
}

async function tableAvailability(database: string, tableNames: string[]) {
  const pool = await new sql.ConnectionPool(connection(database)).connect();
  try {
    const names = tableNames.map((_, index) => `@table${index}`).join(', ');
    const request = pool.request();
    tableNames.forEach((name, index) => request.input(`table${index}`, sql.NVarChar, name));
    const result = await request.query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_type = 'BASE TABLE' AND table_name IN (${names});
    `);
    const found = new Set(result.recordset.map((row) => row.table_name.toLowerCase()));
    return Object.fromEntries(tableNames.map((name) => [name, found.has(name.toLowerCase())]));
  } finally {
    await pool.close();
  }
}

export async function diagnosticarFalcon(): Promise<FalconDiagnostic> {
  const checkedAt = new Date().toISOString();
  const extranet = process.env.FALCON_EXTRANET_DB ?? '';
  const maestros = process.env.FALCON_MAESTROS_DB ?? '';
  const databases: FalconDiagnostic['databases'] = {
    extranet: { configured: Boolean(extranet), tables: {} },
    maestros: { configured: Boolean(maestros), tables: {} }
  };

  if (!enabled()) {
    return { enabled: false, configured: configured(), connected: false, checkedAt, databases, message: 'Falcon está desactivado.' };
  }
  if (!configured()) {
    return { enabled: true, configured: false, connected: false, checkedAt, databases, message: 'Faltan datos de conexión de Falcon.' };
  }

  try {
    databases.extranet.tables = await tableAvailability(extranet, requiredExtranetTables);
    return {
      enabled: true,
      configured: true,
      connected: true,
      checkedAt,
      databases,
      message: 'Conexión de solo lectura validada. Aún no se ejecuta la sincronización de operaciones.'
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error desconocido al conectar con Falcon.';
    return { enabled: true, configured: true, connected: false, checkedAt, databases, message: `No se pudo validar Falcon: ${message}` };
  }
}
