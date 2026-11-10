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

test('reporte calcula hitos y tiempos desde los pesajes GITS asociados al volante', () => {
  const cita: Operacion = {
    ...operation('EN_GARITA'), id: '1', volante: '166180', fechaGarita: '2026-10-29T07:05:00-05:00'
  };
  const report = crearReporteOperativo([cita], 'DIARIO', '2026-10-29', 'LCL', [{
    empresa: '01', movimiento: '0001', volante: '000000000166180', placa: 'CHJ827', contenedor: null,
    fechaGarita: '2026-10-29T07:12:00-05:00', fechaSalidaBalanza: '2026-10-29T07:42:00-05:00',
    fechaIngresoAlmacen: null, fechaSalidaAlmacen: null, pesoInicial: 100, pesoFinal: 250,
    pesoNetoBalanza: 150, cantidadTarjas: null, pesoMercaderiaDeclarado: 150
  }]);
  assert.deepEqual(report.estadisticas, {
    citasAgendadas: 1, registroGarita: 1, primerPesaje: 1, salidaBalanza: 1,
    esperaPromedioMinutos: 7, atencionPromedioMinutos: 30, gitsDisponible: true
  });
  assert.deepEqual(report.cierre, {
    atendidas: 1, anuladas: null, sinAtencion: null, pendienteAnulacion: null, disponible: true
  });
});
