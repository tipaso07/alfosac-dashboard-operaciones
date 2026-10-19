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
  idCitaRelacionada: string | null;
  modalidad: Modalidad | 'OTRA';
  volante: string | null;
  unidad: string | null;
  fechaCita: string | null;
  horaCita: string | null;
  fechaRegistro: string | null;
  fechaAtencion: string | null;
  negocio: string | null;
}

export interface FalconPreview {
  enabled: boolean;
  connected: boolean;
  generatedAt: string;
  items: FalconPreviewItem[];
  camposDetectados: Record<string, string[]>;
  message: string;
}

export interface FalconCitaDetail {
  enabled: boolean;
  connected: boolean;
  citaId: string;
  cita: FalconPreviewItem | null;
  registrosGarita: FalconPreviewItem[];
  message: string;
}

export interface FalconMaritimeOperation {
  id: string;
  modalidad: Modalidad;
  volante: string;
  unidad: string;
  fechaCita: string | null;
  fechaGarita: string | null;
  fechaIngresoDespacho: string | null;
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
  'cpa_lista_retiro', 'cpa_flag_cita', 'flag_cita', 'cpa_id', 'cpa_fecha',
  'cpa_hora', 'cpa_fecha_registro', 'cpa_fecha_atencion', 'cpa_placa'
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
  if (selected.length === 0) return { rows: [] as SourceRow[], columns: [...available].sort() };
  const orderBy = ['fecha_registro', 'fecha', 'id'].find((column) => available.has(column)) ?? selected[0];
  const query = `SELECT TOP (@limit) ${selected.map(quoteIdentifier).join(', ')} FROM dbo.${quoteIdentifier(tableName)} ORDER BY ${quoteIdentifier(orderBy)} DESC;`;
  const result = await pool.request().input('limit', sql.Int, limit).query<SourceRow>(query);
  return { rows: result.recordset, columns: [...available].sort() };
}

async function previewTableByValue(
  pool: sql.ConnectionPool,
  tableName: string,
  filterColumn: string,
  filterValue: string
) {
  const columnsResult = await pool.request().input('tableName', sql.NVarChar, tableName).query<{ column_name: string }>(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = @tableName AND table_schema = 'dbo';
  `);
  const available = new Set(columnsResult.recordset.map((item) => item.column_name.toLowerCase()));
  if (!available.has(filterColumn.toLowerCase())) return [] as SourceRow[];
  const selected = columnsForPreview.filter((column) => available.has(column.toLowerCase()));
  if (selected.length === 0) return [] as SourceRow[];
  const query = `SELECT ${selected.map(quoteIdentifier).join(', ')} FROM dbo.${quoteIdentifier(tableName)} WHERE ${quoteIdentifier(filterColumn)} = @filterValue;`;
  const result = await pool.request().input('filterValue', sql.NVarChar, filterValue).query<SourceRow>(query);
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

function fechaConHora(fecha: unknown, hora: unknown) {
  const date = dateText(fecha);
  if (!date) return null;
  const day = date.slice(0, 10);
  const rawHour = text(hora);
  if (!rawHour) return `${day}T00:00:00-05:00`;
  const numericHour = rawHour.split(':')[0].padStart(2, '0');
  return `${day}T${numericHour}:00:00-05:00`;
}

function fechaReporte() {
  const value = process.env.DASHBOARD_REPORT_DATE?.trim();
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function maritimeMode(negocio: string | null): Modalidad | 'OTRA' {
  if (negocio === '3') return 'FCL';
  if (negocio === '4') return 'LCL';
  if (negocio === '5') return 'BB';
  return 'OTRA';
}

function normalize(row: SourceRow, origen: FalconPreviewItem['origen']): FalconPreviewItem {
  const negocio = text(value(row, ['cod_negocio']));
  const identifier = text(value(row, ['cpa_id', 'id', 'id_cita'])) ?? 'SIN_IDENTIFICADOR';
  return {
    origen,
    identificador: identifier,
    idCitaRelacionada: origen === 'GARITA' ? text(value(row, ['id_cita'])) : null,
    modalidad: origen === 'AR_AEREO' ? 'AEREO' : maritimeMode(negocio),
    volante: text(value(row, ['volante', 'cpa_volante', 'cpa_lista_retiro'])),
    unidad: text(value(row, ['placa', 'unidad', 'cpa_placa'])),
    fechaCita: dateText(value(row, ['fecha_cita', 'fecha', 'cpa_fecha'])),
    horaCita: text(value(row, ['hora', 'cpa_hora'])),
    fechaRegistro: dateText(value(row, ['fecha_registro', 'cpa_fecha_registro'])),
    fechaAtencion: dateText(value(row, ['fecha_atencion', 'cpa_fecha_atencion'])),
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
    return { enabled: false, connected: false, generatedAt, items: [], camposDetectados: {}, message: 'Falcon está desactivado.' };
  }
  if (!configured()) {
    return { enabled: true, connected: false, generatedAt, items: [], camposDetectados: {}, message: 'Faltan datos de conexión de Falcon.' };
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
          ...maritimas.rows.map((row) => normalize(row, 'CITA_MARITIMA')),
          ...aereas.rows.map((row) => normalize(row, 'AR_AEREO')),
          ...garitas.rows.map((row) => normalize(row, 'GARITA'))
        ],
        camposDetectados: {
          citas_programadas: maritimas.columns,
          citas_programadas_aereo: aereas.columns,
          transportistas_citas: garitas.columns
        },
        message: 'Vista previa de solo lectura. No se guardó ni modificó información.'
      };
    } finally {
      await pool.close();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error desconocido al consultar Falcon.';
    return { enabled: true, connected: false, generatedAt, items: [], camposDetectados: {}, message: `No se pudo obtener la vista previa: ${message}` };
  }
}

export async function detalleCitaFalcon(citaId: string): Promise<FalconCitaDetail> {
  const empty = (message: string, connected = false): FalconCitaDetail => ({
    enabled: enabled(), connected, citaId, cita: null, registrosGarita: [], message
  });
  if (!enabled()) return empty('Falcon está desactivado.');
  if (!configured()) return empty('Faltan datos de conexión de Falcon.');
  if (!/^\d+$/.test(citaId)) return empty('El identificador de cita no es válido.');

  try {
    const pool = await new sql.ConnectionPool(connection(process.env.FALCON_EXTRANET_DB ?? '')).connect();
    try {
      const [citas, garitas] = await Promise.all([
        previewTableByValue(pool, 'citas_programadas', 'id', citaId),
        previewTableByValue(pool, 'transportistas_citas', 'id_cita', citaId)
      ]);
      return {
        enabled: true,
        connected: true,
        citaId,
        cita: citas[0] ? normalize(citas[0], 'CITA_MARITIMA') : null,
        registrosGarita: garitas.map((row) => normalize(row, 'GARITA')),
        message: 'Detalle de solo lectura. No se guardó ni modificó información.'
      };
    } finally {
      await pool.close();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error desconocido al consultar Falcon.';
    return empty(`No se pudo obtener el detalle: ${message}`);
  }
}

export async function leerOperacionesMaritimas(limit = 250): Promise<FalconMaritimeOperation[]> {
  if (!enabled() || !configured()) throw new Error('Falcon no está disponible para importar.');
  const pool = await new sql.ConnectionPool(connection(process.env.FALCON_EXTRANET_DB ?? '')).connect();
  try {
    const date = fechaReporte();
    const dayStart = date ? 'CONVERT(date, @reportDate)' : 'CONVERT(date, GETDATE())';
    const citasRequest = pool.request().input('limit', sql.Int, limit);
    if (date) citasRequest.input('reportDate', sql.Date, date);
    const citasResult = await citasRequest.query<SourceRow>(`
      SELECT TOP (@limit) id, cod_negocio, fecha, hora, cod_volante, des_placa
      FROM dbo.citas_programadas
      WHERE cod_negocio IN (3, 4, 5)
        AND fecha >= ${dayStart}
        AND fecha < DATEADD(day, 1, ${dayStart})
      ORDER BY fecha DESC, hora DESC;
    `);

    const garitasRequest = pool.request().input('limit', sql.Int, limit);
    if (date) garitasRequest.input('reportDate', sql.Date, date);
    const garitasResult = await garitasRequest.query<SourceRow>(`
      SELECT TOP (@limit)
        c.id, c.cod_negocio, c.fecha, c.hora, c.cod_volante, c.des_placa,
        ultima.fecha_registro AS fecha_garita, ultima.des_placa AS placa_garita
      FROM dbo.citas_programadas c
      CROSS APPLY (
        SELECT TOP 1 g.fecha_registro, g.des_placa
        FROM dbo.transportistas_citas g
        WHERE g.id_cita = c.id
          AND g.fecha_registro >= ${dayStart}
          AND g.fecha_registro < DATEADD(day, 1, ${dayStart})
        ORDER BY g.fecha_registro DESC, g.id DESC
      ) ultima
      WHERE c.cod_negocio IN (3, 4, 5)
      ORDER BY ultima.fecha_registro DESC;
    `);

    const operations = new Map<string, FalconMaritimeOperation>();
    const save = (row: SourceRow, fechaGarita: string | null, placaGarita: string | null) => {
      const id = text(value(row, ['id']));
      const modalidad = maritimeMode(text(value(row, ['cod_negocio'])));
      if (!id || modalidad === 'OTRA') return;
      const previous = operations.get(id);
      operations.set(id, {
        id, modalidad,
        volante: text(value(row, ['cod_volante'])) ?? previous?.volante ?? id,
        unidad: placaGarita ?? text(value(row, ['des_placa'])) ?? previous?.unidad ?? '-',
        fechaCita: fechaConHora(value(row, ['fecha']), value(row, ['hora'])) ?? previous?.fechaCita ?? null,
        fechaGarita: fechaGarita ?? previous?.fechaGarita ?? null,
        fechaIngresoDespacho: null
      });
    };
    citasResult.recordset.forEach((row) => save(row, null, null));
    garitasResult.recordset.forEach((row) => save(row, dateText(value(row, ['fecha_garita'])), text(value(row, ['placa_garita']))));
    return [...operations.values()];
  } finally { await pool.close(); }
}

export async function leerOperacionesAereas(limit = 250): Promise<FalconMaritimeOperation[]> {
  if (!enabled() || !configured()) throw new Error('Falcon no está disponible para importar.');
  const pool = await new sql.ConnectionPool(connection(process.env.FALCON_EXTRANET_DB ?? '')).connect();
  try {
    const result = await pool.request().input('limit', sql.Int, limit).query<SourceRow>(`
      SELECT TOP (@limit) cpa_id, cpa_volante, cpa_lista_retiro, cpa_flag_cita, cpa_fecha_atencion
      FROM dbo.citas_programadas_aereo
      ORDER BY cpa_id DESC;
    `);
    return result.recordset.flatMap((row) => {
      const id = text(value(row, ['cpa_id']));
      if (!id) return [];
      return [{
        id: `AR-${id}`, modalidad: 'AEREO',
        volante: text(value(row, ['cpa_volante', 'cpa_lista_retiro'])) ?? id,
        unidad: '-', fechaCita: null,
        fechaGarita: null,
        fechaIngresoDespacho: dateText(value(row, ['cpa_fecha_atencion']))
      }];
    });
  } finally { await pool.close(); }
}
