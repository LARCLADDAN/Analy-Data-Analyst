
import React, { useState, useEffect, useRef } from 'react';
import { 
  Upload, 
  Send, 
  Settings, 
  Database, 
  FileSpreadsheet, 
  Trash2, 
  Download,
  Sparkles,
  Bot
} from 'lucide-react';
import { Message, Dataset, AnalysisType, ChartConfig } from './types';
import { MAX_DATASETS, SUGGESTED_ACTIONS, ANALY_AVATAR_URL, AI_MODELS, SOCRATA_TOKEN } from './constants';
import ChatInterface from './components/ChatInterface';
import SettingsModal from './components/SettingsModal';
import { parseCSV, parseXLSX } from './services/fileService';
import { initializeGemini, sendMessageToGemini } from './services/geminiService';
import { initializeOpenAI, sendMessageToOpenAI } from './services/openaiService';
import { searchCatalog, fetchDatasetData, getDatasetMetadata } from './services/socrataService';


  useEffect(() => {
    // Revisar local storage al montar
    const storedGemini = localStorage.getItem('ANALY_GEMINI_KEY');
    const storedOpenAI = localStorage.getItem('ANALY_OPENAI_KEY');
    const storedProvider = localStorage.getItem('ANALY_PROVIDER') as 'gemini' | 'openai';
    const storedModel = localStorage.getItem('ANALY_MODEL');

    // Inicializar keys. Socrata viene del env (SOCRATA_TOKEN), el resto de local storage
    const keys = {
        gemini: storedGemini || '',
        openai: storedOpenAI || '',
        socrata: SOCRATA_TOKEN 
    };
    setApiKeys(keys);

    if (storedProvider) {
      setActiveProvider(storedProvider);
      
      // Establecer modelo activo o fallback
      if (storedModel && AI_MODELS[storedProvider].some(m => m.id === storedModel)) {
        setActiveModel(storedModel);
      } else {
        setActiveModel(AI_MODELS[storedProvider][0].id);
      }
    } else {
      // Default a Gemini y su primer modelo
      setActiveModel(AI_MODELS.gemini[0].id);
    }

    if (storedGemini) initializeGemini(storedGemini);
    if (storedOpenAI) initializeOpenAI(storedOpenAI);

    // Cerrar modal solo si hay una llave válida para el proveedor activo
    if ((storedProvider === 'gemini' && storedGemini) || (storedProvider === 'openai' && storedOpenAI)) {
        setIsSettingsOpen(false);
    }
  }, []);

  // Sincronizar ref con estado cuando cambia el estado (por acciones de UI externas)
  useEffect(() => {
    datasetsRef.current = datasets;
  }, [datasets]);

  // --- Manejadores ---

  const handleSettingsSave = (geminiKey: string, openaiKey: string, provider: 'gemini' | 'openai', model: string) => {
    setApiKeys(prev => ({ ...prev, gemini: geminiKey, openai: openaiKey }));
    setActiveProvider(provider);
    setActiveModel(model);
    
    if (geminiKey) initializeGemini(geminiKey);
    if (openaiKey) initializeOpenAI(openaiKey);
  };

  const handleSendMessage = async () => {
    if (!input.trim()) return;
    
    // Validación de Key según proveedor
    if (activeProvider === 'gemini' && !apiKeys.gemini) {
        setIsSettingsOpen(true);
        alert("Por favor configura tu API Key de Gemini.");
        return;
    }
    if (activeProvider === 'openai' && !apiKeys.openai) {
        setIsSettingsOpen(true);
        alert("Por favor configura tu API Key de OpenAI.");
        return;
    }

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsThinking(true);

    try {
      // Usar Ref para el contexto más actual
      const currentDatasets = datasetsRef.current;
      const datasetContext = currentDatasets.map(d => 
        `Dataset Activo [${d.id}]: "${d.name}" (${d.source}). Columnas: ${d.columns.join(', ')}. Filas: ${d.rowCount}.`
      ).join('\n');

      const fullPrompt = `${datasetContext}\n\nConsulta de Usuario: ${userMsg.content}`;

      // Definir implementaciones de herramientas para pasar al servicio
      const toolsImpl = {
        searchCatalog: async (q: string) => {
           setMessages(prev => [...prev, { id: Date.now().toString() + 'sys', role: 'system', content: `🔍 Buscando en catálogo: "${q}"...`, timestamp: new Date() }]);
           return await searchCatalog(q);
        },
        getDatasetMetadata: async (id: string) => {
           setMessages(prev => [...prev, { id: Date.now().toString() + 'sys', role: 'system', content: `ℹ️ Consultando metadatos de ${id}...`, timestamp: new Date() }]);
           return await getDatasetMetadata(id);
        },
        fetchDataset: async (id: string, preview_rows?: number, where?: string, select?: string, order?: string, limit?: number) => {
           if (datasetsRef.current.length >= MAX_DATASETS) throw new Error("Máximo de datasets alcanzado. Por favor elimina uno.");
           
           const filterMsg = where ? ` (Filtrado: ${where})` : '';
           setMessages(prev => [...prev, { id: Date.now().toString() + 'sys', role: 'system', content: `⬇️ Descargando dataset ${id}${filterMsg}...`, timestamp: new Date() }]);
           
           // Por defecto descargará 5000 filas (o lo que diga limit)
           const actualLimit = limit || 10000;
           const data = await fetchDatasetData(id, apiKeys.socrata, actualLimit, 0, where, select, order);
           
           if (data.length === 0) {
               throw new Error("La consulta no devolvió resultados. Verifica tus filtros.");
           }

           // Registrar dataset
           const newDataset: Dataset = {
             id,
             name: id,
             source: 'socrata',
             data,
             columns: data.length > 0 ? Object.keys(data[0]) : [],
             rowCount: data.length
           };
           
           // Actualizar Ref INMEDIATAMENTE para que la siguiente herramienta lo vea
           datasetsRef.current = [...datasetsRef.current, newDataset];
           // Actualizar Estado para la UI
           setDatasets(prev => [...prev, newDataset]);
           
           return newDataset;
        },
        getDatasetStats: async (dataset_id: string) => {
           // Usar datasetsRef para buscar, asegurando que encontramos datasets recién agregados
           const currentDs = datasetsRef.current;
           const ds = currentDs.find(d => d.id === dataset_id || d.name === dataset_id) 
                      || currentDs[currentDs.length - 1]; 
           
           if (!ds) {
              // Devolver objeto de error en lugar de throw para que el modelo pueda manejarlo elegantemente
              return { error: `Dataset no encontrado: ${dataset_id}. Datasets disponibles: ${currentDs.map(d => d.id).join(', ')}` };
           }

           setMessages(prev => [...prev, { id: Date.now().toString() + 'sys', role: 'system', content: `📊 Calculando estadísticas para ${ds.name}...`, timestamp: new Date() }]);

           const stats: any = { columns: {} };
           
           ds.columns.forEach(col => {
              let nullCount = 0;
              let emptyCount = 0;
              let numericValues: number[] = [];
              let types = new Set<string>();

              ds.data.forEach(row => {
                 const val = row[col];
                 if (val === null || val === undefined) {
                     nullCount++;
                 } else if (String(val).trim() === '') {
                     emptyCount++;
                 } else {
                     types.add(typeof val);
                     const num = Number(val);
                     if (!isNaN(num) && val !== '') {
                         numericValues.push(num);
                     }
                 }
              });

              const colStat: any = {
                  nulls: nullCount,
                  empty: emptyCount,
                  inferredType: types.size === 1 ? Array.from(types)[0] : 'mixed',
                  uniqueCount: new Set(ds.data.map(r => r[col])).size
              };

              stats.columns[col] = colStat;
           });
           
           return stats;
        },
        analyzeColumn: async (dataset_id: string, column_name: string, analysis_type: string) => {
            const currentDs = datasetsRef.current;
            const ds = currentDs.find(d => d.id === dataset_id || d.name === dataset_id) || currentDs[currentDs.length - 1];
            if (!ds) throw new Error("Dataset no encontrado");
            
            if (!ds.columns.includes(column_name)) throw new Error(`Columna ${column_name} no encontrada. Columnas: ${ds.columns.join(', ')}`);

            setMessages(prev => [...prev, { id: Date.now().toString() + 'sys', role: 'system', content: `🧮 Analizando columna '${column_name}' (${analysis_type})...`, timestamp: new Date() }]);

            const values = ds.data.map(r => r[column_name]);

            if (analysis_type === 'frequency') {
                const counts: Record<string, number> = {};
                values.forEach(v => {
                    const key = (v === null || v === undefined) ? "Nulo" : String(v);
                    counts[key] = (counts[key] || 0) + 1;
                });
                // Ordenar por frecuencia descendente y tomar top 20
                const sorted = Object.entries(counts)
                    .sort(([,a], [,b]) => b - a)
                    .slice(0, 20)
                    .map(([label, value]) => ({ label, value }));
                
                return { type: 'frequency', data: sorted, total_categories: Object.keys(counts).length };
            } 
            else if (analysis_type === 'numeric_stats') {
                const nums = values.map(v => Number(v)).filter(n => !isNaN(n));
                if (nums.length === 0) return { error: "No hay valores numéricos en esta columna" };
                
                const sum = nums.reduce((a,b) => a+b, 0);
                const mean = sum / nums.length;
                const min = Math.min(...nums);
                const max = Math.max(...nums);
                
                return { type: 'numeric_stats', count: nums.length, sum, mean, min, max };
            }
            return { error: "Tipo de análisis no soportado" };
        },
        queryDataset: async (dataset_id: string, columns: string[], sort_by?: string, order: 'asc'|'desc' = 'desc', limit: number = 10) => {
             const currentDs = datasetsRef.current;
             const ds = currentDs.find(d => d.id === dataset_id || d.name === dataset_id) || currentDs[currentDs.length - 1];
             if (!ds) throw new Error("Dataset no encontrado");
             
             setMessages(prev => [...prev, { id: Date.now().toString() + 'sys', role: 'system', content: `🔍 Consultando datos (Top/Ranking/Filtro)...`, timestamp: new Date() }]);

             let result = [...ds.data];
             
             // 1. Sort
             if (sort_by) {
                 result.sort((a, b) => {
                     let valA = a[sort_by];
                     let valB = b[sort_by];
                     
                     // Intentar conversión numérica para ordenamiento correcto
                     const numA = Number(valA);
                     const numB = Number(valB);
                     
                     if (!isNaN(numA) && !isNaN(numB) && valA !== '' && valB !== '') {
                         valA = numA;
                         valB = numB;
                     }
                     
                     if (valA < valB) return order === 'asc' ? -1 : 1;
                     if (valA > valB) return order === 'asc' ? 1 : -1;
                     return 0;
                 });
             }
             
             // 2. Select Columns & Limit
             const limited = result.slice(0, limit).map(row => {
                 const newRow: any = {};
                 columns.forEach(col => newRow[col] = row[col]);
                 return newRow;
             });
             
             return limited;
        },
        cleanDataset: async (dataset_id: string, action: string, columns?: string[], fillValue?: string) => {
            const currentDs = datasetsRef.current;
            const dsIndex = currentDs.findIndex(d => d.id === dataset_id || d.name === dataset_id);
            
            if (dsIndex === -1) {
                if (currentDs.length > 0) return await toolsImpl.cleanDataset(currentDs[currentDs.length-1].id, action, columns, fillValue);
                throw new Error("Dataset no encontrado para limpieza");
            }
            const ds = currentDs[dsIndex];
            
            setMessages(prev => [...prev, { id: Date.now().toString() + 'sys', role: 'system', content: `🧹 Limpiando datos (${action}) en ${ds.name}...`, timestamp: new Date() }]);

            let newData = [...ds.data];
            const targetCols = (columns && columns.length > 0) ? columns : ds.columns;

            if (action === 'drop_na') {
                newData = newData.filter(row => {
                    return targetCols.every(col => {
                        const val = row[col];
                        return val !== null && val !== undefined && String(val).trim() !== '';
                    });
                });
            } else if (action === 'fill_mean') {
                targetCols.forEach(col => {
                    const nums = newData.map(r => Number(r[col])).filter(n => !isNaN(n));
                    const mean = nums.length ? nums.reduce((a,b)=>a+b,0)/nums.length : 0;
                    
                    newData.forEach(row => {
                        const val = row[col];
                        if (val === null || val === undefined || String(val).trim() === '' || isNaN(Number(val))) {
                            row[col] = parseFloat(mean.toFixed(2));
                        }
                    });
                });
            } else if (action === 'fill_zero') {
                targetCols.forEach(col => {
                    newData.forEach(row => {
                        const val = row[col];
                        if (val === null || val === undefined || String(val).trim() === '') {
                            row[col] = 0;
                        }
                    });
                });
            } else if (action === 'fill_value') {
                 targetCols.forEach(col => {
                    newData.forEach(row => {
                        const val = row[col];
                        if (val === null || val === undefined || String(val).trim() === '') {
                            row[col] = fillValue || "Desconocido";
                        }
                    });
                });
            }

            const updatedDs = { ...ds, data: newData, rowCount: newData.length };
            
            const newDsList = [...datasetsRef.current];
            newDsList[dsIndex] = updatedDs;
            datasetsRef.current = newDsList;

            setDatasets(prev => {
                const newArr = [...prev];
                const idx = newArr.findIndex(d => d.id === ds.id);
                if (idx !== -1) newArr[idx] = updatedDs;
                return newArr;
            });

            return { status: "éxito", initialRows: ds.rowCount, finalRows: newData.length, action };
        }
      };

      let response;
      
      // SWITCH DE PROVEEDOR
      if (activeProvider === 'gemini') {
         response = await sendMessageToGemini(
            messages.map(m => ({ role: m.role === 'system' ? 'model' : m.role, parts: [{ text: m.content }] })),
            fullPrompt,
            toolsImpl,
            activeModel // Pasar modelo seleccionado
         );
      } else {
         response = await sendMessageToOpenAI(
            messages,
            fullPrompt,
            toolsImpl,
            activeModel // Pasar modelo seleccionado
         );
      }

      // Si la configuración del gráfico es devuelta vía Function Call
      let finalChartConfig = response.chartConfig;
      
      // Fallback inteligente (igual para ambos modelos)
      if (finalChartConfig && datasetsRef.current.length > 0) {
        if (!finalChartConfig.data || finalChartConfig.data.length === 0) {
             const targetDataset = datasetsRef.current[datasetsRef.current.length - 1];
             if (targetDataset) {
                 finalChartConfig.data = targetDataset.data.slice(0, 50); 
             }
        }
      }

      // Evitar burbujas vacías
      let contentToDisplay = response.text;
      if (!contentToDisplay && !finalChartConfig) {
          contentToDisplay = "He completado la operación solicitada.";
      }

      

      setMessages(prev => [...prev, botMsg]);

    } catch (error: any) {
      console.error(error);
      const errorMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'model',
        content: `Error: ${error.message || "Algo salió mal."}`,
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      // Retrasar ligeramente para asegurar que la UI se actualice y no haya parpadeo
      setTimeout(() => {
        setIsThinking(false);
      }, 100);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (datasets.length >= MAX_DATASETS) {
      alert("Máximo de datasets alcanzado (3). Por favor elimina uno.");
      return;
    }
    
    const file = e.target.files?.[0];
    if (!file) return;

    // Validación de Tamaño (10MB)
    const MAX_FILE_SIZE_MB = 10;
    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
        alert(`El archivo es demasiado grande. El límite es de ${MAX_FILE_SIZE_MB}MB para evitar problemas de rendimiento en el navegador.`);
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
    }

    setIsThinking(true);
    try {
      let data: any[] = [];
      if (file.name.endsWith('.csv')) {
        data = await parseCSV(file);
      } else if (file.name.match(/\.xlsx?$/)) {
        data = await parseXLSX(file);
      } else {
        alert("Tipo de archivo no soportado");
        setIsThinking(false);
        return;
      }

      const newDataset: Dataset = {
        id: file.name,
        name: file.name,
        source: 'file',
        data,
        columns: data.length > 0 ? Object.keys(data[0]) : [],
        rowCount: data.length
      };

      // Actualizar Ref y Estado
      datasetsRef.current = [...datasetsRef.current, newDataset];
      setDatasets(prev => [...prev, newDataset]);
      
      const msg: Message = {
        id: Date.now().toString(),
        role: 'system',
        content: `📂 Subido ${file.name} exitosamente (${data.length} filas procesadas).`,
        timestamp: new Date()
      };
      setMessages(prev => [...prev, msg]);

    } catch (err) {
      console.error(err);
      alert("Error analizando el archivo");
    } finally {
      setIsThinking(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removeDataset = (id: string) => {
    const updated = datasets.filter(d => d.id !== id);
    datasetsRef.current = updated; // Update ref immediately
    setDatasets(updated);
    
    setMessages(prev => [...prev, {
      id: Date.now().toString(),
      role: 'system',
      content: `🗑️ Dataset ${id} eliminado`,
      timestamp: new Date()
    }]);
  };

  const generateReport = () => {
    const reportText = messages.map(m => `[${m.role.toUpperCase()}] ${m.timestamp.toLocaleTimeString()}: ${m.content}`).join('\n\n');
    const blob = new Blob([reportText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Reporte_Analy.txt';
    a.click();
  };

  return (
    <div className="flex h-screen bg-[#0D0D0D] text-gray-200 overflow-hidden font-sans">
      <SettingsModal 
        isOpen={isSettingsOpen} 
        onClose={() => setIsSettingsOpen(false)} 
        onSave={handleSettingsSave} 
      />

      {/* Contenido Principal */}
      <div className="flex-1 flex flex-col relative max-w-6xl mx-auto w-full shadow-2xl bg-[#0D0D0D]">
        
        {/* Encabezado */}
        <header className="h-16 border-b border-[#1F1F1F] flex items-center justify-between px-6 bg-[#1A1A1A] shadow-md z-10">
          <div className="flex items-center gap-3">
             <div className="h-10 w-10 bg-[#111111] p-1 rounded-full border border-[#333333] overflow-hidden">
                <img 
                  src={ANALY_AVATAR_URL} 
                  alt="Analy" 
                  className="h-full w-full object-cover" 
                />
             </div>
             <div>
               <h1 className="text-xl font-bold tracking-tight text-white">Analy</h1>
               <p className="text-xs text-gray-400">
                 Analista de Datos - <a href="https://www.datos.gov.co" target="_blank" rel="noopener noreferrer" className="hover:text-blue-400 transition-colors underline decoration-blue-500/30">www.datos.gov.co</a>
               </p>
             </div>
          </div>
          <div className="flex items-center gap-4">
             <div className="hidden md:flex items-center gap-2 px-3 py-1 bg-[#111111] border border-[#333333] rounded-full text-xs text-gray-400">
                {activeProvider === 'gemini' ? <Sparkles size={12} className="text-blue-500"/> : <Bot size={12} className="text-green-500"/>}
                <span className="capitalize">{activeProvider}</span>
                <span className="text-gray-600">|</span>
                <span className="text-[10px] text-gray-500 truncate max-w-[80px]" title={activeModel}>{activeModel}</span>
             </div>
             <button 
                onClick={generateReport}
                className="text-gray-400 hover:text-white transition" 
                title="Descargar Reporte">
               <Download size={20} />
             </button>
             <button 
                onClick={() => setIsSettingsOpen(true)}
                className="text-gray-400 hover:text-white transition" 
                title="Configuración API">
               <Settings size={20} />
             </button>
          </div>
        </header>

        {/* Barra de Datasets (si hay alguno) */}
        {datasets.length > 0 && (
          <div className="bg-[#111111] px-6 py-2 border-b border-[#1F1F1F] flex gap-2 overflow-x-auto items-center">
            <span className="text-xs font-semibold text-gray-500 uppercase mr-2">Fuentes:</span>
            {datasets.map(ds => (
              <div key={ds.id} className="flex items-center gap-2 bg-[#1F1F1F] rounded-full px-3 py-1 text-xs border border-[#333333] text-gray-300">
                {ds.source === 'file' ? <FileSpreadsheet size={12} className="text-emerald-400"/> : <Database size={12} className="text-blue-400"/>}
                <span className="truncate max-w-[100px]">{ds.name}</span>
                <button onClick={() => removeDataset(ds.id)} className="text-gray-400 hover:text-red-400 ml-1">
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
            <span className="text-xs text-gray-600 ml-auto">{datasets.length}/{MAX_DATASETS}</span>
          </div>
        )}

        {/* Arrastrar y Soltar / Estado Vacío o Chat */}
        {messages.length === 1 && datasets.length === 0 ? (
           <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-6 bg-[#0D0D0D]">
              <div 
                className="border-2 border-dashed border-[#333333] rounded-2xl p-12 w-full max-w-2xl flex flex-col items-center justify-center bg-[#1A1A1A]/50 hover:bg-[#1A1A1A] transition cursor-pointer group"
                onClick={() => fileInputRef.current?.click()}
              >
                  <Upload size={48} className="text-gray-600 group-hover:text-blue-400 mb-4 transition" />
                  <h3 className="text-lg font-medium text-gray-200">Arrastra y suelta tus archivos aquí</h3>
                  <p className="text-gray-500 text-sm mt-2">o haz clic para seleccionar archivos (CSV, XLSX)</p>
                  <p className="text-gray-600 text-xs mt-1">Soportado: .csv, .xlsx</p>
                  <p className="text-gray-500 text-xs mt-2 font-medium">Tamaño máximo por archivo: 10MB</p>
              </div>
              <p className="text-gray-500 text-sm">O comienza a chatear abajo para conectar con Datos Abiertos.</p>
           </div>
        ) : (
          <ChatInterface messages={messages} isThinking={isThinking} datasets={datasets} />
        )}

        {/* Píldoras de Acción */}
        <div className="px-6 pb-2 pt-2 bg-[#0D0D0D]">
           <div className="flex gap-2 overflow-x-auto no-scrollbar">
              {SUGGESTED_ACTIONS.map(action => (
                <button 
                  key={action}
                  onClick={() => setInput(`Por favor realiza ${action} en los datos actuales.`)}
                  className="whitespace-nowrap px-3 py-1 rounded-full bg-[#1A1A1A] border border-[#333333] text-xs text-blue-400 hover:bg-[#252525] hover:border-blue-500 transition"
                >
                  {action}
                </button>
              ))}
           </div>
        </div>

        {/* Área de Entrada */}
        <div className="p-6 pt-2 bg-[#0D0D0D] border-t border-[#1F1F1F]">
          <div className="relative flex items-center bg-[#1A1A1A] rounded-xl border border-[#333333] shadow-lg focus-within:ring-1 focus-within:ring-blue-500/50 transition">
             
             {/* Disparador de Archivo */}
             <button 
               onClick={() => fileInputRef.current?.click()}
               className="p-3 text-gray-400 hover:text-white transition border-r border-[#333333]"
               title="Subir Archivo"
             >
               <Upload size={20} />
             </button>
             <input 
               type="file" 
               ref={fileInputRef} 
               onChange={handleFileUpload} 
               className="hidden" 
               accept=".csv,.xlsx,.xls"
             />

             {/* Entrada de Texto */}
             <input
               type="text"
               value={input}
               onChange={(e) => setInput(e.target.value)}
               onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
               placeholder="Haz una pregunta o solicita un análisis..."
               className="flex-1 bg-transparent border-none text-white px-4 py-3 outline-none placeholder-gray-500"
               disabled={isThinking}
             />

             {/* Botón Enviar */}
             <button 
               onClick={handleSendMessage}
               disabled={!input.trim() || isThinking}
               className={`p-2 m-1 rounded-lg transition ${
                 input.trim() && !isThinking
                   ? 'bg-blue-700 text-white hover:bg-blue-600' 
                   : 'bg-[#252525] text-gray-600 cursor-not-allowed'
               }`}
             >
               <Send size={18} />
             </button>
          </div>
          <div className="text-center mt-2 text-[10px] text-gray-600 uppercase tracking-widest">
             Powered by LARC LADDAN
          </div>
        </div>

      </div>
    </div>
  );
}
