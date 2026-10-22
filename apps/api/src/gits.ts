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

export interface GitsTechnicalCatalog {
  tables: Array<{ schema: string; table: string; columns: string[] }>;
  indexes: Array<{ schema: string; table: string; index: string; primary: boolean; columns: string[] }>;
  relationships: Array<{ source: string; sourceColumn: string; target: string; targetColumn: string }>;
}

export interface GitsVolanteTrace {
  volante: string;
  tickets: Record<string, unknown>[];
  documents: Record<string, unknown>[];
  documentDetails: Record<string, unknown>[];
}

const flowTables = [
  'AUDTV_AGENCIA_MOVIMIENTO_TICKET',
  'AUDTV_MOVIMIENTO_BALANZA',
  'ADUTV_WS_REGISTRO_SALIDA_ALMACEN',
  'AUDTV_DOCUMENTO_ORIGEN',
  'AUDTV_DOCUMENTO_ORIGEN_DETALLE'
] as const;

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

/**
 * Expone únicamente la estructura técnica de las tablas que podrían enlazar
 * la cita de Falcon con el movimiento físico de GITS.
 */
export async function catalogoTecnicoFlujoGits(): Promise<GitsTechnicalCatalog> {
  if (!enabled()) throw new Error('GITS está desactivado.');
  if (!configured()) throw new Error('Faltan datos de conexión de GITS.');

  const pool = await new sql.ConnectionPool(connection()).connect();
  try {
    const quotedTables = flowTables.map((table) => `'${table}'`).join(', ');
    const [columnsResult, indexesResult, relationshipsResult] = await Promise.all([
      pool.request().query<{ schema_name: string; table_name: string; column_name: string }>(`
        SELECT TABLE_SCHEMA AS schema_name, TABLE_NAME AS table_name, COLUMN_NAME AS column_name
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME IN (${quotedTables})
        ORDER BY TABLE_NAME, ORDINAL_POSITION;
      `),
      pool.request().query<{ schema_name: string; table_name: string; index_name: string; is_primary_key: boolean; column_name: string }>(`
        SELECT
          SCHEMA_NAME(objectSchema.schema_id) AS schema_name,
          objectSchema.name AS table_name,
          indexes.name AS index_name,
          indexes.is_primary_key,
          columns.name AS column_name
        FROM sys.indexes indexes
        INNER JOIN sys.index_columns indexColumns
          ON indexColumns.object_id = indexes.object_id AND indexColumns.index_id = indexes.index_id
        INNER JOIN sys.columns columns
          ON columns.object_id = indexColumns.object_id AND columns.column_id = indexColumns.column_id
        INNER JOIN sys.objects objectSchema ON objectSchema.object_id = indexes.object_id
        WHERE SCHEMA_NAME(objectSchema.schema_id) = 'dbo'
          AND objectSchema.name IN (${quotedTables})
          AND indexes.index_id > 0
        ORDER BY objectSchema.name, indexes.name, indexColumns.key_ordinal;
      `),
      pool.request().query<{ source_table: string; source_column: string; target_table: string; target_column: string }>(`
        SELECT
          OBJECT_SCHEMA_NAME(foreignKeys.parent_object_id) + '.' + OBJECT_NAME(foreignKeys.parent_object_id) AS source_table,
          parentColumns.name AS source_column,
          OBJECT_SCHEMA_NAME(foreignKeys.referenced_object_id) + '.' + OBJECT_NAME(foreignKeys.referenced_object_id) AS target_table,
          referencedColumns.name AS target_column
        FROM sys.foreign_key_columns foreignKeyColumns
        INNER JOIN sys.foreign_keys foreignKeys ON foreignKeys.object_id = foreignKeyColumns.constraint_object_id
        INNER JOIN sys.columns parentColumns
          ON parentColumns.object_id = foreignKeyColumns.parent_object_id AND parentColumns.column_id = foreignKeyColumns.parent_column_id
        INNER JOIN sys.columns referencedColumns
          ON referencedColumns.object_id = foreignKeyColumns.referenced_object_id AND referencedColumns.column_id = foreignKeyColumns.referenced_column_id
        WHERE OBJECT_NAME(foreignKeys.parent_object_id) IN (${quotedTables})
           OR OBJECT_NAME(foreignKeys.referenced_object_id) IN (${quotedTables})
        ORDER BY source_table, source_column;
      `)
    ]);

    const tableMap = new Map<string, { schema: string; table: string; columns: string[] }>();
    for (const row of columnsResult.recordset) {
      const key = `${row.schema_name}.${row.table_name}`;
      const table = tableMap.get(key) ?? { schema: row.schema_name, table: row.table_name, columns: [] };
      table.columns.push(row.column_name);
      tableMap.set(key, table);
    }

    const indexMap = new Map<string, { schema: string; table: string; index: string; primary: boolean; columns: string[] }>();
    for (const row of indexesResult.recordset) {
      const key = `${row.schema_name}.${row.table_name}.${row.index_name}`;
      const index = indexMap.get(key) ?? { schema: row.schema_name, table: row.table_name, index: row.index_name, primary: row.is_primary_key, columns: [] };
      index.columns.push(row.column_name);
      indexMap.set(key, index);
    }

    return {
      tables: [...tableMap.values()],
      indexes: [...indexMap.values()],
      relationships: relationshipsResult.recordset.map((row) => ({
        source: row.source_table,
        sourceColumn: row.source_column,
        target: row.target_table,
        targetColumn: row.target_column
      }))
    };
  } finally {
    await pool.close();
  }
}

/**
 * Traza el volante de una sola operación hasta sus documentos y contenedores.
 * Es una consulta puntual de validación; no consulta la tabla masiva de balanza.
 */
export async function trazarVolanteGits(volante: string): Promise<GitsVolanteTrace> {
  if (!enabled()) throw new Error('GITS está desactivado.');
  if (!configured()) throw new Error('Faltan datos de conexión de GITS.');

  const pool = await new sql.ConnectionPool(connection()).connect();
  try {
    const input = (request: sql.Request) => request.input('volante', sql.VarChar(30), volante);
    const [tickets, documents, documentDetails] = await Promise.all([
      input(pool.request()).query(`
        SELECT TOP (10)
          AGMOTI_C_NROVOLANTE AS volante,
          AGMOTI_D_FECHA_HORA_EMISION AS fecha_emision,
          AGMOTI_D_FECHA_HORA_LLAMADA AS fecha_llamada,
          AGMOTI_D_FECHA_HORA_ATENCION AS fecha_atencion,
          AGMOTI_D_FECHA_HORA_FINALIZACION AS fecha_finalizacion,
          CAMION_C_PLACA AS placa,
          AGMOTI_C_ESTADO_FINALIZADO_CON_ATENCION AS finalizado_con_atencion,
          AGMOTI_C_ESTADO_FINALIZADO_SIN_ATENCION AS finalizado_sin_atencion
        FROM dbo.AUDTV_AGENCIA_MOVIMIENTO_TICKET
        WHERE AGMOTI_C_NROVOLANTE = @volante
           OR AGMOTI_C_NROVOLANTE = RIGHT(REPLICATE('0', 15) + @volante, 15);
      `),
      input(pool.request()).query(`
        SELECT TOP (10)
          DOCORI_C_NUMERO AS documento,
          DOCORI_C_NUMERO_VOLANTE AS volante,
          DOCORI_D_FECHA_VOLANTE AS fecha_volante,
          DOCORI_D_FECHA AS fecha_documento,
          DOCORI_C_ESTADO AS estado
        FROM dbo.AUDTV_DOCUMENTO_ORIGEN
        WHERE DOCORI_C_NUMERO_VOLANTE = @volante
           OR DOCORI_C_NUMERO_VOLANTE = RIGHT(REPLICATE('0', 15) + @volante, 15);
      `),
      input(pool.request()).query(`
        SELECT TOP (30)
          origen.DOCORI_C_NUMERO AS documento,
          origen.DOCORI_C_NUMERO_VOLANTE AS volante,
          detalle.DOORDE_C_NUMERO_DETALLE AS detalle,
          detalle.CONTEN_C_CODIGO AS contenedor,
          detalle.DOORDE_D_FECHA_INGRESO AS fecha_ingreso,
          detalle.DOORDE_C_ULTIMA_TARJA_CARGA_SUELTA AS ultima_tarja_carga_suelta,
          detalle.DOORDE_N_CANTIDAD_DESPACHADO AS cantidad_despachada,
          detalle.DOORDE_N_PESO_DESPACHADO AS peso_despachado
        FROM dbo.AUDTV_DOCUMENTO_ORIGEN origen
        INNER JOIN dbo.AUDTV_DOCUMENTO_ORIGEN_DETALLE detalle
          ON detalle.EMPRES_C_CODIGO = origen.EMPRES_C_CODIGO
          AND detalle.NAVE_C_CODIGO = origen.NAVE_C_CODIGO
          AND detalle.NAVIRU_C_VIAJE = origen.NAVIRU_C_VIAJE
          AND detalle.RUMBO_C_CODIGO = origen.RUMBO_C_CODIGO
          AND detalle.OPERAC_C_CODIGO = origen.OPERAC_C_CODIGO
          AND detalle.PUERTO_C_CODIGO_ORIGEN = origen.PUERTO_C_CODIGO_ORIGEN
          AND detalle.PUERTO_C_CODIGO_EMBARQUE = origen.PUERTO_C_CODIGO_EMBARQUE
          AND detalle.DOCORI_C_NUMERO = origen.DOCORI_C_NUMERO
        WHERE origen.DOCORI_C_NUMERO_VOLANTE = @volante
           OR origen.DOCORI_C_NUMERO_VOLANTE = RIGHT(REPLICATE('0', 15) + @volante, 15);
      `)
    ]);
    return { volante, tickets: tickets.recordset, documents: documents.recordset, documentDetails: documentDetails.recordset };
  } finally {
    await pool.close();
  }
}
