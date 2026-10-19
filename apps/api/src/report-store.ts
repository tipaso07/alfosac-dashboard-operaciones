import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import type { Operacion } from './domain.js';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export function fechaActualLima() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export function fechaReporteActual() {
  const configuredDate = process.env.DASHBOARD_REPORT_DATE?.trim();
  return configuredDate && /^\d{4}-\d{2}-\d{2}$/.test(configuredDate) ? configuredDate : fechaActualLima();
}

function stableUuid(value: string) {
  const hex = createHash('sha256').update(value).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`;
}

export async function guardarOperaciones(operaciones: Operacion[]) {
  for (const item of operaciones) {
    await pool.query(`
      INSERT INTO operaciones (
        id, fuente_origen, identificador_origen, llave_operacion, modalidad, estado,
        volante, unidad, fecha_cita, fecha_garita, fecha_ingreso_despacho,
        fecha_completado, actualizado_origen_en
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
      ON CONFLICT (fuente_origen, identificador_origen) DO UPDATE SET
        llave_operacion = EXCLUDED.llave_operacion,
        modalidad = EXCLUDED.modalidad,
        estado = EXCLUDED.estado,
        volante = EXCLUDED.volante,
        unidad = EXCLUDED.unidad,
        fecha_cita = EXCLUDED.fecha_cita,
        fecha_garita = EXCLUDED.fecha_garita,
        fecha_ingreso_despacho = EXCLUDED.fecha_ingreso_despacho,
        fecha_completado = EXCLUDED.fecha_completado,
        actualizado_origen_en = NOW(),
        recibido_en = NOW();
    `, [
      stableUuid(`FALCON:${item.id}`), 'FALCON', item.id, item.id, item.modalidad, item.estado,
      item.volante, item.unidad, item.fechaCita, item.fechaGarita,
      item.fechaIngresoDespacho, item.fechaCompletado
    ]);
  }
}

export async function listarOperaciones() {
  const reportDate = fechaReporteActual();
  const result = await pool.query<{
    identificador_origen: string; modalidad: Operacion['modalidad']; estado: Operacion['estado'];
    volante: string | null; unidad: string | null; fecha_cita: string | null; fecha_garita: string | null;
    fecha_ingreso_despacho: string | null; fecha_completado: string | null; fuente_origen: Operacion['fuente'];
  }>(`SELECT identificador_origen, modalidad, estado, volante, unidad, fecha_cita, fecha_garita,
      fecha_ingreso_despacho, fecha_completado, fuente_origen
     FROM operaciones
     WHERE (
       fecha_cita >= (($1::date)::timestamp AT TIME ZONE 'America/Lima')
       AND fecha_cita < ((($1::date + 1)::timestamp) AT TIME ZONE 'America/Lima')
     ) OR (
       fecha_garita >= (($1::date)::timestamp AT TIME ZONE 'America/Lima')
       AND fecha_garita < ((($1::date + 1)::timestamp) AT TIME ZONE 'America/Lima')
     ) OR (
       fecha_ingreso_despacho >= (($1::date)::timestamp AT TIME ZONE 'America/Lima')
       AND fecha_ingreso_despacho < ((($1::date + 1)::timestamp) AT TIME ZONE 'America/Lima')
     ) OR (
       fecha_completado >= (($1::date)::timestamp AT TIME ZONE 'America/Lima')
       AND fecha_completado < ((($1::date + 1)::timestamp) AT TIME ZONE 'America/Lima')
     )
     ORDER BY COALESCE(fecha_cita, fecha_ingreso_despacho, fecha_garita) DESC LIMIT 500;`, [reportDate]);
  return result.rows.map((row) => ({
    id: row.identificador_origen, modalidad: row.modalidad, estado: row.estado,
    volante: row.volante ?? row.identificador_origen, unidad: row.unidad ?? '-',
    fechaCita: row.fecha_cita, fechaGarita: row.fecha_garita,
    fechaIngresoDespacho: row.fecha_ingreso_despacho, fechaCompletado: row.fecha_completado,
    fuente: row.fuente_origen
  }));
}

export async function listarPendientesLlegada() {
  const result = await pool.query<{
    identificador_origen: string; modalidad: Operacion['modalidad']; estado: Operacion['estado']; volante: string | null; unidad: string | null; fecha_cita: string | null; fuente_origen: Operacion['fuente'];
  }>(`SELECT identificador_origen, modalidad, estado, volante, unidad, fecha_cita, fuente_origen
      FROM operaciones
      WHERE fecha_cita < (((NOW() AT TIME ZONE 'America/Lima')::date)::timestamp AT TIME ZONE 'America/Lima')
        AND fecha_garita IS NULL
        AND fecha_ingreso_despacho IS NULL
        AND fecha_completado IS NULL
      ORDER BY fecha_cita ASC LIMIT 100;`);
  return result.rows.map((row) => ({
    id: row.identificador_origen, modalidad: row.modalidad, estado: row.estado,
    volante: row.volante ?? row.identificador_origen, unidad: row.unidad ?? '-',
    fechaCita: row.fecha_cita, fechaGarita: null, fechaIngresoDespacho: null, fechaCompletado: null, fuente: row.fuente_origen
  }));
}
