
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { GroupedDocument, ProcessingProgress, BallotData, ApiSettings } from '../types';
import { DocumentController } from '../backend/processor';
import { PDFProcessor } from '../backend/pdf';

export const App: React.FC = () => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<ProcessingProgress>({ current: 0, total: 0, status: '' });
  const [groupedDocs, setGroupedDocs] = useState<GroupedDocument[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [verifyingDocId, setVerifyingDocId] = useState<string | null>(null);
  const [isApiModalOpen, setIsApiModalOpen] = useState(false);
  const [apiSettings, setApiSettings] = useState<ApiSettings>(() => {
    const saved = localStorage.getItem('ig_api_settings');
    return saved ? JSON.parse(saved) : { provider: 'google', model: 'gemini-3-flash-preview' };
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const startFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    localStorage.setItem('ig_api_settings', JSON.stringify(apiSettings));
  }, [apiSettings]);

  const addLog = (msg: string) => setLogs(p => [msg, ...p].slice(0, 30));

  const mergeDataInternal = (target: Partial<BallotData>, source: Partial<BallotData>): Partial<BallotData> => {
    const result = { ...target };
    const fields: (keyof BallotData)[] = ['address', 'lastName', 'firstName', 'middleName', 'snils', 'roomNo', 'area', 'ownershipShare', 'regNumber', 'regDate', 'meetingDate'];
    fields.forEach(f => {
      if (!result[f] || (result[f] === 'ОШИБКА' && source[f] && source[f] !== 'ОШИБКА')) {
        result[f] = source[f] as any;
      }
    });
    result.votes = { ...(result.votes || {}), ...(source.votes || {}) };
    result.questionTexts = { ...(result.questionTexts || {}) };
    if (source.questionTexts) {
      for (const [q, text] of Object.entries(source.questionTexts)) {
        if (text && (!result.questionTexts[q] || text.length > result.questionTexts[q].length)) {
          result.questionTexts[q] = text;
        }
      }
    }
    return result;
  };

  const onFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    if (!files.length) return;

    // Check if key is selected for Google provider
    // @ts-ignore
    if (apiSettings.provider === 'google' && !(await window.aistudio.hasSelectedApiKey())) {
      // @ts-ignore
      await window.aistudio.openSelectKey();
      // Proceed immediately as per race condition rules
    }

    setIsProcessing(true);
    const controller = new DocumentController();
    try {
      const newResults = await controller.processFiles(files, apiSettings, setProgress, addLog);
      
      setGroupedDocs(prev => {
        const updatedDocs = [...prev];
        newResults.forEach(newDoc => {
          const existingIdx = updatedDocs.findIndex(d => {
            if (newDoc.data.snils && d.data.snils && newDoc.data.snils === d.data.snils) return true;
            const newName = `${newDoc.data.lastName || ''} ${newDoc.data.firstName || ''} ${newDoc.data.middleName || ''}`.trim();
            const oldName = `${d.data.lastName || ''} ${d.data.firstName || ''} ${d.data.middleName || ''}`.trim();
            if (newName && oldName && newName === oldName) return true;
            return false;
          });

          if (existingIdx !== -1) {
            const existing = updatedDocs[existingIdx];
            updatedDocs[existingIdx] = {
              ...existing,
              pages: [...existing.pages, ...newDoc.pages],
              data: mergeDataInternal(existing.data, newDoc.data)
            };
            addLog(`🔄 Добавлено в карточку: ${newDoc.name}`);
          } else {
            updatedDocs.push(newDoc);
          }
        });
        return updatedDocs;
      });
    } catch (err: any) { 
      if (err.message === "API_KEY_EXPIRED") {
        // @ts-ignore
        await window.aistudio.openSelectKey();
      }
      addLog(`❌ Ошибка: ${err.message || err}`); 
    } finally { 
      setIsProcessing(false); 
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (startFileInputRef.current) startFileInputRef.current.value = '';
    }
  };

  const deleteDoc = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirm('Вы уверены, что хотите удалить этот документ?')) {
      setGroupedDocs(prev => prev.filter(d => d.id !== id));
      addLog(`🗑️ Документ удален`);
    }
  };

  const exportToExcel = () => {
    const headers = ["Статус", "Адрес", "Фамилия", "Имя", "Отчество", "СНИЛС", "№ Помещения", "Площадь", "Доля", "№ Рег.", "Дата Рег.", "Дата Собрания", "Вопрос 1", "Вопрос 2", "Вопрос 3", "Вопрос 4"];
    const rows = groupedDocs.map(d => [
      d.isVerified ? "Проверено" : "Черновик",
      d.data.address || "",
      d.data.lastName || "ОШИБКА",
      d.data.firstName || "ОШИБКА",
      d.data.middleName || "ОШИБКА",
      d.data.snils || "ОШИБКА",
      d.data.roomNo || "",
      d.data.area || "",
      d.data.ownershipShare || "",
      d.data.regNumber || "",
      d.data.regDate || "",
      d.data.meetingDate || "",
      d.data.votes?.["1"] || "",
      d.data.votes?.["2"] || "",
      d.data.votes?.["3"] || "",
      d.data.votes?.["4"] || ""
    ]);

    const csvContent = "data:text/csv;charset=utf-8," 
      + [headers, ...rows].map(e => e.join(";")).join("\n");
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `reestr_golosovaniya_${new Date().toLocaleDateString()}.csv`);
    document.body.appendChild(link);
    link.click();
    addLog("📊 Реестр выгружен в CSV");
  };

  const activeDoc = useMemo(() => groupedDocs.find(d => d.id === verifyingDocId), [groupedDocs, verifyingDocId]);

  const updateData = (field: keyof BallotData, value: string) => {
    setGroupedDocs(prev => prev.map(d => d.id === verifyingDocId ? { ...d, data: { ...d.data, [field]: value } } : d));
  };

  const updateNestedData = (category: 'votes' | 'questionTexts', key: string, value: string) => {
    setGroupedDocs(prev => prev.map(d => d.id === verifyingDocId ? { 
      ...d, 
      data: { 
        ...d.data, 
        [category]: { ...(d.data[category] || {}), [key]: value } 
      } 
    } : d));
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] font-sans text-slate-900 select-none">
      <div className="max-w-full mx-auto p-6 space-y-6">
        
        {/* Header */}
        <header className="flex items-center justify-between bg-white p-6 rounded-[32px] border border-slate-200 shadow-sm">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center text-white font-black text-xl shadow-lg shadow-indigo-100">IG</div>
              <div>
                <h1 className="text-xl font-black text-slate-800 tracking-tight">IntelliGroup Desktop</h1>
                <p className="text-xs font-bold text-slate-400">Система разбора бюллетеней ЖКХ</p>
              </div>
            </div>

            <div className="flex items-center border-l border-slate-200 pl-6 gap-3">
              {/* API Button - Unified settings button */}
              <button 
                onClick={() => setIsApiModalOpen(true)}
                className="p-3 border-2 border-slate-100 text-slate-400 hover:text-slate-600 hover:border-slate-200 rounded-2xl transition-all flex items-center gap-2 font-black text-xs tracking-tighter"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                </svg>
                API
              </button>
            </div>
          </div>
          
          <div className="flex gap-3">
            {groupedDocs.length > 0 && (
              <>
                <button onClick={exportToExcel} className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold flex items-center gap-2 transition-all shadow-lg shadow-emerald-100">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" strokeWidth="2" /></svg>
                  Экспорт
                </button>
                <button onClick={() => groupedDocs.forEach(PDFProcessor.generateAndSave)} className="px-6 py-2.5 bg-slate-900 text-white rounded-xl font-bold hover:bg-black transition-all">
                  PDF ({groupedDocs.length})
                </button>
              </>
            )}
          </div>
          <input type="file" ref={fileInputRef} multiple onChange={onFilesSelected} className="hidden" />
        </header>

        {/* Start Screen */}
        {!isProcessing && groupedDocs.length === 0 && (
          <div className="flex flex-col items-center justify-center h-[70vh] bg-white rounded-[64px] border-2 border-dashed border-slate-100 shadow-[0_20px_50px_rgba(0,0,0,0.02)]">
             <div className="w-40 h-40 bg-indigo-50 text-indigo-500 rounded-[48px] flex items-center justify-center mb-8 rotate-3 shadow-inner">
                <svg className="w-20 h-20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
             </div>
             <h2 className="text-3xl font-black text-slate-800 tracking-tight">Начните работу с файлами</h2>
             <p className="text-slate-400 mt-3 font-medium text-lg">Перетащите сканы или выберите PDF с бюллетенями</p>
             
             <div className="mt-12 relative group">
                <input type="file" ref={startFileInputRef} multiple onChange={onFilesSelected} className="hidden" />
                <button 
                  onClick={() => startFileInputRef.current?.click()}
                  className="px-10 py-5 bg-gradient-to-r from-indigo-600 to-violet-600 text-white rounded-3xl font-black text-lg flex items-center gap-4 shadow-[0_15px_30px_-5px_rgba(79,70,229,0.3)] hover:shadow-[0_20px_40px_-5px_rgba(79,70,229,0.4)] hover:-translate-y-1 active:translate-y-0 transition-all duration-300"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M12 4v16m8-8H4" />
                  </svg>
                  Выбрать файлы
                </button>
             </div>
             <p className="mt-6 text-xs font-bold text-slate-300 uppercase tracking-widest">Поддерживаются PDF, JPG, PNG</p>
          </div>
        )}

        {/* Processing State */}
        {isProcessing && (
           <div className="bg-white p-12 rounded-[48px] shadow-sm border border-slate-200 flex flex-col items-center">
              <div className="w-20 h-20 border-8 border-indigo-600 border-t-transparent rounded-full animate-spin mb-8"></div>
              <h3 className="text-3xl font-black text-slate-800">{progress.status}</h3>
              <p className="text-slate-500 font-bold mt-2">Обработка {progress.current} из {progress.total}</p>
              <div className="w-full max-w-2xl h-4 bg-slate-100 rounded-full mt-10 overflow-hidden">
                <div className="h-full bg-indigo-600 transition-all duration-500" style={{width: `${(progress.current/progress.total)*100}%`}}></div>
              </div>
           </div>
        )}

        {/* Cards Grid */}
        {groupedDocs.length > 0 && !verifyingDocId && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {groupedDocs.map(doc => (
              <div key={doc.id} onClick={() => setVerifyingDocId(doc.id)} className="bg-white rounded-[32px] border border-slate-200 overflow-hidden cursor-pointer hover:shadow-2xl hover:border-indigo-300 transition-all group flex flex-col h-full shadow-sm relative">
                <button 
                  onClick={(e) => deleteDoc(e, doc.id)}
                  className="absolute top-4 right-4 z-10 p-2 bg-red-50 text-red-500 rounded-xl opacity-0 group-hover:opacity-100 hover:bg-red-500 hover:text-white transition-all shadow-sm"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>

                <div className="p-6 bg-slate-50/50 border-b flex justify-between items-start pr-12">
                   <div>
                      <h4 className="font-black text-slate-800 text-lg uppercase truncate max-w-[200px]">{doc.data.lastName || "НЕИЗВЕСТНО"}</h4>
                      <p className="text-xs font-bold text-slate-400">СНИЛС: {doc.data.snils || '???'}</p>
                   </div>
                   {doc.isVerified ? (
                     <div className="bg-emerald-100 text-emerald-700 p-1.5 rounded-full"><svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg></div>
                   ) : (
                     <div className="bg-orange-100 text-orange-600 px-2 py-1 rounded-lg text-[10px] font-black uppercase">Проверка</div>
                   )}
                </div>
                <div className="flex-1 p-4 grid grid-cols-2 gap-2 overflow-hidden opacity-80 group-hover:opacity-100 transition-opacity min-h-[160px]">
                   {doc.pages.slice(0, 2).map(p => (
                     <img key={p.id} src={p.imageData} className="w-full aspect-[3/4] object-cover rounded-lg border border-slate-100 shadow-sm" />
                   ))}
                </div>
                <div className="p-4 bg-white border-t flex gap-3">
                   <div className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-1 rounded-md">Пом. {doc.data.roomNo || '??'}</div>
                   <div className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-1 rounded-md">Доля {doc.data.ownershipShare || '??'}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* API Settings Modal */}
        {isApiModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-xl animate-in fade-in duration-300">
             <div className="bg-white w-full max-w-xl rounded-[48px] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300">
                <div className="p-10 border-b border-slate-100">
                  <div className="flex justify-between items-start mb-2">
                    <h2 className="text-3xl font-black text-slate-800">Настройки API</h2>
                    <button onClick={() => setIsApiModalOpen(false)} className="p-2 bg-slate-100 rounded-2xl hover:bg-slate-200 transition-colors">
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  </div>
                  <p className="text-slate-400 font-medium">Выберите провайдера нейросети для анализа документов</p>
                </div>
                
                <div className="p-10 space-y-8">
                  <div className="flex gap-4 p-2 bg-slate-100 rounded-[28px]">
                    <button 
                      onClick={() => setApiSettings(s => ({ ...s, provider: 'google', model: 'gemini-3-flash-preview' }))}
                      className={`flex-1 py-4 rounded-[20px] font-black transition-all ${apiSettings.provider === 'google' ? 'bg-white shadow-xl text-indigo-600' : 'text-slate-400'}`}
                    >
                      Google Cloud
                    </button>
                    <button 
                      onClick={() => setApiSettings(s => ({ ...s, provider: 'openrouter', model: 'google/gemini-3-pro-preview' }))}
                      className={`flex-1 py-4 rounded-[20px] font-black transition-all ${apiSettings.provider === 'openrouter' ? 'bg-white shadow-xl text-indigo-600' : 'text-slate-400'}`}
                    >
                      OpenRouter
                    </button>
                  </div>

                  {apiSettings.provider === 'google' ? (
                    <div className="space-y-6">
                       <div className="p-6 bg-indigo-50 border border-indigo-100 rounded-3xl">
                          <h4 className="font-black text-indigo-900 mb-2">Google AI Studio</h4>
                          <p className="text-sm text-indigo-700 font-medium leading-relaxed">Для работы требуется выбрать API ключ из вашего Google AI Studio (обязательно с биллингом).</p>
                          <button 
                            // @ts-ignore
                            onClick={async () => { await window.aistudio.openSelectKey(); setIsApiModalOpen(false); }}
                            className="mt-6 w-full py-4 bg-indigo-600 text-white rounded-2xl font-black shadow-lg shadow-indigo-200 hover:scale-[1.02] active:scale-95 transition-all"
                          >
                            Выбрать API Ключ
                          </button>
                       </div>
                       <div>
                          <label className="text-xs font-black text-slate-400 uppercase tracking-widest block mb-3 pl-2">Модель</label>
                          <select 
                            value={apiSettings.model}
                            onChange={e => setApiSettings(s => ({ ...s, model: e.target.value }))}
                            className="w-full p-5 bg-slate-50 border-none rounded-2xl font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500"
                          >
                            <option value="gemini-3-flash-preview">Gemini 3 Flash (Быстро)</option>
                            <option value="gemini-3-pro-preview">Gemini 3 Pro (Точно)</option>
                          </select>
                       </div>
                    </div>
                  ) : (
                    <div className="space-y-6">
                       <div>
                          <label className="text-xs font-black text-slate-400 uppercase tracking-widest block mb-3 pl-2">API Ключ OpenRouter</label>
                          <input 
                            type="password"
                            placeholder="sk-or-v1-..."
                            value={apiSettings.apiKey || ''}
                            onChange={e => setApiSettings(s => ({ ...s, apiKey: e.target.value }))}
                            className="w-full p-5 bg-slate-50 border-none rounded-2xl font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500"
                          />
                       </div>
                       <div>
                          <label className="text-xs font-black text-slate-400 uppercase tracking-widest block mb-3 pl-2">Модель (ID)</label>
                          <input 
                            type="text"
                            placeholder="google/gemini-3-pro-preview"
                            value={apiSettings.model}
                            onChange={e => setApiSettings(s => ({ ...s, model: e.target.value }))}
                            className="w-full p-5 bg-slate-50 border-none rounded-2xl font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500"
                          />
                       </div>
                    </div>
                  )}

                  <div className="pt-4">
                    <button 
                      onClick={() => setIsApiModalOpen(false)}
                      className="w-full py-5 bg-slate-900 text-white rounded-[24px] font-black text-lg hover:bg-black transition-colors"
                    >
                      Сохранить настройки
                    </button>
                  </div>
                </div>
             </div>
          </div>
        )}

        {/* Verification View */}
        {verifyingDocId && activeDoc && (
          <div className="fixed inset-0 z-50 bg-slate-100 flex flex-col animate-in fade-in duration-300">
             <header className="bg-white border-b p-4 flex justify-between items-center shadow-sm">
                <div className="flex items-center gap-4">
                  <button onClick={() => setVerifyingDocId(null)} className="p-2 hover:bg-slate-100 rounded-xl transition-colors">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" /></svg>
                  </button>
                  <h2 className="text-xl font-black text-slate-800">Проверка: {activeDoc.name}</h2>
                </div>
                <button onClick={() => {
                  setGroupedDocs(prev => prev.map(d => d.id === verifyingDocId ? {...d, isVerified: true} : d));
                  setVerifyingDocId(null);
                }} className="px-8 py-3 bg-indigo-600 text-white rounded-2xl font-black shadow-lg shadow-indigo-100 hover:scale-105 transition-transform">
                  Готово
                </button>
             </header>
             
             <div className="flex-1 flex overflow-hidden">
                <div className="flex-1 bg-slate-200 p-8 overflow-y-auto flex flex-col items-center gap-8 scrollbar-hide">
                   {activeDoc.pages.map((p, idx) => (
                     <div key={p.id} className="relative group/img">
                        <img src={p.imageData} className="max-w-3xl shadow-2xl rounded-sm border border-slate-300" />
                        <div className="absolute top-4 left-4 bg-black/50 text-white px-3 py-1 rounded-full font-bold backdrop-blur-md">Стр. {idx + 1}</div>
                     </div>
                   ))}
                </div>

                <div className="w-[850px] bg-white border-l shadow-2xl overflow-y-auto p-8 space-y-10 scrollbar-hide">
                   <section>
                      <h4 className="text-xs font-black text-indigo-500 uppercase tracking-widest mb-4">Данные собственника</h4>
                      <div className="space-y-4">
                        <div className="grid grid-cols-3 gap-4">
                          {[
                            { label: 'Фамилия', field: 'lastName' },
                            { label: 'Имя', field: 'firstName' },
                            { label: 'Отчество', field: 'middleName' }
                          ].map(item => (
                            <div key={item.field}>
                              <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">{item.label}</label>
                              <input 
                                type="text" 
                                value={(activeDoc.data[item.field as keyof BallotData] as any) || ''} 
                                onChange={(e) => updateData(item.field as keyof BallotData, e.target.value)}
                                className={`w-full p-4 bg-slate-50 border-none rounded-xl font-bold focus:ring-2 focus:ring-indigo-500 transition-all ${(activeDoc.data[item.field as keyof BallotData] as any) === 'ОШИБКА' ? 'bg-red-50 text-red-600 ring-1 ring-red-200' : ''}`}
                              />
                            </div>
                          ))}
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">СНИЛС</label>
                            <input type="text" value={activeDoc.data.snils || ''} onChange={e => updateData('snils', e.target.value)} className="w-full p-4 bg-slate-50 border-none rounded-xl font-bold tracking-[0.2em]" />
                          </div>
                          <div>
                            <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">Помещение</label>
                            <input type="text" value={activeDoc.data.roomNo || ''} onChange={e => updateData('roomNo', e.target.value)} className="w-full p-4 bg-slate-50 border-none rounded-xl font-bold" />
                          </div>
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">Адрес МКД</label>
                          <input type="text" value={activeDoc.data.address || ''} onChange={e => updateData('address', e.target.value)} className="w-full p-4 bg-slate-50 border-none rounded-xl font-bold text-slate-700" />
                        </div>
                      </div>
                   </section>

                   <section>
                      <h4 className="text-xs font-black text-indigo-500 uppercase tracking-widest mb-4">Результаты</h4>
                      <div className="space-y-6">
                         {[1,2,3,4].map(q => {
                           const qText = activeDoc.data.questionTexts?.[q] || "";
                           return (
                           <div key={q} className="flex flex-col gap-4 bg-slate-50 p-6 rounded-[24px]">
                              <div className="flex items-center justify-between">
                                <span className="w-8 h-8 bg-slate-900 text-white flex items-center justify-center rounded-lg font-black text-sm">#{q}</span>
                                <div className="flex gap-1.5 bg-white p-1 rounded-xl shadow-sm">
                                   {['ЗА', 'ПРОТИВ', 'ВОЗДЕРЖАЛСЯ'].map(choice => (
                                     <button 
                                      key={choice}
                                      onClick={() => updateNestedData('votes', q.toString(), choice)}
                                      className={`px-4 py-2 text-[10px] font-black rounded-lg transition-all ${activeDoc.data.votes?.[q] === choice ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:bg-slate-50'}`}
                                     >
                                       {choice}
                                     </button>
                                   ))}
                                </div>
                              </div>
                              <textarea 
                                value={qText} 
                                onChange={e => updateNestedData('questionTexts', q.toString(), e.target.value)}
                                className="w-full p-4 bg-white border border-slate-200 rounded-2xl text-sm font-semibold text-slate-600 focus:ring-2 focus:ring-indigo-500 min-h-[100px] resize-none"
                              />
                           </div>
                         )})}
                      </div>
                   </section>
                </div>
             </div>
          </div>
        )}
      </div>
    </div>
  );
};
