import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const scrypt = promisify(scryptCallback);

export type RolUsuario = 'ADMIN' | 'OPERADOR' | 'LECTURA';
export type UsuarioSesion = { id: string; email: string; nombre: string; rol: RolUsuario };
export type UsuarioAdministrable = UsuarioSesion & { activo: boolean; creadoEn: string };

function normalizarEmail(value: string) {
  return value.trim().toLowerCase();
}

function horasSesion() {
  const value = Number(process.env.AUTH_SESSION_HOURS ?? 12);
  return Number.isFinite(value) ? Math.min(Math.max(Math.floor(value), 1), 24) : 12;
}

export function autenticacionHabilitada() {
  return process.env.AUTH_ENABLED === 'true';
}

export async function asegurarEsquemaAutenticacion() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dashboard_usuarios (
      id UUID PRIMARY KEY,
      email VARCHAR(320) NOT NULL UNIQUE,
      nombre VARCHAR(160) NOT NULL,
      rol VARCHAR(20) NOT NULL CHECK (rol IN ('ADMIN', 'OPERADOR', 'LECTURA')),
      password_hash TEXT NOT NULL,
      activo BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS dashboard_sesiones (
      token_hash CHAR(64) PRIMARY KEY,
      usuario_id UUID NOT NULL REFERENCES dashboard_usuarios(id) ON DELETE CASCADE,
      expira_en TIMESTAMPTZ NOT NULL,
      revocada_en TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ultimo_uso_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_dashboard_sesiones_usuario ON dashboard_sesiones(usuario_id);
    CREATE INDEX IF NOT EXISTS idx_dashboard_sesiones_expira ON dashboard_sesiones(expira_en);
    CREATE TABLE IF NOT EXISTS dashboard_auditoria_acceso (
      id BIGSERIAL PRIMARY KEY,
      evento VARCHAR(40) NOT NULL,
      email VARCHAR(320),
      usuario_id UUID,
      ip VARCHAR(80),
      detalle VARCHAR(250),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  if (!autenticacionHabilitada()) return;
  const count = await pool.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM dashboard_usuarios');
  if (Number(count.rows[0]?.count ?? 0) > 0) return;

  const email = normalizarEmail(process.env.AUTH_BOOTSTRAP_EMAIL ?? '');
  const password = process.env.AUTH_BOOTSTRAP_PASSWORD ?? '';
  const nombre = (process.env.AUTH_BOOTSTRAP_NAME ?? 'Administrador Alfosac').trim();
  if (!email || !password) throw new Error('AUTH_ENABLED=true requiere AUTH_BOOTSTRAP_EMAIL y AUTH_BOOTSTRAP_PASSWORD para crear el primer administrador.');
  await crearUsuario({ email, nombre, password, rol: 'ADMIN' });
}

export async function crearUsuario(input: { email: string; nombre: string; password: string; rol: RolUsuario }) {
  const email = normalizarEmail(input.email);
  const nombre = input.nombre.trim();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Correo inválido.');
  if (nombre.length < 2) throw new Error('Indica el nombre del usuario.');
  if (input.password.length < 14) throw new Error('La contraseña debe tener al menos 14 caracteres.');
  const passwordHash = await hashPassword(input.password);
  const result = await pool.query<UsuarioSesion>(`
    INSERT INTO dashboard_usuarios (id, email, nombre, rol, password_hash)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id, email, nombre, rol
  `, [randomUUID(), email, nombre, input.rol, passwordHash]);
  return result.rows[0]!;
}

/** Lista únicamente datos administrativos; nunca expone credenciales ni hashes. */
export async function listarUsuarios() {
  const result = await pool.query<UsuarioAdministrable>(`
    SELECT id, email, nombre, rol, activo, created_at AS "creadoEn"
    FROM dashboard_usuarios
    ORDER BY email ASC
  `);
  return result.rows;
}

/** Actualiza la clave propia y mantiene activa solo la sesión desde la que se realizó el cambio. */
export async function cambiarContrasena(input: { usuarioId: string; contrasenaActual: string; contrasenaNueva: string; tokenActual?: string }) {
  if (input.contrasenaNueva.length < 14) throw new Error('La nueva contraseña debe tener al menos 14 caracteres.');
  const result = await pool.query<{ password_hash: string }>(`
    SELECT password_hash FROM dashboard_usuarios WHERE id = $1 AND activo = TRUE
  `, [input.usuarioId]);
  const usuario = result.rows[0];
  if (!usuario || !(await verifyPassword(input.contrasenaActual, usuario.password_hash))) {
    throw new Error('La contraseña actual no es válida.');
  }

  const passwordHash = await hashPassword(input.contrasenaNueva);
  await pool.query(`
    UPDATE dashboard_usuarios
    SET password_hash = $2, updated_at = NOW()
    WHERE id = $1
  `, [input.usuarioId, passwordHash]);

  if (input.tokenActual) {
    await pool.query(`
      UPDATE dashboard_sesiones
      SET revocada_en = NOW()
      WHERE usuario_id = $1 AND token_hash <> $2 AND revocada_en IS NULL
    `, [input.usuarioId, hashToken(input.tokenActual)]);
  }
}

export async function autenticarUsuario(emailInput: string, password: string) {
  const email = normalizarEmail(emailInput);
  const result = await pool.query<UsuarioSesion & { password_hash: string; activo: boolean }>(`
    SELECT id, email, nombre, rol, password_hash, activo
    FROM dashboard_usuarios WHERE email = $1
  `, [email]);
  const user = result.rows[0];
  if (!user || !user.activo || !(await verifyPassword(password, user.password_hash))) return null;
  return { id: user.id, email: user.email, nombre: user.nombre, rol: user.rol } satisfies UsuarioSesion;
}

export async function crearSesion(usuario: UsuarioSesion) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + horasSesion() * 60 * 60 * 1_000);
  await pool.query(`
    INSERT INTO dashboard_sesiones (token_hash, usuario_id, expira_en)
    VALUES ($1, $2, $3)
  `, [hashToken(token), usuario.id, expiresAt]);
  return { token, expiresAt };
}

export async function leerSesion(token: string | undefined) {
  if (!token) return null;
  const result = await pool.query<UsuarioSesion>(`
    SELECT usuario.id, usuario.email, usuario.nombre, usuario.rol
    FROM dashboard_sesiones sesion
    INNER JOIN dashboard_usuarios usuario ON usuario.id = sesion.usuario_id
    WHERE sesion.token_hash = $1 AND sesion.revocada_en IS NULL AND sesion.expira_en > NOW() AND usuario.activo = TRUE
  `, [hashToken(token)]);
  const user = result.rows[0] ?? null;
  if (user) await pool.query('UPDATE dashboard_sesiones SET ultimo_uso_en = NOW() WHERE token_hash = $1', [hashToken(token)]);
  return user;
}

export async function revocarSesion(token: string | undefined) {
  if (!token) return;
  await pool.query('UPDATE dashboard_sesiones SET revocada_en = NOW() WHERE token_hash = $1 AND revocada_en IS NULL', [hashToken(token)]);
}

export async function registrarAuditoria(evento: string, input: { email?: string; usuarioId?: string; ip?: string; detalle?: string }) {
  await pool.query(`
    INSERT INTO dashboard_auditoria_acceso (evento, email, usuario_id, ip, detalle)
    VALUES ($1, $2, $3, $4, $5)
  `, [evento, input.email ?? null, input.usuarioId ?? null, input.ip ?? null, input.detalle ?? null]);
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('base64url');
  const derived = await scrypt(password, salt, 64) as Buffer;
  return `scrypt$${salt}$${derived.toString('base64url')}`;
}

async function verifyPassword(password: string, stored: string) {
  const [algorithm, salt, expected] = stored.split('$');
  if (algorithm !== 'scrypt' || !salt || !expected) return false;
  const derived = await scrypt(password, salt, 64) as Buffer;
  const expectedBuffer = Buffer.from(expected, 'base64url');
  return expectedBuffer.length === derived.length && timingSafeEqual(expectedBuffer, derived);
}
