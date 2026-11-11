import ExcelJS from 'exceljs';
import type { ReporteOperativo } from './reports.js';

const navy = '080C48';
const blue = '329AD6';
const border: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'C9D8E5' } },
  left: { style: 'thin', color: { argb: 'C9D8E5' } },
  bottom: { style: 'thin', color: { argb: 'C9D8E5' } },
  right: { style: 'thin', color: { argb: 'C9D8E5' } }
};

function formatoTiempo(minutes: number | null) {
  if (minutes === null) return '—';
  const hours = Math.floor(minutes / 60);
  return `${String(hours).padStart(2, '0')}:${String(Math.round(minutes % 60)).padStart(2, '0')}:00`;
}

function fillFor(clasificacion: string) {
  if (clasificacion === 'ATENDIDA') return 'E5F6EA';
  if (clasificacion === 'ANULADA') return 'EEF2F6';
  if (clasificacion === 'NO_ATENDIDA' || clasificacion === 'PENDIENTE_ANULACION') return 'FDE9E9';
  if (clasificacion === 'PESAJE_LIBRE') return 'FFF6D9';
  return 'FFFFFF';
}

/** Genera un archivo .xlsx para descarga, sin fórmulas ni ejecución de macros. */
export async function reporteAExcel(report: ReporteOperativo) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ALFOSAC';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('Reporte operativo', { views: [{ state: 'frozen', ySplit: 4 }] });

  sheet.mergeCells('A1:G1');
  const title = sheet.getCell('A1');
  title.value = 'Cierre operativo FCL y LCL';
  title.font = { name: 'Poppins', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
  title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: navy } };
  title.alignment = { vertical: 'middle' };
  sheet.getRow(1).height = 28;

  sheet.mergeCells('A2:G2');
  const period = sheet.getCell('A2');
  const labelFecha = report.hasta ? `${report.fecha} al ${report.hasta}` : report.fecha;
  period.value = `Período: ${report.periodo.toLowerCase()} · ${labelFecha} · Modalidad: ${report.modalidad}`;
  period.font = { name: 'Poppins', size: 10, color: { argb: '3C566D' } };
  period.alignment = { vertical: 'middle' };

  const headers = ['Fecha', 'Hora de cita', 'Modalidad', 'Volante', 'Placa', 'Estado origen', 'Clasificación'];
  const header = sheet.getRow(4);
  header.values = headers;
  header.height = 23;
  header.eachCell((cell) => {
    cell.font = { name: 'Poppins', bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: navy } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = border;
  });

  for (const fila of report.filas) {
    const row = sheet.addRow([
      fila.fecha ?? '—', fila.horaCita ?? '—', fila.modalidad, fila.volante,
      fila.placa === '-' ? '—' : fila.placa, fila.estado.replaceAll('_', ' '), fila.clasificacion.replaceAll('_', ' ')
    ]);
    row.eachCell((cell) => {
      cell.font = { name: 'Poppins', size: 10, color: { argb: '17233D' } };
      cell.border = border;
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });
    const status = row.getCell(7);
    status.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillFor(fila.clasificacion) } };
    status.font = { name: 'Poppins', size: 10, bold: true, color: { argb: '17233D' } };
  }

  const anuladas = report.cierre.anuladas ?? report.resumen.anuladas;
  const noAtendidas = report.cierre.sinAtencion ?? report.resumen.noAtendidas;
  const atendidas = report.cierre.atendidas ?? report.resumen.atendidas;
  const resumen = [
    ['RESUMEN DEL PERÍODO', ''],
    ['Citas activas', report.estadisticas.citasAgendadas],
    ['Total de cierre', report.estadisticas.registroGarita + anuladas],
    ['Atendidas en garita', report.estadisticas.registroGarita],
    ['Completadas por balanza', atendidas],
    ['Anuladas', anuladas],
    ['Canceladas / no atendidas', noAtendidas],
    ['', ''],
    ['HITOS Y TIEMPOS', ''],
    ['Registro en garita', report.estadisticas.registroGarita],
    ['Primer pesaje', report.estadisticas.primerPesaje ?? '—'],
    ['Salida por balanza', report.estadisticas.salidaBalanza ?? '—'],
    ['Espera promedio', formatoTiempo(report.estadisticas.esperaPromedioMinutos)],
    ['Atención promedio', formatoTiempo(report.estadisticas.atencionPromedioMinutos)]
  ];
  resumen.forEach(([label, value], index) => {
    const row = index + 1;
    const left = sheet.getCell(row, 9);
    const right = sheet.getCell(row, 10);
    left.value = label;
    right.value = value;
    [left, right].forEach((cell) => {
      cell.font = { name: 'Poppins', size: 10, color: { argb: '17233D' } };
      cell.border = border;
      cell.alignment = { vertical: 'middle' };
    });
    if (label === 'RESUMEN DEL PERÍODO' || label === 'HITOS Y TIEMPOS') {
      sheet.mergeCells(row, 9, row, 10);
      left.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: navy } };
      left.font = { name: 'Poppins', bold: true, color: { argb: 'FFFFFFFF' } };
    } else if (label) {
      right.font = { name: 'Poppins', bold: true, color: { argb: navy } };
    }
  });

  for (let column = 1; column <= headers.length; column += 1) {
    let maxLength = headers[column - 1].length;
    sheet.getColumn(column).eachCell({ includeEmpty: false }, (cell) => { maxLength = Math.max(maxLength, String(cell.value ?? '').length); });
    sheet.getColumn(column).width = Math.min(Math.max(maxLength + 3, 13), 28);
  }
  sheet.getColumn(8).width = 3;
  sheet.getColumn(9).width = 29;
  sheet.getColumn(10).width = 18;
  sheet.autoFilter = { from: 'A4', to: `G${Math.max(4, report.filas.length + 4)}` };
  sheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
