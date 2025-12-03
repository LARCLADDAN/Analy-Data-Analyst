import React, { useEffect, useRef } from 'react';
import { Message, Dataset } from '../types';
import { User, BrainCircuit, Table as TableIcon } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell } from 'recharts';
import { ANALY_AVATAR_URL } from '../constants';

interface ChatInterfaceProps {
  messages: Message[];
  isThinking: boolean;
  datasets: Dataset[];
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16', '#6366f1'];

// --- Sub-componentes para renderizar contenido ---

const ChartRenderer: React.FC<{ config: any; datasets: Dataset[] }> = ({ config, datasets }) => {
  // 1. Obtención de Datos
  let rawData = config.data;
  
  // Si el agente no envió datos, intentar recuperar del último dataset activo
  if (!rawData || rawData.length === 0) {
    if (datasets.length > 0) {
      // Tomamos TODOS los datos del dataset, SIN recortar aún.
      // Esto permite que la auto-agregación posterior tenga en cuenta todo el universo de datos descargados.
      rawData = datasets[datasets.length - 1].data;
    }
  }

  // Auto-Agregación de Emergencia (Si el agente mandó datos crudos o usamos el fallback de datos completos)
  // Se activa si hay > 20 filas y es un gráfico categórico (Barras o Pastel)
  if (rawData && rawData.length > 20 && config.xAxisKey && (config.type === 'bar' || config.type === 'pie')) {
      const counts: Record<string, number> = {};
      
      // Iterar sobre TODO el conjunto de datos disponible (puede ser 5000 o 10000 filas)
      // Javascript moderno maneja loops de 10k-50k iteraciones muy rápido.
      rawData.forEach((row: any) => {
          const key = String(row[config.xAxisKey]);
          // Contar ocurrencias (Frecuencia)
          counts[key] = (counts[key] || 0) + 1;
      });
      
      // Verificar si realmente logramos agrupar (si las categorías son muchas menos que las filas)
      // Si tenemos 1000 filas y 900 categorías, no es un buen candidato para agrupar.
      if (Object.keys(counts).length < rawData.length * 0.8) {
          // Transformar a formato gráfico, ordenar por valor descendente y recortar el Top 20
          // para que el gráfico sea legible.
          rawData = Object.entries(counts).map(([key, count]) => ({
              [config.xAxisKey]: key,
              [config.seriesKeys[0] || 'count']: count
          })).sort((a: any, b: any) => b[config.seriesKeys[0] || 'count'] - a[config.seriesKeys[0] || 'count']).slice(0, 20); 
      }
  }

  // Recorte de Seguridad Final
  // Si NO se realizó agregación (ej. gráfico de Línea con datos crudos), 
  // limitamos a 1000 puntos para evitar colapso del DOM/SVG, pero mejor que los 50 anteriores.
  if (rawData && rawData.length > 1000) {
      rawData = rawData.slice(0, 1000);
  }

  if (!rawData || rawData.length === 0) {
    return <div className="p-3 bg-red-900/20 border border-red-900/50 text-red-300 text-xs rounded">No hay datos disponibles para renderizar el gráfico.</div>;
  }

  // 2. Inferencia de Claves (Si faltan o son incorrectas)
  // Asegurar que seriesKeys es un array
  let keys = Array.isArray(config.seriesKeys) ? config.seriesKeys : (config.seriesKeys ? [config.seriesKeys] : []);
  let xAxisKey = config.xAxisKey;

  // Si no hay keys definidas o la definida no existe en el primer dato, intentar inferir
  const firstItem = rawData[0];
  if (firstItem) {
      // Si xAxisKey no existe en los datos, buscar la primera propiedad string
      if (!xAxisKey || !(xAxisKey in firstItem)) {
          const stringKey = Object.keys(firstItem).find(k => typeof firstItem[k] === 'string');
          if (stringKey) xAxisKey = stringKey;
      }

      // Si no hay seriesKeys válidas, buscar propiedades numéricas
      const validKeyExists = keys.some((k: string) => k in firstItem);
      if (keys.length === 0 || !validKeyExists) {
          const numberKeys = Object.keys(firstItem).filter(k => {
             const val = firstItem[k];
             return (typeof val === 'number' || (!isNaN(Number(val)) && val !== '')) && k !== xAxisKey;
          });
          if (numberKeys.length > 0) {
              keys = numberKeys; // Usar todas las columnas numéricas encontradas
          }
      }
  }

  // Fallback final si la inferencia falla
  if (keys.length === 0 && Object.keys(firstItem || {}).length > 0) {
      // Usar la segunda columna si existe, o la primera si no es la X
      const allKeys = Object.keys(firstItem);
      const fallbackKey = allKeys.find(k => k !== xAxisKey) || allKeys[0];
      if (fallbackKey) keys = [fallbackKey];
  }

  // 3. Sanitización de Datos Numéricos
  // Convertir strings numéricos a números reales para que Recharts no falle
  const chartData = rawData.map((item: any) => {
      const newItem = { ...item };
      keys.forEach((key: string) => {
          const val = Number(item[key]);
          if (!isNaN(val)) {
              newItem[key] = val;
          }
      });
      return newItem;
  });


  // Renderizado personalizado de etiquetas para Pastel (Texto Blanco)
  const renderCustomizedLabel = (props: any) => {
    const { cx, cy, midAngle, innerRadius, outerRadius, percent } = props;
    if (percent < 0.03) return null; // Ocultar < 3%
    
    const RADIAN = Math.PI / 180;
    const radius = outerRadius * 1.25; // Distancia de la etiqueta
    const x = cx + radius * Math.cos(-midAngle * RADIAN);
    const y = cy + radius * Math.sin(-midAngle * RADIAN);
  
    return (
      <text 
        x={x} 
        y={y} 
        fill="#e5e5e5" 
        textAnchor={x > cx ? 'start' : 'end'} 
        dominantBaseline="central"
        fontSize={10}
        fontWeight={500}
      >
        {`${(percent * 100).toFixed(0)}%`}
      </text>
    );
  };

  return (
    <div className="h-96 w-full mt-4 bg-[#111111] p-4 rounded-lg border border-[#333333] shadow-inner flex flex-col">
      <h4 className="text-sm font-semibold mb-2 text-center text-gray-200 shrink-0">{config.title}</h4>
      <p className="text-xs text-gray-500 text-center mb-4 shrink-0">{config.description}</p>
      
      <div className="flex-1 w-full min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          {config.type === 'bar' ? (
            <BarChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 40 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#333333" />
              <XAxis 
                dataKey={xAxisKey} 
                stroke="#6b7280" 
                fontSize={10} 
                tickFormatter={formatXAxis}
                angle={-45}
                textAnchor="end"
                height={60}
                interval={0}
              />
              <YAxis stroke="#6b7280" fontSize={10} />
              <Tooltip {...tooltipStyle} cursor={{ fill: '#333333', opacity: 0.4 }} />
              <Legend verticalAlign="top" height={36}/>
              {keys.map((key: string, idx: number) => (
                <Bar key={key} dataKey={key} fill={COLORS[idx % COLORS.length]} radius={[4, 4, 0, 0]} />
              ))}
            </BarChart>
          ) : config.type === 'line' ? (
            <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 40 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#333333" />
              <XAxis 
                dataKey={xAxisKey} 
                stroke="#6b7280" 
                fontSize={10} 
                tickFormatter={formatXAxis}
                angle={-45}
                textAnchor="end"
                height={60}
              />
              <YAxis stroke="#6b7280" fontSize={10} />
              <Tooltip {...tooltipStyle} />
              <Legend verticalAlign="top" height={36}/>
              {keys.map((key: string, idx: number) => (
                 <Line key={key} type="monotone" dataKey={key} stroke={COLORS[idx % COLORS.length]} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
              ))}
            </LineChart>
          ) : config.type === 'pie' ? (
             <PieChart margin={{ top: 0, left: 0, right: 20, bottom: 0 }}>
               <Pie
                data={chartData}
                dataKey={keys[0]} 
                nameKey={xAxisKey} 
                cx="30%" 
                cy="50%"
                outerRadius={65} 
                fill="#8884d8"
                label={renderCustomizedLabel}
                labelLine={true} 
               >
                 {chartData.map((entry: any, index: number) => (
                   <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                 ))}
               </Pie>
               <Tooltip {...tooltipStyle} />
               <Legend 
                  layout="vertical" 
                  verticalAlign="middle" 
                  align="right"
                  width={180}
                  wrapperStyle={{
                      right: 0, 
                      top: 10,
                      bottom: 10,
                      overflowY: 'auto', 
                      fontSize: '10px',
                      lineHeight: '20px',
                      maxHeight: '220px',
                      paddingLeft: '10px'
                  }}
               />
             </PieChart>
          ) : (
            <div className="flex items-center justify-center h-full text-gray-500">
              Tipo de gráfico no soportado: {config.type}
            </div>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
};

const DataTable: React.FC<{ data: any[] }> = ({ data }) => {
  if (!data || data.length === 0) return null;
  
  // Limitar columnas si son demasiadas para renderizado inicial, aunque el scroll ayuda
  const allHeaders = Object.keys(data[0]);
  const headers = allHeaders; 

  return (
    <div className="mt-4 w-full max-w-full overflow-hidden rounded-xl border border-[#333333] shadow-lg bg-[#0F0F0F]">
      <div className="bg-[#1A1A1A] px-4 py-3 border-b border-[#333333] flex items-center gap-2 sticky left-0">
         <div className="p-1.5 bg-blue-500/10 rounded-lg">
            <TableIcon size={16} className="text-blue-400"/>
         </div>
         <span className="text-xs font-bold text-gray-200 uppercase tracking-wide">Datos Tabulares</span>
      </div>
      
      {/* Contenedor con scroll horizontal */}
      <div className="overflow-x-auto custom-scrollbar">
        <table className="w-full text-left border-collapse">
          <thead className="bg-[#111111]">
            <tr>
              {headers.map((h, i) => (
                <th key={i} className="px-4 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-wider whitespace-nowrap border-b border-[#262626]">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#1F1F1F]">
            {data.map((row, idx) => (
              <tr key={idx} className="hover:bg-[#1A1A1A] transition-colors group">
                {headers.map((h, i) => (
                  <td key={i} className="px-4 py-2.5 text-xs text-gray-300 whitespace-nowrap border-r border-transparent group-hover:border-[#262626] last:border-r-0 max-w-[300px] truncate" title={String(row[h])}>
                    {row[h] === null ? <span className="text-gray-600 italic">null</span> : String(row[h])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-4 py-2 bg-[#111111] border-t border-[#333333] text-[10px] text-gray-500 text-right">
         {data.length} filas mostradas
      </div>
    </div>
  );
};

// --- Parsers ---

interface FormattedContentProps {
  content: string;
  datasets: Dataset[];
  hasAttachedChart?: boolean;
}

const FormattedContent: React.FC<FormattedContentProps> = ({ content, datasets, hasAttachedChart }) => {
  // Regex para encontrar bloques de código ```json ... ``` o solo ``` ... ```
  const parts = content.split(/(```[\w]*\n[\s\S]*?\n```)/g);

  return (
    <div className="space-y-3 font-sans">
      {parts.map((part, index) => {
        // Verificar si la parte es un bloque de código
        if (part.startsWith('```')) {
           const lines = part.split('\n');
           const language = lines[0].replace('```', '').trim().toLowerCase();
           // Remover primera y última línea (las backticks)
           const code = lines.slice(1, -1).join('\n');

           if (language === 'json' || language === '') {
             try {
                // Intentar parsear JSON
                const parsed = JSON.parse(code);
                
                // Caso 1: Array de datos -> Tabla
                // Detectamos si es un array simple de objetos (tabla de datos) que NO parece un gráfico
                if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object' && !parsed[0].type && !parsed[0].xAxisKey) {
                    return <DataTable key={index} data={parsed} />;
                }
                
                // Caso 2: Configuración de Gráfico (Array)
                if (parsed.chartData && Array.isArray(parsed.chartData)) {
                  // Si ya tenemos un gráfico adjunto funcional (vía Tool), NO renderizamos este bloque
                  if (hasAttachedChart) {
                    return null; 
                  }
                  return (
                    <div key={index}>
                      {parsed.chartData.map((config: any, idx: number) => (
                         <ChartRenderer key={idx} config={config} datasets={datasets} />
                      ))}
                    </div>
                  );
                }

                // Caso 3: Configuración de Gráfico Suelta (Objeto Único)
                // A veces el agente devuelve el objeto de configuración directamente
                if (!Array.isArray(parsed) && typeof parsed === 'object' && parsed.type && (parsed.xAxisKey || parsed.seriesKeys || parsed.data)) {
                    if (hasAttachedChart) return null;
                    return <ChartRenderer key={index} config={parsed} datasets={datasets} />;
                }

                // Otros JSON: Mostrar código formateado bonito
                return (
                    <div key={index} className="rounded-lg overflow-hidden border border-[#333333] bg-[#0F0F0F] my-2">
                        <div className="px-3 py-1 bg-[#1A1A1A] border-b border-[#333333] text-[10px] text-gray-400 font-mono">JSON</div>
                        <pre className="p-3 text-xs overflow-x-auto text-green-400 font-mono scrollbar-thin">{code}</pre>
                    </div>
                );

             } catch (e) {
                // Si falla el parseo, mostrar como código normal
                return (
                    <div key={index} className="rounded-lg overflow-hidden border border-[#333333] bg-[#0F0F0F] my-2">
                         <pre className="p-3 text-xs overflow-x-auto text-gray-300 font-mono">{code}</pre>
                    </div>
                );
             }
           }
           
           // Bloques de código de otros lenguajes (python, sql, etc)
           return (
            <div key={index} className="rounded-lg overflow-hidden border border-[#333333] bg-[#0F0F0F] my-2 shadow-sm">
                <div className="px-3 py-1 bg-[#1A1A1A] border-b border-[#333333] text-[10px] text-gray-400 uppercase font-bold font-mono flex justify-between">
                    <span>{language || 'CODE'}</span>
                </div>
                <pre className="p-3 text-xs overflow-x-auto text-blue-300 font-mono leading-relaxed custom-scrollbar">
                    {code}
                </pre>
            </div>
           );
        }

        // Texto normal con formato básico
        return (
          <div key={index} className="whitespace-pre-wrap leading-relaxed text-gray-200">
             {part.split('**').map((subPart, i) => 
               i % 2 === 1 ? <strong key={i} className="text-blue-300 font-semibold">{subPart}</strong> : subPart
             )}
          </div>
        );
      })}
    </div>
  );
};


const ChatInterface: React.FC<ChatInterfaceProps> = ({ messages, isThinking, datasets }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isThinking]);

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-8 custom-scrollbar" ref={scrollRef}>
      {messages.map((msg) => (
        <div 
          key={msg.id} 
          className={`flex gap-4 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
        >
          {msg.role !== 'user' && (
            <div className={`w-9 h-9 rounded-full overflow-hidden border-2 border-[#333333] shadow-lg flex-shrink-0 flex items-center justify-center ${msg.role === 'system' ? 'bg-[#252525]' : 'bg-[#1A1A1A]'}`}>
               {msg.role === 'system' ? (
                 <BrainCircuit size={18} className="text-gray-400" />
               ) : (
                 <div className="w-full h-full bg-[#1A1A1A]">
                    <img 
                      src={ANALY_AVATAR_URL} 
                      alt="Analy" 
                      className="h-full w-full object-cover" 
                    />
                 </div>
               )}
            </div>
          )}

          <div 
            className={`max-w-[90%] md:max-w-[85%] rounded-2xl p-5 shadow-md text-sm leading-relaxed ${
              msg.role === 'user' 
                ? 'bg-gradient-to-br from-blue-700 to-blue-800 text-white rounded-br-none border border-blue-600/50' 
                : msg.role === 'system'
                ? 'bg-[#151515] text-gray-400 border border-[#2A2A2A] font-mono text-xs py-3'
                : 'bg-[#1A1A1A] text-gray-100 border border-[#333333] rounded-bl-none shadow-xl'
            }`}
          >
            <FormattedContent 
              content={msg.content} 
              datasets={datasets} 
              hasAttachedChart={!!msg.chartData}
            />
            
            {msg.chartData && (
               <div className="mt-4 w-full animate-in fade-in duration-500">
                 {Array.isArray(msg.chartData) ? (
                    msg.chartData.map((cfg: any, idx: number) => (
                       <ChartRenderer key={idx} config={cfg} datasets={datasets} />
                    ))
                 ) : (
                    <ChartRenderer config={msg.chartData} datasets={datasets} />
                 )}
               </div>
            )}
          </div>

          {msg.role === 'user' && (
             <div className="w-9 h-9 rounded-full bg-blue-900/80 border border-blue-500/50 flex items-center justify-center flex-shrink-0 shadow-lg shadow-blue-900/20">
               <User size={18} className="text-blue-200" />
             </div>
          )}
        </div>
      ))}

      {isThinking && (
        <div className="flex gap-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="w-9 h-9 rounded-full overflow-hidden border-2 border-[#333333] flex-shrink-0 animate-pulse bg-[#1A1A1A]">
            <img 
              src={ANALY_AVATAR_URL} 
              alt="Analy" 
              className="h-full w-full object-cover opacity-60 grayscale" 
            />
          </div>
          <div className="bg-[#1A1A1A] border border-[#333333] rounded-2xl rounded-bl-none px-5 py-4 flex items-center gap-3 shadow-lg">
             <span className="text-xs text-gray-400 italic font-medium">Analy está pensando...</span>
             <div className="flex gap-1.5">
                <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
             </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChatInterface;
