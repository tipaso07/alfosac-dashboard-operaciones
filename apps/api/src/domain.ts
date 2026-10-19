export type Modalidad = 'FCL' | 'LCL' | 'BB' | 'AEREO';
export type EstadoOperacion = 'AGENDADA' | 'EN_GARITA' | 'EN_DESPACHO' | 'COMPLETADA' | 'NO_COMPLETADA';

export interface Operacion {
  id: string;
  modalidad: Modalidad;
  estado: EstadoOperacion;
  volante: string;
  unidad: string;
  fechaCita: string | null;
  fechaGarita: string | null;
  fechaIngresoDespacho: string | null;
  fechaCompletado: string | null;
  fuente: 'DEMO' | 'FALCON' | 'GITS';
}

export interface ResumenModalidad {
  modalidad: Modalidad;
  agendadas: number;
  garita: number;
  despacho: number;
  completadas: number;
  noCompletadas: number;
}

