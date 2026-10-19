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

El conector Falcon se mantiene separado de la base propia del dashboard y usa únicamente consultas de lectura. La importación automática requiere una activación explícita, después de validar el resultado en la PC operativa.

Variables de Falcon:

- `FALCON_SYNC_ENABLED`
- `FALCON_DB_HOST`, `FALCON_DB_PORT`
- `FALCON_EXTRANET_DB`, `FALCON_MAESTROS_DB`
- `FALCON_DB_USER`, `FALCON_DB_PASSWORD`
- `FALCON_DB_ENCRYPT`, `FALCON_DB_TRUST_CERTIFICATE`
- `FALCON_SYNC_INTERVAL_SECONDS`
- `FALCON_AUTO_SYNC_ENABLED`: activa la importación periódica; queda en `false` por defecto.
- `GITS_SYNC_ENABLED`

Cada conector deberá consultar únicamente cambios nuevos y guardarlos en esta base de reportes. Las pantallas nunca deberán consultar Falcon ni GITS directamente.

Cuando se despliegue en la PC con acceso a Falcon, se activa temporalmente `FALCON_SYNC_ENABLED=true` y se revisa `http://localhost:5100/api/integrations/falcon`. Este diagnóstico no expone contraseñas ni modifica Falcon.

Para validar los campos antes de construir la sincronización está disponible `http://localhost:5100/api/integrations/falcon/preview`. Devuelve como máximo 15 registros recientes de citas marítimas, A.R. aéreas y garita. Es una consulta limitada, de solo lectura y no guarda información.

También se puede comprobar una trazabilidad marítima puntual con `http://localhost:5100/api/integrations/falcon/citas/<id-cita>`. Devuelve la cita y sus registros de garita relacionados, sin consultar ni modificar otros datos.

Para revisar una hora concreta de Falcon sin una herramienta SQL, está disponible la consulta limitada:

```text
http://localhost:5100/api/integrations/falcon/citas?date=2026-10-19&modalidad=LCL&hour=7
```

Solo acepta fecha, modalidad marítima y hora; no permite ejecutar SQL libre. Incluye la última garita disponible, placa, conductor y transportista cuando Falcon los tenga.

GITS conserva una configuración independiente y apagada por defecto. Cuando se entregue su acceso de solo lectura se configurarán `GITS_DB_HOST`, `GITS_DB_PORT`, `GITS_DB_NAME`, `GITS_DB_USER`, `GITS_DB_PASSWORD`, `GITS_DB_ENCRYPT` y `GITS_DB_TRUST_CERTIFICATE`; el dashboard seguirá funcionando con Falcon aunque GITS no esté disponible.

## Revisar un día específico

Por defecto el dashboard muestra el día actual en Lima. Para revisar una jornada anterior sin modificar Falcon, agrega temporalmente en `.env`:

```text
DASHBOARD_REPORT_DATE=2026-10-14
```

Luego reconstruye la API e importa de forma manual. Falcon se consulta solo en lectura para esa fecha y los datos se guardan únicamente en la base propia del dashboard. Al terminar la revisión, deja la variable vacía para volver a mostrar el día actual.
