
export interface Message {
  id: string;
  role: 'user' | 'model' | 'system';
  content: string;
  timestamp: Date;
  chartData?: ChartConfig; // Datos opcionales del gráfico para renderizar
  isThinking?: boolean;
}

export interface Dataset {
  id: string;
  name: string;
  source: 'file' | 'socrata';
  data: any[]; // Array de objetos
  columns: string[];
  rowCount: number;
}

export interface ChartConfig {
  type: 'bar' | 'line' | 'pie' | 'scatter';
  title: string;
  data: any[];
  xAxisKey: string;
  seriesKeys: string[];
  description?: string;
}

export interface SocrataSearchResult {
  resource: {
    id: string;
    name: string;
    description: string;
    updatedAt: string;
    type: string;
  };
  classification: {
    domain_metadata: any;
  };
}

export enum AnalysisType {
  CLEANING = "Limpieza de Datos",
  ANALYSIS = "Análisis de Datos",
  DASHBOARD = "Generación de gráficos"
}
