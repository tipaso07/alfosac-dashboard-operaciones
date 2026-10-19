CREATE TABLE IF NOT EXISTS fuentes_sincronizacion (
  id BIGSERIAL PRIMARY KEY,
  fuente VARCHAR(30) NOT NULL UNIQUE,
  ultimo_cursor TEXT,
  ultima_sincronizacion TIMESTAMPTZ,
  estado VARCHAR(30) NOT NULL DEFAULT 'PENDIENTE',
  detalle_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS operaciones (
  id UUID PRIMARY KEY,
  fuente_origen VARCHAR(30) NOT NULL,
  identificador_origen VARCHAR(150) NOT NULL,
  llave_operacion VARCHAR(150),
  modalidad VARCHAR(20) NOT NULL,
  estado VARCHAR(40) NOT NULL,
  volante VARCHAR(100),
  unidad VARCHAR(50),
  fecha_cita TIMESTAMPTZ,
  fecha_garita TIMESTAMPTZ,
  fecha_ingreso_despacho TIMESTAMPTZ,
  fecha_completado TIMESTAMPTZ,
  actualizado_origen_en TIMESTAMPTZ,
  recibido_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (fuente_origen, identificador_origen)
);

CREATE INDEX IF NOT EXISTS idx_operaciones_modalidad_estado ON operaciones (modalidad, estado);
CREATE INDEX IF NOT EXISTS idx_operaciones_actualizado_origen ON operaciones (actualizado_origen_en DESC);
CREATE INDEX IF NOT EXISTS idx_operaciones_llave ON operaciones (llave_operacion);

