import React, { useState, useCallback, useRef } from 'react';
import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from "@google/genai";
import JSZip from 'jszip';
import { useDropzone } from 'react-dropzone';
import {
  Upload,
  FileText,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Download,
  Image as ImageIcon,
  ChevronRight,
  Languages
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// Initialize Gemini with key rotation support
const API_KEYS = [
  process.env.GEMINI_API_KEY,
  process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_3,
  process.env.GEMINI_API_KEY_4,
  process.env.GEMINI_API_KEY_5,
].filter(Boolean) as string[];

let currentKeyIndex = 0;

function getGenAI(): GoogleGenAI {
  return new GoogleGenAI({ apiKey: API_KEYS[currentKeyIndex] || '' });
}

function rotateToNextKey(): boolean {
  const nextIndex = currentKeyIndex + 1;
  if (nextIndex < API_KEYS.length) {
    currentKeyIndex = nextIndex;
    console.log(`🔑 API key quota exhausted. Rotating to key #${nextIndex + 1} of ${API_KEYS.length}`);
    return true;
  }
  console.error('❌ All API keys exhausted!');
  return false;
}

function isQuotaError(error: any): boolean {
  const message = (error?.message || '').toLowerCase();
  const status = error?.status || error?.statusCode || 0;
  return (
    status === 429 ||
    message.includes('resource_exhausted') ||
    message.includes('quota') ||
    message.includes('rate limit') ||
    message.includes('too many requests')
  );
}

function isInvalidKeyError(error: any): boolean {
  const message = (error?.message || '').toLowerCase();
  const status = error?.status || error?.statusCode || 0;
  return (
    status === 400 ||
    status === 401 ||
    status === 403 ||
    message.includes('api key not valid') ||
    message.includes('api_key_invalid') ||
    message.includes('invalid api key') ||
    message.includes('unauthorized')
  );
}

function isTemporaryError(error: any): boolean {
  const message = (error?.message || '').toLowerCase();
  const status = error?.status || error?.statusCode || 0;
  return (
    status === 503 ||
    status === 500 ||
    message.includes('unavailable') ||
    message.includes('high demand') ||
    message.includes('overloaded') ||
    message.includes('internal error')
  );
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

interface TranslationResult {
  fileName: string;
  originalText: string;
  translatedText: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  error?: string;
}

export default function App() {
  const [results, setResults] = useState<TranslationResult[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentFileIndex, setCurrentFileIndex] = useState(-1);
  const [zipName, setZipName] = useState<string | null>(null);

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file || !file.name.endsWith('.zip')) return;

    setZipName(file.name);
    setIsProcessing(true);
    setResults([]);
    setCurrentFileIndex(-1);

    try {
      const zip = new JSZip();
      const contents = await zip.loadAsync(file);

      // Filter and sort image files
      const imageFiles = Object.keys(contents.files)
        .filter(name => /\.(png|jpe?g|webp)$/i.test(name) && !contents.files[name].dir)
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

      if (imageFiles.length === 0) {
        throw new Error("No valid image files found in the zip.");
      }

      const initialResults: TranslationResult[] = imageFiles.map(name => ({
        fileName: name,
        originalText: '',
        translatedText: '',
        status: 'pending'
      }));
      setResults(initialResults);

      // Process sequentially
      for (let i = 0; i < imageFiles.length; i++) {
        setCurrentFileIndex(i);
        const fileName = imageFiles[i];

        setResults(prev => prev.map((res, idx) =>
          idx === i ? { ...res, status: 'processing' } : res
        ));

        try {
          const imageBlob = await contents.files[fileName].async('blob');
          const base64Data = await blobToBase64(imageBlob);

          // Fix: Derive MIME type if blob.type is empty
          let mimeType = imageBlob.type;
          if (!mimeType) {
            const ext = fileName.split('.').pop()?.toLowerCase();
            if (ext === 'webp') mimeType = 'image/webp';
            else if (ext === 'png') mimeType = 'image/png';
            else if (ext === 'jpg' || ext === 'jpeg') mimeType = 'image/jpeg';
            else mimeType = 'image/png'; // Fallback
          }

          const translation = await translateImage(base64Data, mimeType);

          setResults(prev => prev.map((res, idx) =>
            idx === i ? {
              ...res,
              status: 'completed',
              originalText: translation.original,
              translatedText: translation.translated
            } : res
          ));
        } catch (err: any) {
          console.error(`Error processing ${fileName}:`, err);
          setResults(prev => prev.map((res, idx) =>
            idx === i ? { ...res, status: 'error', error: err.message } : res
          ));
        }
      }
    } catch (err: any) {
      alert(err.message);
    } finally {
      setIsProcessing(false);
      setCurrentFileIndex(-1);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/zip': ['.zip'] },
    multiple: false,
    disabled: isProcessing,
    onDragEnter: undefined,
    onDragOver: undefined,
    onDragLeave: undefined
  });

  const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = (reader.result as string).split(',')[1];
        resolve(base64String);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  const translateImage = async (base64Data: string, mimeType: string) => {
    const model = "gemini-3-flash-preview";

    const prompt = `
      You are an elite-tier manhwa and manga translator with years of professional localization experience.
      You translate Korean AND Japanese text into flawless, natural English.

      ANALYZE this comic page and extract ALL text — speech bubbles, thought bubbles, narration captions, sound effects (SFX), signs, and any on-screen text.

      TRANSLATION RULES (STRICT):
      1. NEVER do word-for-word or literal translation. Always localize for meaning, flow, and feel.
      2. Translate contextually — understand the scene, the characters' emotions, relationships, and tone before translating.
      3. The English MUST read as if it was originally written by a native English speaker. Use natural contractions, slang, idioms, and sentence structures that real people use.
      4. Match each character's voice — if someone speaks casually, use casual English. If formal, keep it formal. If aggressive, make it hit hard.
      5. For SFX: provide punchy, expressive English equivalents (e.g. 쾅 → "WHAM", ドキドキ → "BA-DUMP BA-DUMP"), not transliterations.
      6. Preserve implied meaning, subtext, and innuendo. Don't flatten or sanitize the dialogue.
      7. If the text is ambiguous, use the visual context of the scene to determine the correct interpretation.

      For each piece of text found, provide:
      - "type": One of "Bubble", "Caption", "SFX", "Sign", "Narration"
      - "original": The exact original Korean or Japanese text as it appears
      - "translated": Your polished, native-quality English translation

      Format the output as a JSON array:
      [
        { "type": "Bubble", "original": "...", "translated": "..." }
      ]
    `;

    // Retry loop for automatic key rotation on quota errors
    let retryCount = 0;
    const MAX_RETRIES = 3;

    while (true) {
      try {
        const genAI = getGenAI();
        const response = await genAI.models.generateContent({
          model,
          contents: [
            {
              parts: [
                { text: prompt },
                { inlineData: { data: base64Data, mimeType } }
              ]
            }
          ],
          config: {
            responseMimeType: "application/json",
            safetySettings: [
              { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.OFF },
              { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.OFF },
              { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.OFF },
              { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.OFF },
            ]
          }
        });

        const text = response.text;
        if (!text) throw new Error("No response from AI");

        const data = JSON.parse(text);

        // Format the data into a readable string for the state
        const formattedOriginal = data.map((item: any) => `[${item.type}] ${item.original}`).join('\n');
        const formattedTranslated = data.map((item: any) => `[${item.type}] ${item.translated}`).join('\n');

        return {
          original: formattedOriginal,
          translated: formattedTranslated
        };
      } catch (err: any) {
        // Handle quota exhaustion or invalid key → rotate to next API key
        if (isQuotaError(err) || isInvalidKeyError(err)) {
          console.log(`⚠️ Key #${currentKeyIndex + 1} failed: ${err.message?.substring(0, 60)}...`);
          const rotated = rotateToNextKey();
          if (rotated) {
            retryCount = 0; // Reset retry count for new key
            continue;
          }
        }

        // Handle temporary server errors (503, 500) → retry with backoff
        if (isTemporaryError(err) && retryCount < MAX_RETRIES) {
          retryCount++;
          const waitTime = Math.pow(2, retryCount) * 1000; // 2s, 4s, 8s
          console.log(`⏳ Server busy (attempt ${retryCount}/${MAX_RETRIES}). Retrying in ${waitTime / 1000}s...`);
          await delay(waitTime);
          continue;
        }

        throw err; // Unrecoverable error or max retries exceeded
      }
    }
  };

  const downloadTxt = () => {
    const content = results.map(res => {
      return `--- FILE: ${res.fileName} ---\n\nORIGINAL KOREAN:\n${res.originalText || '(No text found)'}\n\nENGLISH TRANSLATION:\n${res.translatedText || '(No text found)'}\n\n${'='.repeat(40)}\n`;
    }).join('\n');

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${zipName?.replace('.zip', '') || 'manhwa'}_translation.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-[#1A1A1A] font-sans selection:bg-emerald-100">
      {/* Header */}
      <header className="border-b border-black/5 bg-white/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-600 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-200">
              <Languages className="text-white w-6 h-6" />
            </div>
            <div>
              <h1 className="font-bold text-lg tracking-tight">Manhwa Translator Pro</h1>
              <p className="text-[10px] uppercase tracking-widest text-black/40 font-semibold">Sequential Bubble Extraction</p>
            </div>
          </div>

          {results.length > 0 && !isProcessing && (
            <button
              onClick={downloadTxt}
              className="flex items-center gap-2 bg-black text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-black/80 transition-all active:scale-95 shadow-xl shadow-black/10"
            >
              <Download className="w-4 h-4" />
              Download .txt
            </button>
          )}
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-12">
        {/* Upload Section */}
        {!zipName ? (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="max-w-2xl mx-auto"
          >
            <div
              {...getRootProps()}
              className={`
                relative group cursor-pointer
                border-2 border-dashed rounded-3xl p-12 transition-all duration-300
                flex flex-col items-center justify-center text-center gap-6
                ${isDragActive ? 'border-emerald-500 bg-emerald-50/50 scale-[1.02]' : 'border-black/10 bg-white hover:border-black/20 hover:shadow-2xl hover:shadow-black/5'}
              `}
            >
              <input {...getInputProps()} />
              <div className="w-20 h-20 bg-emerald-50 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform duration-500">
                <Upload className="w-10 h-10 text-emerald-600" />
              </div>
              <div>
                <h3 className="text-xl font-bold mb-2">Upload Manhwa ZIP</h3>
                <p className="text-black/50 max-w-xs mx-auto">
                  Drag and drop your zip file containing comic pages. We'll handle the rest.
                </p>
              </div>
              <div className="flex gap-4 mt-4">
                <span className="px-3 py-1 bg-black/5 rounded-full text-[10px] font-bold uppercase tracking-wider text-black/40">ZIP Only</span>
                <span className="px-3 py-1 bg-black/5 rounded-full text-[10px] font-bold uppercase tracking-wider text-black/40">Sequential</span>
              </div>
            </div>
          </motion.div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* Sidebar / Progress */}
            <div className="lg:col-span-4 space-y-6">
              <div className="bg-white rounded-2xl border border-black/5 p-6 shadow-sm">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="font-bold text-sm uppercase tracking-wider text-black/40">Processing Queue</h2>
                  <span className="text-xs font-mono bg-black/5 px-2 py-1 rounded">
                    {results.filter(r => r.status === 'completed').length} / {results.length}
                  </span>
                </div>

                <div className="space-y-2 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
                  {results.map((res, idx) => (
                    <div
                      key={res.fileName}
                      className={`
                        flex items-center gap-3 p-3 rounded-xl border transition-all
                        ${idx === currentFileIndex ? 'bg-emerald-50 border-emerald-200 ring-2 ring-emerald-100' : 'bg-white border-black/5'}
                        ${res.status === 'completed' ? 'opacity-60' : 'opacity-100'}
                      `}
                    >
                      <div className="w-8 h-8 rounded-lg bg-black/5 flex items-center justify-center shrink-0">
                        {res.status === 'completed' ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> :
                          res.status === 'processing' ? <Loader2 className="w-4 h-4 text-emerald-600 animate-spin" /> :
                            res.status === 'error' ? <AlertCircle className="w-4 h-4 text-red-500" /> :
                              <ImageIcon className="w-4 h-4 text-black/20" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium truncate">{res.fileName}</p>
                        <p className="text-[10px] text-black/40 uppercase tracking-tighter">
                          {res.status}
                        </p>
                      </div>
                      {idx === currentFileIndex && (
                        <motion.div
                          layoutId="active-indicator"
                          className="w-1.5 h-1.5 bg-emerald-500 rounded-full shadow-[0_0_8px_rgba(16,185,129,0.5)]"
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {isProcessing && (
                <div className="bg-emerald-600 text-white rounded-2xl p-6 shadow-lg shadow-emerald-200 flex items-center gap-4">
                  <Loader2 className="w-6 h-6 animate-spin" />
                  <div>
                    <p className="text-sm font-bold">AI is translating...</p>
                    <p className="text-[10px] opacity-70 uppercase tracking-widest">Page {currentFileIndex + 1} of {results.length}</p>
                  </div>
                </div>
              )}
            </div>

            {/* Main Content / Results */}
            <div className="lg:col-span-8 space-y-6">
              <AnimatePresence mode="wait">
                {results.some(r => r.status === 'completed' || r.status === 'processing') ? (
                  <motion.div
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    className="space-y-6"
                  >
                    {results.map((res, idx) => (
                      res.status !== 'pending' && (
                        <motion.div
                          key={res.fileName}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="bg-white rounded-3xl border border-black/5 overflow-hidden shadow-sm hover:shadow-md transition-shadow"
                        >
                          <div className="bg-black/[0.02] px-6 py-4 border-b border-black/5 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <FileText className="w-4 h-4 text-black/40" />
                              <span className="text-xs font-bold tracking-tight">{res.fileName}</span>
                            </div>
                            {res.status === 'completed' && (
                              <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest flex items-center gap-1">
                                <CheckCircle2 className="w-3 h-3" /> Ready
                              </span>
                            )}
                          </div>

                          <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-3">
                              <h4 className="text-[10px] font-bold uppercase tracking-widest text-black/30">Original Text</h4>
                              <div className="bg-[#F1F3F5] rounded-xl p-4 min-h-[100px] text-sm font-medium leading-relaxed whitespace-pre-wrap">
                                {res.status === 'processing' ? (
                                  <div className="flex items-center gap-2 text-black/30 italic">
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                    Extracting...
                                  </div>
                                ) : res.originalText || 'No text detected.'}
                              </div>
                            </div>
                            <div className="space-y-3">
                              <h4 className="text-[10px] font-bold uppercase tracking-widest text-emerald-600/50">English Translation</h4>
                              <div className="bg-emerald-50/30 rounded-xl p-4 min-h-[100px] text-sm font-medium leading-relaxed whitespace-pre-wrap border border-emerald-100/50">
                                {res.status === 'processing' ? (
                                  <div className="flex items-center gap-2 text-emerald-600/30 italic">
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                    Translating...
                                  </div>
                                ) : res.translatedText || 'No translation available.'}
                              </div>
                            </div>
                          </div>

                          {res.error && (
                            <div className="px-6 py-3 bg-red-50 border-t border-red-100 flex items-center gap-2 text-xs text-red-600 font-medium">
                              <AlertCircle className="w-3 h-3" />
                              {res.error}
                            </div>
                          )}
                        </motion.div>
                      )
                    ))}
                  </motion.div>
                ) : (
                  <div className="h-[400px] flex flex-col items-center justify-center text-center text-black/20 gap-4 border-2 border-dashed border-black/5 rounded-3xl">
                    <ImageIcon className="w-12 h-12" />
                    <p className="text-sm font-medium">Processing will start automatically...</p>
                  </div>
                )}
              </AnimatePresence>
            </div>
          </div>
        )}
      </main>

      {/* Custom Scrollbar Styles */}
      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(0, 0, 0, 0.05);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(0, 0, 0, 0.1);
        }
      `}</style>
    </div>
  );
}
