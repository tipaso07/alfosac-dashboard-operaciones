/**
 * GITS aún no se conecta: esta capa separa su configuración de Falcon para
 * evitar que el dashboard dependa de una fuente no validada.
 */
export interface GitsDiagnostic {
  enabled: boolean;
  configured: boolean;
  connected: false;
  message: string;
}

export function diagnosticarGits(): GitsDiagnostic {
  const enabled = process.env.GITS_SYNC_ENABLED === 'true';
  const configured = Boolean(
    process.env.GITS_DB_HOST
    && process.env.GITS_DB_NAME
    && process.env.GITS_DB_USER
    && process.env.GITS_DB_PASSWORD
  );
  if (!enabled) return { enabled, configured, connected: false, message: 'GITS está desactivado hasta validar su acceso de solo lectura y mapeo.' };
  if (!configured) return { enabled, configured, connected: false, message: 'Faltan datos de conexión de GITS.' };
  return { enabled, configured, connected: false, message: 'GITS está configurado, pendiente de validar tablas y relaciones con Falcon.' };
}
