
import React, { useState, useEffect } from 'react';
import { X, Key, Bot, Sparkles, Cpu } from 'lucide-react';
import { AI_MODELS } from '../constants';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (geminiKey: string, openaiKey: string, provider: 'gemini' | 'openai', model: string) => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, onSave }) => {
  const [geminiKey, setGeminiKey] = useState('');
  const [openaiKey, setOpenaiKey] = useState('');
  const [provider, setProvider] = useState<'gemini' | 'openai'>('gemini');
  const [selectedModel, setSelectedModel] = useState('');

  useEffect(() => {
    const storedGemini = localStorage.getItem('ANALY_GEMINI_KEY');
    const storedOpenAI = localStorage.getItem('ANALY_OPENAI_KEY');
    const storedProvider = localStorage.getItem('ANALY_PROVIDER');
    const storedModel = localStorage.getItem('ANALY_MODEL');

    if (storedGemini) setGeminiKey(storedGemini);
    if (storedOpenAI) setOpenaiKey(storedOpenAI);
    
    const initialProvider = (storedProvider === 'gemini' || storedProvider === 'openai') ? storedProvider : 'gemini';
    setProvider(initialProvider);

    // Establecer modelo inicial o fallback al primero de la lista del proveedor
    if (storedModel && AI_MODELS[initialProvider].some(m => m.id === storedModel)) {
      setSelectedModel(storedModel);
    } else {
      setSelectedModel(AI_MODELS[initialProvider][0].id);
    }
  }, [isOpen]);

  // Actualizar modelo cuando cambia el proveedor si el modelo actual no pertenece a la lista
  useEffect(() => {
    const models = AI_MODELS[provider];
    if (!models.some(m => m.id === selectedModel)) {
      setSelectedModel(models[0].id);
    }
  }, [provider]);

  const handleSave = () => {
    if (provider === 'gemini' && !geminiKey) {
      alert("La clave API de Gemini es obligatoria si seleccionas Gemini.");
      return;
    }
    if (provider === 'openai' && !openaiKey) {
        alert("La clave API de OpenAI es obligatoria si seleccionas OpenAI.");
        return;
    }

    localStorage.setItem('ANALY_GEMINI_KEY', geminiKey);
    localStorage.setItem('ANALY_OPENAI_KEY', openaiKey);
    localStorage.setItem('ANALY_PROVIDER', provider);
    localStorage.setItem('ANALY_MODEL', selectedModel);
    
    onSave(geminiKey, openaiKey, provider, selectedModel);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="bg-[#1A1A1A] border border-[#333333] rounded-xl shadow-2xl w-full max-w-md p-6">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Key size={20} className="text-blue-500"/> Configuración
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition">
            <X size={24} />
          </button>
        </div>

        <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-2">
          
          {/* Selector de Proveedor */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Seleccionar Proveedor IA
            </label>
            <div className="grid grid-cols-2 gap-3">
                <button 
                  onClick={() => setProvider('gemini')}
                  className={`flex flex-col items-center p-3 rounded-lg border transition ${provider === 'gemini' ? 'bg-blue-900/30 border-blue-500 text-blue-200' : 'bg-[#0D0D0D] border-[#333333] text-gray-400 hover:bg-[#252525]'}`}
                >
                    <Sparkles size={24} className="mb-1" />
                    <span className="text-xs font-semibold">Google Gemini</span>
                </button>
                <button 
                  onClick={() => setProvider('openai')}
                  className={`flex flex-col items-center p-3 rounded-lg border transition ${provider === 'openai' ? 'bg-green-900/30 border-green-500 text-green-200' : 'bg-[#0D0D0D] border-[#333333] text-gray-400 hover:bg-[#252525]'}`}
                >
                    <Bot size={24} className="mb-1" />
                    <span className="text-xs font-semibold">OpenAI</span>
                </button>
            </div>
          </div>

        
          <div className="border-t border-[#333333] my-4"></div>

          {provider === 'gemini' && (
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Clave API Google Gemini
              </label>
              <input 
                type="password" 
                value={geminiKey}
                onChange={(e) => setGeminiKey(e.target.value)}
                placeholder="AIzaSy..."
                className="w-full bg-[#0D0D0D] border border-[#333333] rounded-lg px-4 py-2 text-white focus:ring-1 focus:ring-blue-500 outline-none"
              />
            </div>
          )}

          {provider === 'openai' && (
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Clave API OpenAI
              </label>
              <input 
                type="password" 
                value={openaiKey}
                onChange={(e) => setOpenaiKey(e.target.value)}
                placeholder="sk-..."
                className="w-full bg-[#0D0D0D] border border-[#333333] rounded-lg px-4 py-2 text-white focus:ring-1 focus:ring-green-500 outline-none"
              />
            </div>
          )}
        </div>

        <div className="mt-8 flex justify-end gap-3">
          <button 
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-gray-400 hover:bg-[#252525] transition"
          >
            Cancelar
          </button>
          <button 
            onClick={handleSave}
            className="px-4 py-2 rounded-lg bg-blue-700 text-white font-medium hover:bg-blue-600 transition"
          >
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
