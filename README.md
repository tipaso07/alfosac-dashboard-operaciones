# Dashboard Operativo Alfosac

Panel interno para visualizar el flujo operativo de FCL, LCL, BB y Aéreo. Es un sistema independiente de Compras: tendrá su propia API, base de datos y despliegue Docker.

Por ahora trabaja con datos de demostración. Falcon y GITS permanecen desactivados hasta contar con el acceso de solo lectura y el mapeo definitivo de sus campos.

## Arquitectura

```text
Vista TV / Panel interno → API del dashboard → base de reportes propia
                                             ↑
                                  adaptadores Falcon y GITS
```

- `apps/web`: pantalla para televisores y panel operativo.
- `apps/api`: API y reglas de indicadores.
- `database`: estructura de PostgreSQL para el modelo de reportes.

## Inicio local

1. Copia `.env.example` como `.env`.
2. Ejecuta `docker compose up --build`.
3. Abre `http://localhost:8090/tv` para la vista de televisores o `http://localhost:8090/dashboard` para el panel interno.

La API queda disponible internamente en `/api`; el puerto `5100` se expone solo para desarrollo local.

## Integración futura

El conector Falcon ya queda preparado, pero se mantiene desactivado por seguridad. Al activarlo solo comprueba la conexión de lectura y que estén disponibles las tablas que se usarán para el mapeo; aún no carga datos automáticos sin validar primero el resultado en la PC operativa.

Variables de Falcon:

- `FALCON_SYNC_ENABLED`
- `FALCON_DB_HOST`, `FALCON_DB_PORT`
- `FALCON_EXTRANET_DB`, `FALCON_MAESTROS_DB`
- `FALCON_DB_USER`, `FALCON_DB_PASSWORD`
- `FALCON_DB_ENCRYPT`, `FALCON_DB_TRUST_CERTIFICATE`
- `FALCON_SYNC_INTERVAL_SECONDS`
- `GITS_SYNC_ENABLED`

Cada conector deberá consultar únicamente cambios nuevos y guardarlos en esta base de reportes. Las pantallas nunca deberán consultar Falcon ni GITS directamente.

Cuando se despliegue en la PC con acceso a Falcon, se activa temporalmente `FALCON_SYNC_ENABLED=true` y se revisa `http://localhost:5100/api/integrations/falcon`. Este diagnóstico no expone contraseñas ni modifica Falcon.
