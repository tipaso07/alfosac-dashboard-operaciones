import assert from 'node:assert/strict';
import test from 'node:test';
import { crearReporteOperativo } from './reports.js';
import type { Operacion } from './domain.js';

const operation = (estado: Operacion['estado']): Operacion => ({
  id: estado, modalidad: 'LCL', estado, volante: estado, unidad: 'ABC123',
  fechaCita: '2026-10-29T07:00:00-05:00', fechaGarita: null,
  fechaIngresoDespacho: null, fechaCompletado: null, fuente: 'FALCON'
});

test('reporte no convierte un pesaje libre en cita atendida', () => {
  const report = crearReporteOperativo([
    operation('COMPLETADA'), operation('NO_COMPLETADA'), operation('PENDIENTE_ANULACION'), operation('ANULADA'), operation('PESAJE_LIBRE')
  ], 'DIARIO', '2026-10-29', 'LCL');
  assert.deepEqual(report.resumen, {
    programadas: 5, atendidas: 1, noAtendidas: 1, pendientesAnulacion: 1,
    anuladas: 1, pesajesLibres: 1, porConfirmar: 0
  });
});
