'use client';
import { useState } from 'react';
import { Download, Sparkles, Loader2, FileText, Check } from 'lucide-react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  provider?: 'groq' | 'google' | 'deepseek';
}

interface FlashcardExportProps {
  messages: Message[];
  onClose: () => void;
}

export default function FlashcardExport({ messages, onClose }: FlashcardExportProps) {
  const [format, setFormat] = useState<'anki' | 'text'>('anki');
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);

  const extractQAPairs = (): { question: string; answer: string }[] => {
    const pairs: { question: string; answer: string }[] = [];
    let lastQuestion = '';

    for (const msg of messages) {
      if (msg.role === 'user') {
        lastQuestion = msg.content;
      } else if (msg.role === 'assistant' && lastQuestion) {
        const answer = msg.content
          .replace(/^>.*\n?/gm, '')
          .replace(/#{1,6}\s/g, '')
          .replace(/\*{1,2}/g, '')
          .trim();
        if (answer.length > 10) {
          pairs.push({
            question: lastQuestion.substring(0, 200),
            answer: answer.substring(0, 2000),
          });
        }
        lastQuestion = '';
      }
    }
    return pairs;
  };

  const handleExport = () => {
    const pairs = extractQAPairs();
    if (pairs.length === 0) return;

    setExporting(true);

    if (format === 'anki') {
      const csvHeader = 'question,answer\n';
      const csvRows = pairs
        .map((p) => {
          const q = p.question.replace(/"/g, '""');
          const a = p.answer.replace(/"/g, '""').replace(/\n/g, '\\n');
          return `"${q}","${a}"`;
        })
        .join('\n');
      const blob = new Blob([csvHeader + csvRows], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `flashcards-${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      const text = pairs
        .map((p, i) => `Q${i + 1}: ${p.question}\nA: ${p.answer}\n---`)
        .join('\n\n');
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `flashcards-${Date.now()}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    }

    setExporting(false);
    setExported(true);
    setTimeout(() => {
      setExported(false);
      onClose();
    }, 1500);
  };

  const pairs = extractQAPairs();

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-[#0c0c0e] border border-white/10 w-full max-w-md rounded-2xl p-6 shadow-2xl relative">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-3 bg-green-600/10 rounded-xl border border-green-500/20 text-green-400">
            <Sparkles size={24} />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">Export Flashcards</h3>
            <p className="text-xs text-gray-400">{pairs.length} Q&A pairs found</p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex gap-2 p-1 bg-white/5 rounded-xl border border-white/10">
            <button
              onClick={() => setFormat('anki')}
              className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${format === 'anki' ? 'bg-[#2c2d2e] text-white shadow-lg ring-1 ring-white/10' : 'text-gray-400 hover:text-white'}`}
            >
              <FileText size={14} className="inline mr-1" /> Anki CSV
            </button>
            <button
              onClick={() => setFormat('text')}
              className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${format === 'text' ? 'bg-[#2c2d2e] text-white shadow-lg ring-1 ring-white/10' : 'text-gray-400 hover:text-white'}`}
            >
              <FileText size={14} className="inline mr-1" /> Plain Text
            </button>
          </div>

          {pairs.length > 0 && (
            <div className="max-h-40 overflow-y-auto custom-scrollbar space-y-2 border border-white/5 rounded-xl p-3 bg-black/20">
              {pairs.slice(0, 5).map((p, i) => (
                <div key={i} className="text-xs text-gray-400 border-b border-white/5 pb-2 last:border-0">
                  <span className="text-gray-500 font-medium">Q: </span>
                  <span className="text-gray-300">{p.question.substring(0, 60)}{p.question.length > 60 ? '...' : ''}</span>
                </div>
              ))}
              {pairs.length > 5 && (
                <div className="text-xs text-gray-500 text-center">...and {pairs.length - 5} more</div>
              )}
            </div>
          )}

          {pairs.length === 0 && (
            <div className="text-center py-6 text-gray-500 text-sm border border-dashed border-white/10 rounded-xl">
              No Q&A pairs found. Ask some questions first.
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={onClose} className="flex-1 py-3 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 text-sm font-medium border border-white/10 transition-colors">
              Cancel
            </button>
            <button
              onClick={handleExport}
              disabled={pairs.length === 0 || exporting}
              className="flex-1 py-3 rounded-xl bg-green-600 hover:bg-green-500 text-white text-sm font-bold transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {exporting ? <Loader2 size={16} className="animate-spin" /> : exported ? <Check size={16} /> : <Download size={16} />}
              {exporting ? 'Exporting...' : exported ? 'Exported!' : 'Download'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
