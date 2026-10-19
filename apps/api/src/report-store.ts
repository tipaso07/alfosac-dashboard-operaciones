import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import type { Operacion } from './domain.js';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

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
  const result = await pool.query<{
    identificador_origen: string; modalidad: Operacion['modalidad']; estado: Operacion['estado'];
    volante: string | null; unidad: string | null; fecha_cita: string | null; fecha_garita: string | null;
    fecha_ingreso_despacho: string | null; fecha_completado: string | null; fuente_origen: Operacion['fuente'];
  }>(`SELECT identificador_origen, modalidad, estado, volante, unidad, fecha_cita, fecha_garita,
      fecha_ingreso_despacho, fecha_completado, fuente_origen
     FROM operaciones ORDER BY COALESCE(fecha_cita, actualizado_origen_en) DESC LIMIT 500;`);
  return result.rows.map((row) => ({
    id: row.identificador_origen, modalidad: row.modalidad, estado: row.estado,
    volante: row.volante ?? row.identificador_origen, unidad: row.unidad ?? '-',
    fechaCita: row.fecha_cita, fechaGarita: row.fecha_garita,
    fechaIngresoDespacho: row.fecha_ingreso_despacho, fechaCompletado: row.fecha_completado,
    fuente: row.fuente_origen
  }));
}
