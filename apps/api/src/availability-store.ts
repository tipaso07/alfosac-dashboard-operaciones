import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export type DisponibilidadHistorica = {
  fecha: string;
  capturadaEn: string;
  fuente: string;
  modalidades: Array<{
    modalidad: 'FCL' | 'LCL' | 'BB';
    horas: Array<{ hora: number; cuposDisponibles: number | null }>;
  }>;
};

/**
 * El histórico pertenece al dashboard; nunca se modifica Falcon. La captura
 * será invocada por un proceso autenticado cuando esté definida la fuente
 * publicada de disponibilidad.
 */
export async function asegurarEsquemaDisponibilidad() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS disponibilidad_capturas (
      id BIGSERIAL PRIMARY KEY,
      fecha_operativa DATE NOT NULL,
      capturada_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      fuente VARCHAR(40) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS disponibilidad_cupos (
      captura_id BIGINT NOT NULL REFERENCES disponibilidad_capturas(id) ON DELETE CASCADE,
      modalidad VARCHAR(10) NOT NULL,
      hora SMALLINT NOT NULL CHECK (hora BETWEEN 0 AND 23),
      cupos_disponibles INTEGER,
      PRIMARY KEY (captura_id, modalidad, hora)
    );
    CREATE INDEX IF NOT EXISTS idx_disponibilidad_capturas_fecha
      ON disponibilidad_capturas (fecha_operativa, capturada_en DESC);
  `);
}

export async function listarDisponibilidadHistorica(fecha: string): Promise<DisponibilidadHistorica | null> {
  const capture = await pool.query<{ id: string; fecha_operativa: string; capturada_en: string; fuente: string }>(`
    SELECT id, fecha_operativa::text, capturada_en, fuente
    FROM disponibilidad_capturas
    WHERE fecha_operativa = $1::date
    ORDER BY capturada_en DESC
    LIMIT 1;
  `, [fecha]);
  const base = capture.rows[0];
  if (!base) return null;
  const rows = await pool.query<{ modalidad: 'FCL' | 'LCL' | 'BB'; hora: number; cupos_disponibles: number | null }>(`
    SELECT modalidad, hora, cupos_disponibles
    FROM disponibilidad_cupos
    WHERE captura_id = $1
    ORDER BY modalidad, hora;
  `, [base.id]);
  const modalities = new Map<'FCL' | 'LCL' | 'BB', Array<{ hora: number; cuposDisponibles: number | null }>>();
  for (const row of rows.rows) {
    const values = modalities.get(row.modalidad) ?? [];
    values.push({ hora: row.hora, cuposDisponibles: row.cupos_disponibles });
    modalities.set(row.modalidad, values);
  }
  return {
    fecha: base.fecha_operativa,
    capturadaEn: base.capturada_en,
    fuente: base.fuente,
    modalidades: [...modalities.entries()].map(([modalidad, horas]) => ({ modalidad, horas }))
  };
}

/** Devuelve la última captura disponible de cada fecha en el rango solicitado. */
export async function listarDisponibilidadHistoricaRango(desde: string, hasta: string): Promise<DisponibilidadHistorica[]> {
  const captures = await pool.query<{ id: string; fecha_operativa: string; capturada_en: string; fuente: string }>(`
    SELECT DISTINCT ON (fecha_operativa) id, fecha_operativa::text, capturada_en, fuente
    FROM disponibilidad_capturas
    WHERE fecha_operativa >= $1::date AND fecha_operativa <= $2::date
    ORDER BY fecha_operativa, capturada_en DESC;
  `, [desde, hasta]);
  if (!captures.rows.length) return [];
  const ids = captures.rows.map((row) => row.id);
  const rows = await pool.query<{ captura_id: string; modalidad: 'FCL' | 'LCL' | 'BB'; hora: number; cupos_disponibles: number | null }>(`
    SELECT captura_id, modalidad, hora, cupos_disponibles
    FROM disponibilidad_cupos
    WHERE captura_id = ANY($1::bigint[])
    ORDER BY captura_id, modalidad, hora;
  `, [ids]);
  const cupsByCapture = new Map<string, Map<'FCL' | 'LCL' | 'BB', Array<{ hora: number; cuposDisponibles: number | null }>>>();
  for (const row of rows.rows) {
    const modalities = cupsByCapture.get(row.captura_id) ?? new Map();
    const values = modalities.get(row.modalidad) ?? [];
    values.push({ hora: row.hora, cuposDisponibles: row.cupos_disponibles });
    modalities.set(row.modalidad, values);
    cupsByCapture.set(row.captura_id, modalities);
  }
  return captures.rows.map((capture) => ({
    fecha: capture.fecha_operativa,
    capturadaEn: capture.capturada_en,
    fuente: capture.fuente,
    modalidades: [...(cupsByCapture.get(capture.id) ?? new Map()).entries()].map(([modalidad, horas]) => ({ modalidad, horas }))
  }));
}
