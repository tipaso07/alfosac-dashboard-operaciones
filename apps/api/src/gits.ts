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
  events: Array<{
    empresa: string;
    movimiento: string | null;
    placa: string | null;
    contenedor: string | null;
    fechaGarita: string | null;
    fechaSalidaBalanza: string | null;
    fechaIngresoAlmacen: string | null;
    fechaSalidaAlmacen: string | null;
    fechaAtencionTicket: string | null;
    fechaFinalizacionTicket: string | null;
    pesoInicial: number | null;
    pesoFinal: number | null;
    pesoNetoBalanza: number | null;
    pesoMercaderiaDeclarado: number | null;
  }>;
}

export interface GitsFlowObject {
  schema: string;
  name: string;
  type: string;
}

export interface GitsDailyFlowItem {
  empresa: string;
  movimiento: string;
  volante: string | null;
  placa: string | null;
  contenedor: string | null;
  fechaGarita: string | null;
  fechaSalidaBalanza: string | null;
  fechaIngresoAlmacen: string | null;
  fechaSalidaAlmacen: string | null;
  /** Primer/segundo pesaje y diferencia registrados por balanza. */
  pesoInicial: number | null;
  pesoFinal: number | null;
  pesoNetoBalanza: number | null;
  /** Peso manifestado de la mercadería vinculada; se muestra solo como referencia. */
  pesoMercaderiaDeclarado: number | null;
}

export interface GitsCorrelationInput {
  volante: string | null;
  placa: string | null;
  contenedor: string | null;
}

export interface GitsCorrelation {
  event: GitsDailyFlowItem;
  matchedBy: 'CONTENEDOR' | 'PLACA';
}

const flowTables = [
  'AUDTV_AGENCIA_MOVIMIENTO_TICKET',
  'AUDTV_MOVIMIENTO_BALANZA',
  'ADUTV_WS_REGISTRO_SALIDA_ALMACEN',
  'AUDTV_DOCUMENTO_ORIGEN',
  'AUDTV_DOCUMENTO_ORIGEN_DETALLE'
] as const;

const flowBridgeTables = [
  'CCTV_AGENCIA_MOVIMIENTO_TICKET_VOLANTE',
  'CCTV_AGENCIA_MOVIMIENTO_TICKET_RETIRO',
  'OPETV_MOVIMIENTO_BALANZA_AUTORIZACION_RETIRO',
  'OPETV_MOVIMIENTO_BALANZA_DOCUMENTO',
  'OPETV_MOVIMIENTO_BALANZA_ALMACEN',
  'OPETV_MOVIMIENTO_BALANZA',
  'OPETV_DOCUMENTO_ORIGEN',
  'OPETV_DOCUMENTO_ORIGEN_DETALLE'
] as const;

function enabled() { return process.env.GITS_SYNC_ENABLED === 'true'; }

function configured() {
  return Boolean(process.env.GITS_DB_HOST && process.env.GITS_DB_NAME && process.env.GITS_DB_USER && process.env.GITS_DB_PASSWORD);
}

function empresaGits() {
  return process.env.GITS_EMPRESA_CODE?.trim() || '00001';
}

function normalizar(value: string | null | undefined, eliminarCeros = false) {
  const normalized = value?.trim().toUpperCase().replace(/\s+/g, '') || '';
  if (!normalized) return null;
  return eliminarCeros ? normalized.replace(/^0+(?=\d)/, '') : normalized;
}

function numero(value: unknown) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * SQL Server devuelve datetime sin zona. Se preserva como hora Perú para que
 * Postgres y el navegador no lo desplacen al día anterior al serializar JSON.
 */
export function fechaGitsPeru(value: Date | null) {
  if (!value) return null;
  const part = (number: number) => String(number).padStart(2, '0');
  return `${value.getUTCFullYear()}-${part(value.getUTCMonth() + 1)}-${part(value.getUTCDate())}T${part(value.getUTCHours())}:${part(value.getUTCMinutes())}:${part(value.getUTCSeconds())}-05:00`;
}

/**
 * Correlación deliberadamente conservadora. El volante no identifica por sí
 * solo una cita: puede reutilizarse en diferentes días o movimientos. Con
 * contenedor exacto se elige el primer ingreso; sin contenedor, la placa debe
 * ser el único candidato físico de ese volante en el día.
 */
export function correlacionSeguraGits(cita: GitsCorrelationInput, events: GitsDailyFlowItem[]): GitsCorrelation | null {
  const volante = normalizar(cita.volante, true);
  if (!volante) return null;
  const related = events.filter((event) => normalizar(event.volante, true) === volante);
  const ordenarPorGarita = (left: GitsDailyFlowItem, right: GitsDailyFlowItem) =>
    (left.fechaGarita ?? '').localeCompare(right.fechaGarita ?? '');

  const contenedor = normalizar(cita.contenedor);
  if (contenedor) {
    const matches = related.filter((event) => normalizar(event.contenedor) === contenedor).sort(ordenarPorGarita);
    return matches[0] ? { event: matches[0], matchedBy: 'CONTENEDOR' } : null;
  }

  const placa = normalizar(cita.placa);
  if (!placa) return null;
  const matches = related.filter((event) => normalizar(event.placa) === placa);
  return matches.length === 1 ? { event: matches[0], matchedBy: 'PLACA' } : null;
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
 * Traza física de un volante utilizando exclusivamente las tablas base y sus
 * llaves indexadas. Un volante puede tener varios movimientos de balanza;
 * se devuelven como historial y nunca se cuentan como operaciones distintas.
 */
export async function trazarVolanteGits(volante: string): Promise<GitsVolanteTrace> {
  if (!enabled()) throw new Error('GITS está desactivado.');
  if (!configured()) throw new Error('Faltan datos de conexión de GITS.');

  const pool = await new sql.ConnectionPool(connection()).connect();
  try {
    const result = await pool.request()
      .input('empresa', sql.VarChar(10), empresaGits())
      .input('volante', sql.VarChar(30), volante)
      .query<{
        empresa: string;
        movimiento: string | null;
        placa: string | null;
        contenedor: string | null;
        fecha_garita: Date | null;
        fecha_salida_balanza: Date | null;
        fecha_ingreso_almacen: Date | null;
        fecha_salida_almacen: Date | null;
        fecha_atencion_ticket: Date | null;
        fecha_finalizacion_ticket: Date | null;
        peso_inicial: number | null;
        peso_final: number | null;
        peso_neto_balanza: number | null;
        peso_mercaderia_declarado: number | null;
      }>(`
      SELECT TOP (100)
        origen.EMPRES_C_CODIGO AS empresa,
        balanza.MOVBAL_C_NUMERO AS movimiento,
        balanza.CAMION_C_PLACA AS placa,
        COALESCE(detalle.CONTEN_C_CODIGO, balanza.CONTEN_C_CODIGO) AS contenedor,
        balanza.MOVBAL_D_FECHA_INGRESO AS fecha_garita,
        balanza.MOVBAL_D_FECHA_SALIDA AS fecha_salida_balanza,
        balanza.MOVBAL_N_PRIMER_PESO AS peso_inicial,
        balanza.MOVBAL_N_SEGUNDO_PESO AS peso_final,
        balanza.MOVBAL_N_DIFERENCIA AS peso_neto_balanza,
        detalle.DOORDE_N_PESO_MANIFESTADO AS peso_mercaderia_declarado,
        almacen.fecha_ingreso_almacen,
        salida.fecha_salida_almacen
        , ticket.fecha_atencion_ticket
        , ticket.fecha_finalizacion_ticket
      FROM dbo.OPETV_DOCUMENTO_ORIGEN origen
      INNER JOIN dbo.OPETV_DOCUMENTO_ORIGEN_DETALLE detalle
        ON detalle.EMPRES_C_CODIGO = origen.EMPRES_C_CODIGO
        AND detalle.NAVE_C_CODIGO = origen.NAVE_C_CODIGO
        AND detalle.NAVIRU_C_VIAJE = origen.NAVIRU_C_VIAJE
        AND detalle.RUMBO_C_CODIGO = origen.RUMBO_C_CODIGO
        AND detalle.OPERAC_C_CODIGO = origen.OPERAC_C_CODIGO
        AND detalle.PUERTO_C_CODIGO_ORIGEN = origen.PUERTO_C_CODIGO_ORIGEN
        AND detalle.PUERTO_C_CODIGO_EMBARQUE = origen.PUERTO_C_CODIGO_EMBARQUE
        AND detalle.DOCORI_C_NUMERO = origen.DOCORI_C_NUMERO
      LEFT JOIN dbo.OPETV_MOVIMIENTO_BALANZA_DOCUMENTO enlace
        ON enlace.EMPRES_C_CODIGO = detalle.EMPRES_C_CODIGO
        AND enlace.NAVE_C_CODIGO = detalle.NAVE_C_CODIGO
        AND enlace.NAVIRU_C_VIAJE = detalle.NAVIRU_C_VIAJE
        AND enlace.RUMBO_C_CODIGO = detalle.RUMBO_C_CODIGO
        AND enlace.OPERAC_C_CODIGO = detalle.OPERAC_C_CODIGO
        AND enlace.PUERTO_C_CODIGO_ORIGEN = detalle.PUERTO_C_CODIGO_ORIGEN
        AND enlace.PUERTO_C_CODIGO_EMBARQUE = detalle.PUERTO_C_CODIGO_EMBARQUE
        AND enlace.DOCORI_C_NUMERO = detalle.DOCORI_C_NUMERO
        AND enlace.DOORDE_C_NUMERO_DETALLE = detalle.DOORDE_C_NUMERO_DETALLE
      LEFT JOIN dbo.OPETV_MOVIMIENTO_BALANZA balanza
        ON balanza.EMPRES_C_CODIGO = detalle.EMPRES_C_CODIGO
        AND balanza.MOVBAL_C_NUMERO = enlace.MOVBAL_C_NUMERO
      OUTER APPLY (
        SELECT TOP (1) movimientoAlmacen.MOBAAL_D_FECHA AS fecha_ingreso_almacen
        FROM dbo.OPETV_MOVIMIENTO_BALANZA_ALMACEN movimientoAlmacen
        WHERE movimientoAlmacen.EMPRES_C_CODIGO = detalle.EMPRES_C_CODIGO
          AND movimientoAlmacen.MOVBAL_C_NUMERO = enlace.MOVBAL_C_NUMERO
        ORDER BY movimientoAlmacen.MOBAAL_D_FECHA ASC
      ) almacen
      OUTER APPLY (
        SELECT TOP (1) registroSalida.WSRESAL_D_FECHA_SALIDA_ALMACEN AS fecha_salida_almacen
        FROM dbo.ADUTV_WS_REGISTRO_SALIDA_ALMACEN registroSalida
        WHERE registroSalida.EMPRES_C_CODIGO = detalle.EMPRES_C_CODIGO
          AND registroSalida.MOVBAL_C_NUMERO = enlace.MOVBAL_C_NUMERO
        ORDER BY registroSalida.WSRESAL_D_FECHA_SALIDA_ALMACEN ASC
      ) salida
      OUTER APPLY (
        SELECT TOP (1)
          atencion.AGMOTI_D_FECHA_HORA_ATENCION AS fecha_atencion_ticket,
          atencion.AGMOTI_D_FECHA_HORA_FINALIZACION AS fecha_finalizacion_ticket
        FROM dbo.OPETV_MOVIMIENTO_BALANZA_AUTORIZACION_RETIRO autorizacion
        INNER JOIN dbo.CCTV_AGENCIA_MOVIMIENTO_TICKET_RETIRO ticketRetiro
          ON ticketRetiro.EMPRES_C_CODIGO = autorizacion.EMPRES_C_CODIGO
          AND ticketRetiro.AUTRET_C_NUMERO = autorizacion.AUTRET_C_NUMERO
        INNER JOIN dbo.AUDTV_AGENCIA_MOVIMIENTO_TICKET atencion
          ON atencion.EMPRES_C_CODIGO = ticketRetiro.EMPRES_C_CODIGO
          AND atencion.AGMOTI_C_CORRELATIVO = ticketRetiro.AGMOTI_C_CORRELATIVO
        WHERE autorizacion.EMPRES_C_CODIGO = detalle.EMPRES_C_CODIGO
          AND autorizacion.MOVBAL_C_NUMERO = enlace.MOVBAL_C_NUMERO
        ORDER BY COALESCE(atencion.AGMOTI_D_FECHA_HORA_FINALIZACION, atencion.AGMOTI_D_FECHA_HORA_ATENCION, atencion.AGMOTI_D_FECHA_HORA_EMISION) DESC
      ) ticket
      WHERE origen.EMPRES_C_CODIGO = @empresa
        AND origen.DOCORI_C_NUMERO_VOLANTE = RIGHT(REPLICATE('0', 15) + @volante, 15)
      ORDER BY balanza.MOVBAL_D_FECHA_INGRESO ASC;
    `);
    return {
      volante,
      events: result.recordset.map((row) => ({
        empresa: row.empresa,
        movimiento: row.movimiento?.trim() || null,
        placa: row.placa?.trim() || null,
        contenedor: row.contenedor?.trim() || null,
        fechaGarita: fechaGitsPeru(row.fecha_garita),
        fechaSalidaBalanza: fechaGitsPeru(row.fecha_salida_balanza),
        fechaIngresoAlmacen: fechaGitsPeru(row.fecha_ingreso_almacen),
        fechaSalidaAlmacen: fechaGitsPeru(row.fecha_salida_almacen),
        fechaAtencionTicket: fechaGitsPeru(row.fecha_atencion_ticket),
        fechaFinalizacionTicket: fechaGitsPeru(row.fecha_finalizacion_ticket),
        pesoInicial: numero(row.peso_inicial),
        pesoFinal: numero(row.peso_final),
        pesoNetoBalanza: numero(row.peso_neto_balanza),
        pesoMercaderiaDeclarado: numero(row.peso_mercaderia_declarado)
      }))
    };
  } finally {
    await pool.close();
  }
}

/** Lista las vistas y tablas reales candidatas sin leer registros de operación. */
export async function listarObjetosFlujoGits(): Promise<GitsFlowObject[]> {
  if (!enabled()) throw new Error('GITS está desactivado.');
  if (!configured()) throw new Error('Faltan datos de conexión de GITS.');

  const pool = await new sql.ConnectionPool(connection()).connect();
  try {
    const result = await pool.request().query<{ schema_name: string; object_name: string; type_desc: string }>(`
      SELECT SCHEMA_NAME(objects.schema_id) AS schema_name, objects.name AS object_name, objects.type_desc
      FROM sys.objects objects
      WHERE objects.is_ms_shipped = 0
        AND objects.type = 'U'
        AND (
          objects.name LIKE '%AGENCIA_MOVIMIENTO_TICKET%'
          OR objects.name LIKE '%MOVIMIENTO_BALANZA%'
          OR objects.name LIKE '%REGISTRO_SALIDA_ALMACEN%'
          OR objects.name LIKE '%DOCUMENTO_ORIGEN%'
        )
      ORDER BY objects.name, objects.type_desc;
    `);
    return result.recordset.map((row) => ({ schema: row.schema_name, name: row.object_name, type: row.type_desc }));
  } finally {
    await pool.close();
  }
}

/**
 * Estructura de las tablas puente que enlazan volante, autorización, balanza y documento.
 * Solo lee catálogo de SQL Server; nunca registros operativos.
 */
export async function catalogoEnlacesGits(): Promise<GitsTechnicalCatalog> {
  if (!enabled()) throw new Error('GITS está desactivado.');
  if (!configured()) throw new Error('Faltan datos de conexión de GITS.');

  const pool = await new sql.ConnectionPool(connection()).connect();
  try {
    const quotedTables = flowBridgeTables.map((table) => `'${table}'`).join(', ');
    const [columnsResult, indexesResult, relationshipsResult] = await Promise.all([
      pool.request().query<{ schema_name: string; table_name: string; column_name: string }>(`
        SELECT TABLE_SCHEMA AS schema_name, TABLE_NAME AS table_name, COLUMN_NAME AS column_name
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME IN (${quotedTables})
        ORDER BY TABLE_NAME, ORDINAL_POSITION;
      `),
      pool.request().query<{ schema_name: string; table_name: string; index_name: string; is_primary_key: boolean; column_name: string }>(`
        SELECT
          SCHEMA_NAME(objects.schema_id) AS schema_name,
          objects.name AS table_name,
          indexes.name AS index_name,
          indexes.is_primary_key,
          columns.name AS column_name
        FROM sys.indexes indexes
        INNER JOIN sys.index_columns indexColumns
          ON indexColumns.object_id = indexes.object_id AND indexColumns.index_id = indexes.index_id
        INNER JOIN sys.columns columns
          ON columns.object_id = indexColumns.object_id AND columns.column_id = indexColumns.column_id
        INNER JOIN sys.objects objects ON objects.object_id = indexes.object_id
        WHERE SCHEMA_NAME(objects.schema_id) = 'dbo'
          AND objects.name IN (${quotedTables})
          AND indexes.index_id > 0
        ORDER BY objects.name, indexes.name, indexColumns.key_ordinal;
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
      relationships: relationshipsResult.recordset.map((row) => ({ source: row.source_table, sourceColumn: row.source_column, target: row.target_table, targetColumn: row.target_column }))
    };
  } finally {
    await pool.close();
  }
}

/**
 * Consulta diaria y acotada del flujo marítimo desde las tablas base indexadas.
 * No sincroniza ni escribe datos; se usa únicamente para validar la semántica de eventos.
 */
export async function consultarFlujoDiarioGits(date: string, limit = 50): Promise<GitsDailyFlowItem[]> {
  if (!enabled()) throw new Error('GITS está desactivado.');
  if (!configured()) throw new Error('Faltan datos de conexión de GITS.');

  const pool = await new sql.ConnectionPool(connection()).connect();
  try {
    const result = await pool.request()
      .input('fromDate', sql.Date, date)
      .input('limit', sql.Int, limit)
      .query<{
        empresa: string;
        movimiento: string;
        volante: string | null;
        placa: string | null;
        contenedor: string | null;
        fecha_garita: Date | null;
        fecha_salida_balanza: Date | null;
        fecha_ingreso_almacen: Date | null;
        fecha_salida_almacen: Date | null;
        peso_inicial: number | null;
        peso_final: number | null;
        peso_neto_balanza: number | null;
        peso_mercaderia_declarado: number | null;
      }>(`
        SELECT TOP (@limit)
          balanza.EMPRES_C_CODIGO AS empresa,
          balanza.MOVBAL_C_NUMERO AS movimiento,
          documento.volante,
          balanza.CAMION_C_PLACA AS placa,
          balanza.CONTEN_C_CODIGO AS contenedor,
          balanza.MOVBAL_D_FECHA_INGRESO AS fecha_garita,
          balanza.MOVBAL_D_FECHA_SALIDA AS fecha_salida_balanza,
          balanza.MOVBAL_N_PRIMER_PESO AS peso_inicial,
          balanza.MOVBAL_N_SEGUNDO_PESO AS peso_final,
          balanza.MOVBAL_N_DIFERENCIA AS peso_neto_balanza,
          documento.peso_mercaderia_declarado,
          almacen.fecha_ingreso_almacen,
          salida.fecha_salida_almacen
        FROM dbo.OPETV_MOVIMIENTO_BALANZA balanza
        OUTER APPLY (
          SELECT TOP (1)
            origen.DOCORI_C_NUMERO_VOLANTE AS volante,
            detalle.DOORDE_N_PESO_MANIFESTADO AS peso_mercaderia_declarado
          FROM dbo.OPETV_MOVIMIENTO_BALANZA_DOCUMENTO enlace
          INNER JOIN dbo.OPETV_DOCUMENTO_ORIGEN origen
            ON origen.EMPRES_C_CODIGO = enlace.EMPRES_C_CODIGO
            AND origen.NAVE_C_CODIGO = enlace.NAVE_C_CODIGO
            AND origen.NAVIRU_C_VIAJE = enlace.NAVIRU_C_VIAJE
            AND origen.RUMBO_C_CODIGO = enlace.RUMBO_C_CODIGO
            AND origen.OPERAC_C_CODIGO = enlace.OPERAC_C_CODIGO
            AND origen.PUERTO_C_CODIGO_ORIGEN = enlace.PUERTO_C_CODIGO_ORIGEN
            AND origen.PUERTO_C_CODIGO_EMBARQUE = enlace.PUERTO_C_CODIGO_EMBARQUE
            AND origen.DOCORI_C_NUMERO = enlace.DOCORI_C_NUMERO
          LEFT JOIN dbo.OPETV_DOCUMENTO_ORIGEN_DETALLE detalle
            ON detalle.EMPRES_C_CODIGO = enlace.EMPRES_C_CODIGO
            AND detalle.NAVE_C_CODIGO = enlace.NAVE_C_CODIGO
            AND detalle.NAVIRU_C_VIAJE = enlace.NAVIRU_C_VIAJE
            AND detalle.RUMBO_C_CODIGO = enlace.RUMBO_C_CODIGO
            AND detalle.OPERAC_C_CODIGO = enlace.OPERAC_C_CODIGO
            AND detalle.PUERTO_C_CODIGO_ORIGEN = enlace.PUERTO_C_CODIGO_ORIGEN
            AND detalle.PUERTO_C_CODIGO_EMBARQUE = enlace.PUERTO_C_CODIGO_EMBARQUE
            AND detalle.DOCORI_C_NUMERO = enlace.DOCORI_C_NUMERO
            AND detalle.DOORDE_C_NUMERO_DETALLE = enlace.DOORDE_C_NUMERO_DETALLE
          WHERE enlace.EMPRES_C_CODIGO = balanza.EMPRES_C_CODIGO
            AND enlace.MOVBAL_C_NUMERO = balanza.MOVBAL_C_NUMERO
        ) documento
        OUTER APPLY (
          SELECT TOP (1) movimientoAlmacen.MOBAAL_D_FECHA AS fecha_ingreso_almacen
          FROM dbo.OPETV_MOVIMIENTO_BALANZA_ALMACEN movimientoAlmacen
          WHERE movimientoAlmacen.EMPRES_C_CODIGO = balanza.EMPRES_C_CODIGO
            AND movimientoAlmacen.MOVBAL_C_NUMERO = balanza.MOVBAL_C_NUMERO
          ORDER BY movimientoAlmacen.MOBAAL_D_FECHA ASC
        ) almacen
        OUTER APPLY (
          SELECT TOP (1) registroSalida.WSRESAL_D_FECHA_SALIDA_ALMACEN AS fecha_salida_almacen
          FROM dbo.ADUTV_WS_REGISTRO_SALIDA_ALMACEN registroSalida
          WHERE registroSalida.EMPRES_C_CODIGO = balanza.EMPRES_C_CODIGO
            AND registroSalida.MOVBAL_C_NUMERO = balanza.MOVBAL_C_NUMERO
          ORDER BY registroSalida.WSRESAL_D_FECHA_SALIDA_ALMACEN ASC
        ) salida
        WHERE balanza.MOVBAL_D_FECHA_INGRESO >= @fromDate
          AND balanza.MOVBAL_D_FECHA_INGRESO < DATEADD(day, 1, @fromDate)
        ORDER BY balanza.MOVBAL_D_FECHA_INGRESO ASC;
      `);

    return result.recordset.map((row) => ({
      empresa: row.empresa,
      movimiento: row.movimiento,
      volante: row.volante,
      placa: row.placa?.trim() || null,
      contenedor: row.contenedor?.trim() || null,
      fechaGarita: fechaGitsPeru(row.fecha_garita),
      fechaSalidaBalanza: fechaGitsPeru(row.fecha_salida_balanza),
      fechaIngresoAlmacen: fechaGitsPeru(row.fecha_ingreso_almacen),
      fechaSalidaAlmacen: fechaGitsPeru(row.fecha_salida_almacen),
      pesoInicial: numero(row.peso_inicial),
      pesoFinal: numero(row.peso_final),
      pesoNetoBalanza: numero(row.peso_neto_balanza),
      pesoMercaderiaDeclarado: numero(row.peso_mercaderia_declarado)
    }));
  } finally {
    await pool.close();
  }
}
