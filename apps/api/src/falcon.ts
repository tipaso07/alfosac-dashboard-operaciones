import sql from 'mssql';
import type { Modalidad } from './domain.js';

export interface FalconDiagnostic {
  enabled: boolean;
  configured: boolean;
  connected: boolean;
  checkedAt: string;
  databases: Record<string, { configured: boolean; tables: Record<string, boolean> }>;
  message: string;
}

const requiredExtranetTables = ['citas_programadas', 'citas_programadas_aereo', 'transportistas_citas'];

type SourceRow = Record<string, unknown>;

export interface FalconPreviewItem {
  origen: 'CITA_MARITIMA' | 'AR_AEREO' | 'GARITA';
  identificador: string;
  modalidad: Modalidad | 'OTRA';
  volante: string | null;
  unidad: string | null;
  fechaCita: string | null;
  fechaRegistro: string | null;
  fechaAtencion: string | null;
  negocio: string | null;
}

export interface FalconPreview {
  enabled: boolean;
  connected: boolean;
  generatedAt: string;
  items: FalconPreviewItem[];
  message: string;
}

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

const columnsForPreview = [
  'id', 'id_cita', 'cod_negocio', 'fecha', 'hora', 'fecha_cita', 'fecha_registro',
  'fecha_atencion', 'cnt', 'placa', 'unidad', 'volante', 'cpa_volante',
  'cpa_lista_retiro', 'cpa_flag_cita', 'flag_cita'
];

function quoteIdentifier(identifier: string) {
  return `[${identifier.replaceAll(']', ']]')}]`;
}

async function previewTable(pool: sql.ConnectionPool, tableName: string, limit: number) {
  const columnsResult = await pool.request().input('tableName', sql.NVarChar, tableName).query<{ column_name: string }>(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = @tableName AND table_schema = 'dbo';
  `);
  const available = new Set(columnsResult.recordset.map((item) => item.column_name.toLowerCase()));
  const selected = columnsForPreview.filter((column) => available.has(column.toLowerCase()));
  if (selected.length === 0) return [] as SourceRow[];
  const orderBy = ['fecha_registro', 'fecha', 'id'].find((column) => available.has(column)) ?? selected[0];
  const query = `SELECT TOP (@limit) ${selected.map(quoteIdentifier).join(', ')} FROM dbo.${quoteIdentifier(tableName)} ORDER BY ${quoteIdentifier(orderBy)} DESC;`;
  const result = await pool.request().input('limit', sql.Int, limit).query<SourceRow>(query);
  return result.recordset;
}

function value(row: SourceRow, candidates: string[]) {
  const entry = Object.entries(row).find(([key]) => candidates.includes(key.toLowerCase()));
  return entry?.[1] ?? null;
}

function text(valueToFormat: unknown) {
  if (valueToFormat === null || valueToFormat === undefined || valueToFormat === '') return null;
  return String(valueToFormat);
}

function dateText(valueToFormat: unknown) {
  if (valueToFormat === null || valueToFormat === undefined) return null;
  if (valueToFormat instanceof Date) return valueToFormat.toISOString();
  return String(valueToFormat);
}

function maritimeMode(negocio: string | null): Modalidad | 'OTRA' {
  if (negocio === '3') return 'FCL';
  if (negocio === '4') return 'LCL';
  if (negocio === '5') return 'BB';
  return 'OTRA';
}

function normalize(row: SourceRow, origen: FalconPreviewItem['origen']): FalconPreviewItem {
  const negocio = text(value(row, ['cod_negocio']));
  const identifier = text(value(row, ['id', 'id_cita'])) ?? 'SIN_IDENTIFICADOR';
  return {
    origen,
    identificador: identifier,
    modalidad: origen === 'AR_AEREO' ? 'AEREO' : maritimeMode(negocio),
    volante: text(value(row, ['volante', 'cpa_volante', 'cpa_lista_retiro', 'cnt'])),
    unidad: text(value(row, ['placa', 'unidad'])),
    fechaCita: dateText(value(row, ['fecha_cita', 'fecha'])),
    fechaRegistro: dateText(value(row, ['fecha_registro'])),
    fechaAtencion: dateText(value(row, ['fecha_atencion'])),
    negocio
  };
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

export async function vistaPreviaFalcon(limit = 15): Promise<FalconPreview> {
  const generatedAt = new Date().toISOString();
  if (!enabled()) {
    return { enabled: false, connected: false, generatedAt, items: [], message: 'Falcon está desactivado.' };
  }
  if (!configured()) {
    return { enabled: true, connected: false, generatedAt, items: [], message: 'Faltan datos de conexión de Falcon.' };
  }

  try {
    const pool = await new sql.ConnectionPool(connection(process.env.FALCON_EXTRANET_DB ?? '')).connect();
    try {
      const [maritimas, aereas, garitas] = await Promise.all([
        previewTable(pool, 'citas_programadas', limit),
        previewTable(pool, 'citas_programadas_aereo', limit),
        previewTable(pool, 'transportistas_citas', limit)
      ]);
      return {
        enabled: true,
        connected: true,
        generatedAt,
        items: [
          ...maritimas.map((row) => normalize(row, 'CITA_MARITIMA')),
          ...aereas.map((row) => normalize(row, 'AR_AEREO')),
          ...garitas.map((row) => normalize(row, 'GARITA'))
        ],
        message: 'Vista previa de solo lectura. No se guardó ni modificó información.'
      };
    } finally {
      await pool.close();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error desconocido al consultar Falcon.';
    return { enabled: true, connected: false, generatedAt, items: [], message: `No se pudo obtener la vista previa: ${message}` };
  }
}
