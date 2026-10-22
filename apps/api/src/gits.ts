import sql from 'mssql';

/** Estado de la conexión de solo lectura a GITS. */
export interface GitsDiagnostic {
  enabled: boolean;
  configured: boolean;
  connected: boolean;
  database: string | null;
  accessibleDatabases: string[];
  message: string;
}

export interface GitsSchemaCandidate {
  schema: string;
  table: string;
  columns: string[];
}

export interface GitsFlowSamples {
  movementBalance: Record<string, unknown>[];
  agencyTickets: Record<string, unknown>[];
  warehouseExits: Record<string, unknown>[];
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

/**
 * Solo valida el acceso y enumera bases a las que el usuario ya tiene permiso.
 * No consulta tablas operativas ni escribe datos en GITS.
 */
export async function diagnosticarGits(): Promise<GitsDiagnostic> {
  if (!enabled()) return { enabled: false, configured: configured(), connected: false, database: null, accessibleDatabases: [], message: 'GITS está desactivado hasta validar su acceso de solo lectura y mapeo.' };
  if (!configured()) return { enabled: true, configured: false, connected: false, database: null, accessibleDatabases: [], message: 'Faltan datos de conexión de GITS.' };
  try {
    const pool = await new sql.ConnectionPool(connection()).connect();
    try {
      const result = await pool.request().query<{ database_name: string }>('SELECT DB_NAME() AS database_name;');
      const database = result.recordset[0]?.database_name ?? null;
      const databases = await pool.request().query<{ name: string }>(`
        SELECT name
        FROM sys.databases
        WHERE HAS_DBACCESS(name) = 1
        ORDER BY name;
      `);
      const accessibleDatabases = databases.recordset.map((row) => row.name);
      return {
        enabled: true,
        configured: true,
        connected: true,
        database,
        accessibleDatabases,
        message: 'Conexión de solo lectura a GITS validada. Aún no se consultan ni sincronizan operaciones.'
      };
    } finally { await pool.close(); }
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Error desconocido al conectar con GITS.';
    return { enabled: true, configured: true, connected: false, database: null, accessibleDatabases: [], message: `No se pudo validar GITS: ${detail}` };
  }
}

/**
 * Revisa solo metadatos para encontrar las tablas candidatas del flujo operativo.
 * No devuelve registros de operaciones ni realiza cambios en GITS.
 */
export async function listarCandidatosOperativosGits(): Promise<GitsSchemaCandidate[]> {
  if (!enabled()) throw new Error('GITS está desactivado.');
  if (!configured()) throw new Error('Faltan datos de conexión de GITS.');

  const pool = await new sql.ConnectionPool(connection()).connect();
  try {
    const result = await pool.request().query<{
      schema_name: string;
      table_name: string;
      column_name: string;
    }>(`
      SELECT TOP (200)
        TABLE_SCHEMA AS schema_name,
        TABLE_NAME AS table_name,
        COLUMN_NAME AS column_name
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA NOT IN ('sys', 'INFORMATION_SCHEMA')
        AND (
          UPPER(TABLE_NAME) LIKE '%CITA%'
          OR UPPER(TABLE_NAME) LIKE '%DESPACH%'
          OR UPPER(TABLE_NAME) LIKE '%INGRES%'
          OR UPPER(TABLE_NAME) LIKE '%SALIDA%'
          OR UPPER(TABLE_NAME) LIKE '%TARJA%'
          OR UPPER(TABLE_NAME) LIKE '%OPERAC%'
          OR UPPER(TABLE_NAME) LIKE '%CONTEN%'
          OR UPPER(COLUMN_NAME) LIKE '%CITA%'
          OR UPPER(COLUMN_NAME) LIKE '%DESPACH%'
          OR UPPER(COLUMN_NAME) LIKE '%INGRES%'
          OR UPPER(COLUMN_NAME) LIKE '%SALIDA%'
          OR UPPER(COLUMN_NAME) LIKE '%TARJA%'
          OR UPPER(COLUMN_NAME) LIKE '%CONTEN%'
          OR UPPER(COLUMN_NAME) LIKE '%PLACA%'
          OR UPPER(COLUMN_NAME) LIKE '%VOLANTE%'
        )
      ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION;
    `);

    const candidates = new Map<string, GitsSchemaCandidate>();
    for (const row of result.recordset) {
      const key = `${row.schema_name}.${row.table_name}`;
      const candidate = candidates.get(key) ?? { schema: row.schema_name, table: row.table_name, columns: [] };
      candidate.columns.push(row.column_name);
      candidates.set(key, candidate);
    }
    return [...candidates.values()];
  } finally {
    await pool.close();
  }
}

/**
 * Muestra técnica y acotada para validar cómo se enlazan volante, garita y salida.
 * Solo utiliza SELECT TOP: no modifica ni sincroniza información de GITS.
 */
export async function obtenerMuestrasFlujoGits(): Promise<GitsFlowSamples> {
  if (!enabled()) throw new Error('GITS está desactivado.');
  if (!configured()) throw new Error('Faltan datos de conexión de GITS.');

  const pool = await new sql.ConnectionPool(connection()).connect();
  try {
    const [movementBalance, agencyTickets, warehouseExits] = await Promise.all([
      pool.request().query(`
        SELECT TOP (12)
          MOVBAL_C_NUMERO AS movimiento,
          MOVBAL_D_FECHA_INGRESO AS fecha_ingreso,
          MOVBAL_D_FECHA_SALIDA AS fecha_salida,
          CAMION_C_PLACA AS placa,
          MOVBAL_C_CONTENEDOR AS contenedor_movimiento,
          CONTEN_C_CODIGO AS contenedor,
          MOVBAL_N_CANTIDAD_TARJA AS cantidad_tarja
        FROM dbo.AUDTV_MOVIMIENTO_BALANZA
        ;
      `),
      pool.request().query(`
        SELECT TOP (12)
          AGMOTI_C_NROVOLANTE AS volante,
          CAMION_C_PLACA AS placa,
          AGMOTI_D_FECHA_HORA_APROX_INGRESO AS fecha_aproximada_ingreso,
          AGMOTI_N_CONTENEDOR AS cantidad_contenedores
        FROM dbo.AUDTV_AGENCIA_MOVIMIENTO_TICKET
        ;
      `),
      pool.request().query(`
        SELECT TOP (12)
          WSRESAL_C_NUMERO AS registro_salida,
          MOVBAL_C_NUMERO AS movimiento,
          CAMION_C_PLACA AS placa,
          CONTEN_C_CODIGO AS contenedor,
          WSRESAL_D_FECHA_SALIDA_ALMACEN AS fecha_salida_almacen,
          WSRESAL_C_ESTADO AS estado
        FROM dbo.ADUTV_WS_REGISTRO_SALIDA_ALMACEN
        ;
      `)
    ]);

    return {
      movementBalance: movementBalance.recordset,
      agencyTickets: agencyTickets.recordset,
      warehouseExits: warehouseExits.recordset
    };
  } finally {
    await pool.close();
  }
}
