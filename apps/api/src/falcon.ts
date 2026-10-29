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
  registrosTransporte: FalconTransportRecord[];
  historialTransporte: FalconTransportRecord[];
  controlesSalida: FalconControlSalida[];
  trazaLogistica: FalconLogisticTrace | null;
  message: string;
}

/** Eventos de la carga relacionados por id_master e id_hijo; se exponen con su origen explícito. */
export interface FalconLogisticTrace {
  idMaster: string | null;
  idHijo: string | null;
  estadoCita: string | null;
  registroCita: string | null;
  ingresoLocal: string | null;
  fechaLlegadaMaster: string | null;
  terminoDescarga: string | null;
  fechaDescarga: string | null;
  cierreTarja: string | null;
  fechaHoraTarja: string | null;
  fechaSalida: string | null;
  escaneoSalida: string | null;
  fechaEscaneoSalida: string | null;
  preRetiroAlIngreso: string | null;
  fastSalida: string | null;
  fechaFastSalida: string | null;
  ticketSalida: string | null;
  respuestaFastSalida: string | null;
  flagSalida: string | null;
}

export interface FalconTransportRecord {
  id: string;
  fechaRegistro: string | null;
  tipoCambio: string | null;
  placa: string | null;
  conductor: string | null;
  transportista: string | null;
}

export interface FalconControlSalida {
  id: string;
  fechaRegistro: string | null;
  estado: string | null;
  estadoToken: string | null;
  detalles: Array<{
    fechaRegistro: string | null;
    estadoProceso: string | null;
    descripcionEstado: string | null;
    estado: string | null;
  }>;
}

export interface FalconExitControlCandidate {
  citaId: string;
  controlId: string;
  fechaControl: string | null;
  estadoControl: string | null;
  modalidad: Modalidad | 'OTRA';
  fechaCita: string | null;
  horaCita: string | null;
  volante: string | null;
  fechaAtencion: string | null;
  etapasRegistradas: number;
}

export interface FalconLogisticEventSample {
  citaId: string;
  modalidad: Modalidad | 'OTRA';
  fechaCita: string | null;
  horaCita: string | null;
  volante: string | null;
  fechaAtencion: string | null;
  fechaHoraTarja: string | null;
  fechaSalida: string | null;
  fechaEscaneoSalida: string | null;
  fastSalida: string | null;
}

export interface FalconMaritimeOperation {
  id: string;
  modalidad: Modalidad;
  volante: string;
  unidad: string;
  contenedor: string | null;
  fechaCita: string | null;
  fechaGarita: string | null;
  fechaIngresoDespacho: string | null;
}

export interface FalconHourAppointment {
  id: string;
  modalidad: Modalidad;
  fecha: string | null;
  hora: string | null;
  volante: string | null;
  idMaster: string | null;
  idHijo: string | null;
  flagCita: string | null;
  express: string | null;
  fechaRegistro: string | null;
  fechaVigencia: string | null;
  fechaAtencion: string | null;
  /** Registro administrativo del transportista; no equivale a llegada física. */
  fechaRegistroTransporte: string | null;
  usuarioAtencion: string | null;
  placa: string | null;
  conductor: string | null;
  transportista: string | null;
}

export interface FalconCloseoutAudit {
  date: string;
  modalidad: Modalidad;
  total: number;
  grupos: Array<{ flagCita: string | null; tieneAtencion: boolean; usuarioAtencion: string | null; cantidad: number }>;
  items: Array<{
    id: string; hora: string | null; volante: string | null; flagCita: string | null;
    express: string | null; fechaAtencion: string | null; usuarioAtencion: string | null;
    fechaRegistro: string | null; fechaVigencia: string | null; placa: string | null;
  }>;
}

export interface FalconAnnulmentAudit {
  date: string;
  modalidad: Modalidad;
  anuladas: Array<{
    id: string; citaId: string | null; hora: string | null; volante: string | null;
    fechaAnulacion: string | null; usuarioAnula: string | null; placa: string | null;
  }>;
  pendientes: Array<{
    id: string; hora: string | null; volante: string | null; flagCita: string | null;
    fechaAtencion: string | null; placa: string | null;
  }>;
}

export interface FalconEventCandidate {
  schema: string;
  table: string;
  columns: string[];
}

const maritimeBusiness: Record<Modalidad, number | null> = {
  FCL: 3,
  LCL: 4,
  BB: 5,
  AEREO: null
};

/**
 * Consulta diagnóstica limitada: solo expone campos operativos de una hora y
 * modalidad concretas. No acepta SQL, nombres de tabla ni columnas arbitrarias.
 */
export async function consultarCitasPorHora(date: string, modalidad: Modalidad, hour: number): Promise<FalconHourAppointment[]> {
  const negocio = maritimeBusiness[modalidad];
  if (!negocio) throw new Error('La consulta por hora solo está disponible para FCL, LCL y BB.');
  if (!enabled() || !configured()) throw new Error('Falcon no está disponible para consultar.');

  const pool = await new sql.ConnectionPool(connection(process.env.FALCON_EXTRANET_DB ?? '')).connect();
  try {
    const result = await pool.request()
      .input('reportDate', sql.Date, date)
      .input('business', sql.Int, negocio)
      .input('hour', sql.Int, hour)
      .query<SourceRow>(`
        SELECT TOP (50)
          c.id, c.id_master, c.id_hijo, c.fecha, c.hora, c.cod_volante, c.flag_cita, c.express,
          c.fecha_registro, c.fec_vigencia, c.fecha_atencion, c.user_atencion_estado,
          c.des_placa, c.des_conductor, c.des_transportista,
          ultima.fecha_registro AS fecha_registro_transporte,
          ultima.des_placa AS placa_garita
        FROM dbo.citas_programadas c
        OUTER APPLY (
          SELECT TOP (1) g.fecha_registro, g.des_placa
          FROM dbo.transportistas_citas g
          WHERE g.id_cita = c.id
          ORDER BY g.fecha_registro DESC, g.id DESC
        ) ultima
        WHERE c.cod_negocio = @business
          AND c.fecha >= CONVERT(date, @reportDate)
          AND c.fecha < DATEADD(day, 1, CONVERT(date, @reportDate))
          AND c.hora = @hour
        ORDER BY c.fecha_registro ASC, c.id ASC;
      `);

    return result.recordset.map((row) => ({
      id: text(value(row, ['id'])) ?? '',
      modalidad,
      fecha: dateText(value(row, ['fecha'])),
      hora: text(value(row, ['hora'])),
      volante: text(value(row, ['cod_volante'])),
      idMaster: text(value(row, ['id_master'])),
      idHijo: text(value(row, ['id_hijo'])),
      flagCita: text(value(row, ['flag_cita'])),
      express: text(value(row, ['express'])),
      fechaRegistro: dateText(value(row, ['fecha_registro'])),
      fechaVigencia: dateText(value(row, ['fec_vigencia'])),
      fechaAtencion: dateText(value(row, ['fecha_atencion'])),
      fechaRegistroTransporte: dateText(value(row, ['fecha_registro_transporte'])),
      usuarioAtencion: text(value(row, ['user_atencion_estado'])),
      placa: text(value(row, ['placa_garita', 'des_placa'])),
      conductor: text(value(row, ['des_conductor'])),
      transportista: text(value(row, ['des_transportista']))
    }));
  } finally { await pool.close(); }
}

/**
 * Auditoría acotada del cierre diario. Devuelve los campos de estado tal como
 * están en Falcon para compararlos con el cierre operativo conocido; no
 * infiere anulaciones ni modifica la fuente.
 */
export async function auditarCierreFalcon(date: string, modalidad: Modalidad): Promise<FalconCloseoutAudit> {
  const negocio = maritimeBusiness[modalidad];
  if (!negocio) throw new Error('La auditoría de cierre solo está disponible para FCL, LCL y BB.');
  if (!enabled() || !configured()) throw new Error('Falcon no está disponible para consultar.');
  const pool = await new sql.ConnectionPool(connection(process.env.FALCON_EXTRANET_DB ?? '')).connect();
  try {
    const result = await pool.request().input('reportDate', sql.Date, date).input('business', sql.Int, negocio).query<SourceRow>(`
      SELECT TOP (300)
        c.id, c.hora, c.cod_volante, c.flag_cita, c.express,
        c.fecha_atencion, c.user_atencion_estado, c.fecha_registro, c.fec_vigencia,
        c.des_placa
      FROM dbo.citas_programadas c
      WHERE c.cod_negocio = @business
        AND c.fecha >= CONVERT(date, @reportDate)
        AND c.fecha < DATEADD(day, 1, CONVERT(date, @reportDate))
      ORDER BY c.hora ASC, c.id ASC;
    `);
    const items = result.recordset.map((row) => ({
      id: text(value(row, ['id'])) ?? '', hora: text(value(row, ['hora'])),
      volante: text(value(row, ['cod_volante'])), flagCita: text(value(row, ['flag_cita'])),
      express: text(value(row, ['express'])), fechaAtencion: dateText(value(row, ['fecha_atencion'])),
      usuarioAtencion: text(value(row, ['user_atencion_estado'])), fechaRegistro: dateText(value(row, ['fecha_registro'])),
      fechaVigencia: dateText(value(row, ['fec_vigencia'])), placa: text(value(row, ['des_placa']))
    }));
    const grouped = new Map<string, { flagCita: string | null; tieneAtencion: boolean; usuarioAtencion: string | null; cantidad: number }>();
    for (const item of items) {
      const tieneAtencion = Boolean(item.fechaAtencion);
      const key = `${item.flagCita ?? 'NULL'}|${tieneAtencion}|${item.usuarioAtencion ?? 'NULL'}`;
      const current = grouped.get(key) ?? { flagCita: item.flagCita, tieneAtencion, usuarioAtencion: item.usuarioAtencion, cantidad: 0 };
      current.cantidad += 1;
      grouped.set(key, current);
    }
    return { date, modalidad, total: items.length, grupos: [...grouped.values()], items };
  } finally { await pool.close(); }
}

/** Compara anulaciones persistidas contra citas que siguen sin atención. */
export async function auditarAnulacionesFalcon(date: string, modalidad: Modalidad): Promise<FalconAnnulmentAudit> {
  const negocio = maritimeBusiness[modalidad];
  if (!negocio) throw new Error('La auditoría de anulaciones solo está disponible para FCL, LCL y BB.');
  if (!enabled() || !configured()) throw new Error('Falcon no está disponible para consultar.');
  const pool = await new sql.ConnectionPool(connection(process.env.FALCON_EXTRANET_DB ?? '')).connect();
  try {
    const base = (request: sql.Request) => request.input('reportDate', sql.Date, date).input('business', sql.Int, negocio);
    const [anuladasResult, pendientesResult] = await Promise.all([
      base(pool.request()).query<SourceRow>(`
        SELECT TOP (300) id, id_cita, hora, cod_volante, fecha_registro_anulacion, user_elimina, des_placa
        FROM dbo.citas_programadas_anuladas
        WHERE cod_negocio = @business
          AND fecha >= CONVERT(date, @reportDate)
          AND fecha < DATEADD(day, 1, CONVERT(date, @reportDate))
        ORDER BY fecha_registro_anulacion ASC, id ASC;
      `),
      base(pool.request()).query<SourceRow>(`
        SELECT TOP (300) c.id, c.hora, c.cod_volante, c.flag_cita, c.fecha_atencion, c.des_placa
        FROM dbo.citas_programadas c
        WHERE c.cod_negocio = @business
          AND c.fecha >= CONVERT(date, @reportDate)
          AND c.fecha < DATEADD(day, 1, CONVERT(date, @reportDate))
          AND c.fecha_atencion IS NULL
          AND NOT EXISTS (
            SELECT 1
            FROM dbo.citas_programadas_anuladas a
            WHERE a.id_cita = c.id OR a.id = c.id
          )
        ORDER BY c.hora ASC, c.id ASC;
      `)
    ]);
    return {
      date, modalidad,
      anuladas: anuladasResult.recordset.map((row) => ({
        id: text(value(row, ['id'])) ?? '', citaId: text(value(row, ['id_cita'])), hora: text(value(row, ['hora'])),
        volante: text(value(row, ['cod_volante'])), fechaAnulacion: dateText(value(row, ['fecha_registro_anulacion'])),
        usuarioAnula: text(value(row, ['user_elimina'])), placa: text(value(row, ['des_placa']))
      })),
      pendientes: pendientesResult.recordset.map((row) => ({
        id: text(value(row, ['id'])) ?? '', hora: text(value(row, ['hora'])), volante: text(value(row, ['cod_volante'])),
        flagCita: text(value(row, ['flag_cita'])), fechaAtencion: dateText(value(row, ['fecha_atencion'])), placa: text(value(row, ['des_placa']))
      }))
    };
  } finally { await pool.close(); }
}

/**
 * Inventario limitado de candidatos para eventos operativos. Solo consulta el
 * catálogo de Falcon: no lee filas de negocio ni admite parámetros del cliente.
 */
export async function buscarEventosOperativosFalcon(): Promise<FalconEventCandidate[]> {
  if (!enabled() || !configured()) throw new Error('Falcon no está disponible para consultar.');
  const pool = await new sql.ConnectionPool(connection(process.env.FALCON_EXTRANET_DB ?? '')).connect();
  try {
    const result = await pool.request().query<{ table_schema: string; table_name: string; column_name: string }>(`
      WITH tablas_candidatas AS (
        SELECT DISTINCT table_schema, table_name
        FROM information_schema.columns
        WHERE table_schema NOT IN ('sys', 'INFORMATION_SCHEMA')
          AND (
            table_name LIKE '%garita%' OR table_name LIKE '%despacho%' OR table_name LIKE '%ingreso%'
            OR table_name LIKE '%atencion%' OR table_name LIKE '%salida%' OR table_name LIKE '%control%'
            OR table_name LIKE '%transporte%' OR table_name LIKE '%cita%'
            OR column_name LIKE '%garita%' OR column_name LIKE '%despacho%' OR column_name LIKE '%ingreso%'
            OR column_name LIKE '%atencion%' OR column_name LIKE '%salida%' OR column_name LIKE '%placa%'
            OR column_name LIKE '%conductor%' OR column_name LIKE '%transportista%'
          )
      )
      SELECT c.table_schema, c.table_name, c.column_name
      FROM information_schema.columns c
      INNER JOIN tablas_candidatas t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      ORDER BY c.table_schema, c.table_name, c.ordinal_position;
    `);

    const tables = new Map<string, FalconEventCandidate>();
    for (const row of result.recordset) {
      const key = `${row.table_schema}.${row.table_name}`;
      const candidate = tables.get(key) ?? { schema: row.table_schema, table: row.table_name, columns: [] };
      candidate.columns.push(row.column_name);
      tables.set(key, candidate);
    }
    return [...tables.values()].slice(0, 80);
  } finally { await pool.close(); }
}

/**
 * Localiza el módulo que conserva anulaciones o cancelaciones. Es un catálogo
 * de metadatos (tablas y vistas), no una lectura de citas ni una escritura.
 */
export async function buscarCandidatosAnulacionFalcon(): Promise<FalconEventCandidate[]> {
  if (!enabled() || !configured()) throw new Error('Falcon no está disponible para consultar.');
  const pool = await new sql.ConnectionPool(connection(process.env.FALCON_EXTRANET_DB ?? '')).connect();
  try {
    const result = await pool.request().query<{ table_schema: string; table_name: string; column_name: string }>(`
      WITH objetos_candidatos AS (
        SELECT DISTINCT table_schema, table_name
        FROM information_schema.columns
        WHERE table_schema NOT IN ('sys', 'INFORMATION_SCHEMA')
          AND (
            table_name LIKE '%anul%' OR table_name LIKE '%cancel%' OR table_name LIKE '%baja%'
            OR column_name LIKE '%anul%' OR column_name LIKE '%cancel%' OR column_name LIKE '%baja%'
            OR column_name LIKE '%motivo%' OR column_name LIKE '%vigencia%'
          )
      )
      SELECT c.table_schema, c.table_name, c.column_name
      FROM information_schema.columns c
      INNER JOIN objetos_candidatos o ON o.table_schema = c.table_schema AND o.table_name = c.table_name
      ORDER BY c.table_schema, c.table_name, c.ordinal_position;
    `);
    const tables = new Map<string, FalconEventCandidate>();
    for (const row of result.recordset) {
      const key = `${row.table_schema}.${row.table_name}`;
      const candidate = tables.get(key) ?? { schema: row.table_schema, table: row.table_name, columns: [] };
      candidate.columns.push(row.column_name);
      tables.set(key, candidate);
    }
    return [...tables.values()].slice(0, 100);
  } finally { await pool.close(); }
}

/** Citas vinculadas a un control de salida, para comparar sus eventos sin consulta libre. */
export async function listarCitasConControlSalida(limit = 10): Promise<FalconExitControlCandidate[]> {
  if (!enabled() || !configured()) throw new Error('Falcon no está disponible para consultar.');
  const pool = await new sql.ConnectionPool(connection(process.env.FALCON_EXTRANET_DB ?? '')).connect();
  try {
    const result = await pool.request().input('limit', sql.Int, limit).query<SourceRow>(`
      SELECT TOP (@limit)
        s.id_cita, s.id AS control_id, s.fecha_registro AS fecha_control,
        s.estado AS estado_control, c.cod_negocio, c.fecha, c.hora,
        c.cod_volante, c.fecha_atencion, COUNT(d.id) AS etapas_registradas
      FROM dbo.control_salida_carga s
      LEFT JOIN dbo.citas_programadas c ON c.id = s.id_cita
      LEFT JOIN dbo.control_salida_carga_detalle d ON d.id_control_salida = s.id
      WHERE s.id_cita IS NOT NULL
      GROUP BY s.id_cita, s.id, s.fecha_registro, s.estado, c.cod_negocio,
        c.fecha, c.hora, c.cod_volante, c.fecha_atencion
      ORDER BY s.fecha_registro DESC, s.id DESC;
    `);
    return result.recordset.map((row) => ({
      citaId: text(value(row, ['id_cita'])) ?? '',
      controlId: text(value(row, ['control_id'])) ?? '',
      fechaControl: dateText(value(row, ['fecha_control'])),
      estadoControl: text(value(row, ['estado_control'])),
      modalidad: maritimeMode(text(value(row, ['cod_negocio']))),
      fechaCita: dateText(value(row, ['fecha'])),
      horaCita: text(value(row, ['hora'])),
      volante: text(value(row, ['cod_volante'])),
      fechaAtencion: dateText(value(row, ['fecha_atencion'])),
      etapasRegistradas: Number(value(row, ['etapas_registradas']) ?? 0)
    }));
  } finally { await pool.close(); }
}

/** Muestra pocas citas históricas con eventos físicos de carga para validar el mapeo. */
export async function listarCitasConEventosLogisticos(limit = 5): Promise<FalconLogisticEventSample[]> {
  if (!enabled() || !configured()) throw new Error('Falcon no está disponible para consultar.');
  const pool = await new sql.ConnectionPool(connection(process.env.FALCON_EXTRANET_DB ?? '')).connect();
  try {
    const result = await pool.request().input('limit', sql.Int, limit).query<SourceRow>(`
      WITH hijos_con_evento AS (
        SELECT TOP (50)
          id_hijo, fecha_hora_tarja, fecha_salida, fecha_escaneo_salida, fast_salida
        FROM dbo.hijos_m
        WHERE fecha_hora_tarja IS NOT NULL
           OR fecha_salida IS NOT NULL
           OR fecha_escaneo_salida IS NOT NULL
        ORDER BY COALESCE(fecha_salida, fecha_escaneo_salida, fecha_hora_tarja) DESC
      )
      SELECT TOP (@limit)
        c.id AS cita_id, c.cod_negocio, c.fecha, c.hora, c.cod_volante, c.fecha_atencion,
        h.fecha_hora_tarja, h.fecha_salida, h.fecha_escaneo_salida, h.fast_salida
      FROM hijos_con_evento h
      CROSS APPLY (
        SELECT TOP (1) id, cod_negocio, fecha, hora, cod_volante, fecha_atencion
        FROM dbo.citas_programadas c
        WHERE CONVERT(nvarchar(255), c.id_hijo) = CONVERT(nvarchar(255), h.id_hijo)
        ORDER BY c.fecha DESC, c.id DESC
      ) c
      ORDER BY COALESCE(h.fecha_salida, h.fecha_escaneo_salida, h.fecha_hora_tarja) DESC;
    `);
    return result.recordset.map((row) => ({
      citaId: text(value(row, ['cita_id'])) ?? '',
      modalidad: maritimeMode(text(value(row, ['cod_negocio']))),
      fechaCita: dateText(value(row, ['fecha'])),
      horaCita: text(value(row, ['hora'])),
      volante: text(value(row, ['cod_volante'])),
      fechaAtencion: dateText(value(row, ['fecha_atencion'])),
      fechaHoraTarja: dateText(value(row, ['fecha_hora_tarja'])),
      fechaSalida: dateText(value(row, ['fecha_salida'])),
      fechaEscaneoSalida: dateText(value(row, ['fecha_escaneo_salida'])),
      fastSalida: text(value(row, ['fast_salida']))
    }));
  } finally { await pool.close(); }
}

export async function contarCitasPorHora(date: string) {
  if (!enabled() || !configured()) throw new Error('Falcon no está disponible para consultar.');
  const pool = await new sql.ConnectionPool(connection(process.env.FALCON_EXTRANET_DB ?? '')).connect();
  try {
    const result = await pool.request().input('reportDate', sql.Date, date).query<SourceRow>(`
      SELECT cod_negocio, hora, COUNT(*) AS cantidad
      FROM dbo.citas_programadas
      WHERE cod_negocio IN (3,4,5)
        AND fecha >= CONVERT(date, @reportDate)
        AND fecha < DATEADD(day, 1, CONVERT(date, @reportDate))
      GROUP BY cod_negocio, hora
      ORDER BY cod_negocio, hora;`);
    return result.recordset.map((row) => ({
      modalidad: maritimeMode(text(value(row, ['cod_negocio']))),
      hora: text(value(row, ['hora']))?.padStart(2, '0') ?? '—',
      cantidad: Number(value(row, ['cantidad']) ?? 0)
    })).filter((item) => item.modalidad !== 'OTRA');
  } finally { await pool.close(); }
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
    enabled: enabled(), connected, citaId, cita: null, registrosTransporte: [], historialTransporte: [], controlesSalida: [], trazaLogistica: null, message
  });
  if (!enabled()) return empty('Falcon está desactivado.');
  if (!configured()) return empty('Faltan datos de conexión de Falcon.');
  if (!/^\d+$/.test(citaId)) return empty('El identificador de cita no es válido.');

  try {
    const pool = await new sql.ConnectionPool(connection(process.env.FALCON_EXTRANET_DB ?? '')).connect();
    try {
      const [citas, transportes, historial, controles, logistica] = await Promise.all([
        previewTableByValue(pool, 'citas_programadas', 'id', citaId),
        pool.request().input('citaId', sql.Int, Number(citaId)).query<SourceRow>(`
          SELECT TOP (20) id, fecha_registro, des_placa, des_conductor, des_transportista
          FROM dbo.transportistas_citas
          WHERE id_cita = @citaId
          ORDER BY fecha_registro ASC, id ASC;
        `),
        pool.request().input('citaId', sql.Int, Number(citaId)).query<SourceRow>(`
          SELECT TOP (50) id, fecha_registro, flag_tipo, des_placa, des_conductor, des_transportista
          FROM dbo.transportistas_citas_historial
          WHERE id_cita = @citaId
          ORDER BY fecha_registro ASC, id ASC;
        `),
        pool.request().input('citaId', sql.Int, Number(citaId)).query<SourceRow>(`
          SELECT TOP (100)
            c.id AS control_id, c.fecha_registro AS control_fecha_registro,
            c.estado AS control_estado, c.estado_token,
            d.fecha_registro AS detalle_fecha_registro, d.id_estado_proceso,
            d.des_estado_proceso, d.estado AS detalle_estado
          FROM dbo.control_salida_carga c
          LEFT JOIN dbo.control_salida_carga_detalle d ON d.id_control_salida = c.id
          WHERE c.id_cita = @citaId
          ORDER BY c.fecha_registro ASC, d.fecha_registro ASC, d.id ASC;
        `),
        pool.request().input('citaId', sql.Int, Number(citaId)).query<SourceRow>(`
          SELECT TOP (1)
            c.id_master, c.id_hijo,
            v.cita_estado, v.registro AS registro_cita,
            m.ingreso_local, m.fecha_llegada AS fecha_llegada_master,
            m.termino_descarga, m.fecha_descarga, m.cierre_tarja,
            h.fecha_hora_tarja, h.fecha_salida, h.escaneo_salida,
            h.fecha_escaneo_salida, h.pre_retiro_al_ingreso, h.fast_salida,
            h.fecha_fast_salida, h.ticket_salida, h.respuesta_fast_salida,
            h.ws_flag_salida
          FROM dbo.citas_programadas c
          -- Falcon no conserva un tipo uniforme para estas llaves entre módulos.
          -- Esta traza es de una sola cita y normaliza a texto para evitar
          -- conversiones implícitas que podrían fallar con códigos alfanuméricos.
          LEFT JOIN dbo.hijos_m h ON CONVERT(nvarchar(255), h.id_hijo) = CONVERT(nvarchar(255), c.id_hijo)
          LEFT JOIN dbo.masters_m m ON CONVERT(nvarchar(255), m.id_master) = CONVERT(nvarchar(255), c.id_master)
          LEFT JOIN dbo.VW_LISTADO_CITAS_GENERAL v ON CONVERT(nvarchar(255), v.id) = CONVERT(nvarchar(255), c.id)
          WHERE c.id = @citaId;
        `)
      ]);

      const toTransport = (row: SourceRow): FalconTransportRecord => ({
        id: text(value(row, ['id'])) ?? '',
        fechaRegistro: dateText(value(row, ['fecha_registro'])),
        tipoCambio: text(value(row, ['flag_tipo'])),
        placa: text(value(row, ['des_placa'])),
        conductor: text(value(row, ['des_conductor'])),
        transportista: text(value(row, ['des_transportista']))
      });
      const controls = new Map<string, FalconControlSalida>();
      for (const row of controles.recordset) {
        const id = text(value(row, ['control_id'])) ?? '';
        if (!id) continue;
        const control = controls.get(id) ?? {
          id,
          fechaRegistro: dateText(value(row, ['control_fecha_registro'])),
          estado: text(value(row, ['control_estado'])),
          estadoToken: text(value(row, ['estado_token'])),
          detalles: []
        };
        if (value(row, ['detalle_fecha_registro', 'id_estado_proceso', 'des_estado_proceso']) !== null) {
          control.detalles.push({
            fechaRegistro: dateText(value(row, ['detalle_fecha_registro'])),
            estadoProceso: text(value(row, ['id_estado_proceso'])),
            descripcionEstado: text(value(row, ['des_estado_proceso'])),
            estado: text(value(row, ['detalle_estado']))
          });
        }
        controls.set(id, control);
      }
      return {
        enabled: true,
        connected: true,
        citaId,
        cita: citas[0] ? normalize(citas[0], 'CITA_MARITIMA') : null,
        registrosTransporte: transportes.recordset.map(toTransport),
        historialTransporte: historial.recordset.map(toTransport),
        controlesSalida: [...controls.values()],
        trazaLogistica: logistica.recordset[0] ? {
          idMaster: text(value(logistica.recordset[0], ['id_master'])),
          idHijo: text(value(logistica.recordset[0], ['id_hijo'])),
          estadoCita: text(value(logistica.recordset[0], ['cita_estado'])),
          registroCita: text(value(logistica.recordset[0], ['registro_cita'])),
          ingresoLocal: dateText(value(logistica.recordset[0], ['ingreso_local'])),
          fechaLlegadaMaster: dateText(value(logistica.recordset[0], ['fecha_llegada_master'])),
          terminoDescarga: dateText(value(logistica.recordset[0], ['termino_descarga'])),
          fechaDescarga: dateText(value(logistica.recordset[0], ['fecha_descarga'])),
          cierreTarja: dateText(value(logistica.recordset[0], ['cierre_tarja'])),
          fechaHoraTarja: dateText(value(logistica.recordset[0], ['fecha_hora_tarja'])),
          fechaSalida: dateText(value(logistica.recordset[0], ['fecha_salida'])),
          escaneoSalida: text(value(logistica.recordset[0], ['escaneo_salida'])),
          fechaEscaneoSalida: dateText(value(logistica.recordset[0], ['fecha_escaneo_salida'])),
          preRetiroAlIngreso: text(value(logistica.recordset[0], ['pre_retiro_al_ingreso'])),
          fastSalida: text(value(logistica.recordset[0], ['fast_salida'])),
          fechaFastSalida: dateText(value(logistica.recordset[0], ['fecha_fast_salida'])),
          ticketSalida: text(value(logistica.recordset[0], ['ticket_salida'])),
          respuestaFastSalida: text(value(logistica.recordset[0], ['respuesta_fast_salida'])),
          flagSalida: text(value(logistica.recordset[0], ['ws_flag_salida']))
        } : null,
        message: 'Traza de solo lectura. Los registros de transporte no se interpretan como llegada a garita.'
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
      SELECT TOP (@limit) id, cod_negocio, fecha, hora, cod_volante, des_placa, des_contenedor
      FROM dbo.citas_programadas
      WHERE cod_negocio IN (3, 4, 5)
        AND fecha >= ${dayStart}
        AND fecha < DATEADD(day, 1, ${dayStart})
      ORDER BY fecha DESC, hora DESC;
    `);

    const operations = new Map<string, FalconMaritimeOperation>();
    const save = (row: SourceRow) => {
      const id = text(value(row, ['id']));
      const modalidad = maritimeMode(text(value(row, ['cod_negocio'])));
      if (!id || modalidad === 'OTRA') return;
      const previous = operations.get(id);
      operations.set(id, {
        id, modalidad,
        volante: text(value(row, ['cod_volante'])) ?? previous?.volante ?? id,
        unidad: text(value(row, ['des_placa'])) ?? previous?.unidad ?? '-',
        contenedor: text(value(row, ['des_contenedor'])) ?? previous?.contenedor ?? null,
        fechaCita: fechaConHora(value(row, ['fecha']), value(row, ['hora'])) ?? previous?.fechaCita ?? null,
        // El preregistro de transportista no se debe interpretar como garita.
        fechaGarita: null,
        fechaIngresoDespacho: null
      });
    };
    citasResult.recordset.forEach(save);
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
        unidad: '-', contenedor: null, fechaCita: null,
        fechaGarita: null,
        fechaIngresoDespacho: dateText(value(row, ['cpa_fecha_atencion']))
      }];
    });
  } finally { await pool.close(); }
}
