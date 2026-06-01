'use client';
import { useMemo } from 'react';
import { Brain, CheckCircle2, AlertTriangle, Sparkles, Lightbulb, MessageSquare } from 'lucide-react';

function cleanMarkdown(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/_(.*?)_/g, '$1')
    .replace(/`{1,3}[^`]*`{1,3}/g, '')
    .replace(/#{1,6}\s/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^[-*+]\s/gm, '')
    .replace(/^\d+\.\s/gm, '')
    .trim();
}

interface Message {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  provider?: 'groq' | 'google' | 'deepseek';
}

interface SummaryColumnProps {
  messages: { groq: Message[]; google: Message[]; deepseek: Message[] };
}

function extractSections(text: string): string[] {
  const lines = text.split('\n');
  const sections: string[] = [];
  let buffer = '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (buffer.length > 30) {
        sections.push(cleanMarkdown(buffer.trim()));
        buffer = '';
      }
      continue;
    }
    const clean = cleanMarkdown(trimmed.replace(/^[#*\-•·]+/, '').trim());
    if (clean.length > 5) {
      buffer += (buffer ? ' ' : '') + clean;
    }
  }
  if (buffer.length > 30) sections.push(cleanMarkdown(buffer.trim()));
  return sections.slice(0, 12);
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function keyWords(text: string): string[] {
  const words = normalize(text).split(' ').filter(w => w.length > 3 && !['this', 'that', 'with', 'from', 'have', 'been', 'were', 'they', 'them', 'their', 'about', 'would', 'could', 'should', 'there', 'which', 'what', 'when', 'where', 'because'].includes(w));
  return [...new Set(words)];
}

function calcRelevance(a: string, b: string): number {
  const wa = keyWords(a);
  const wb = keyWords(b);
  if (wa.length === 0 || wb.length === 0) return 0;
  const overlap = wa.filter(w => wb.includes(w)).length;
  return overlap / Math.max(wa.length, wb.length);
}

const PROVIDER_INFO: Record<string, { label: string; color: string; icon: string }> = {
  groq: { label: 'Llama', color: 'text-orange-400', icon: '🦙' },
  google: { label: 'Gemini', color: 'text-blue-400', icon: '✨' },
  deepseek: { label: 'DeepSeek', color: 'text-purple-400', icon: '🧠' },
};

export default function SummaryColumn({ messages }: SummaryColumnProps) {
  const summary = useMemo(() => {
    const allProviders = ['groq', 'google', 'deepseek'] as const;
    const activeModels = allProviders
      .map(p => ({ provider: p, msgs: messages[p] }))
      .filter(({ msgs }) => msgs.some(m => m.role === 'assistant' && m.content.length > 10));

    if (activeModels.length < 2) return null;

    const responses = activeModels.map(({ provider, msgs }) => {
      const last = [...msgs].reverse().find(m => m.role === 'assistant');
      return { provider, text: last?.content || '', info: PROVIDER_INFO[provider] };
    }).filter(r => r.text.length > 10);

    if (responses.length < 2) return null;

    const sectionsByModel = responses.map(r => ({
      provider: r.provider,
      info: r.info,
      sections: extractSections(r.text),
    }));

    const agreed: { points: string[]; modelCount: number }[] = [];
    const uniqueInsights: { provider: string; info: typeof PROVIDER_INFO[string]; points: string[] }[] = [];

    for (let i = 0; i < sectionsByModel.length; i++) {
      const current = sectionsByModel[i];
      const others = sectionsByModel.filter((_, j) => j !== i);
      const unique: string[] = [];

      for (const section of current.sections) {
        let foundAgreement = false;
        for (const other of others) {
          for (const otherSection of other.sections) {
            if (calcRelevance(section, otherSection) > 0.25) {
              if (!agreed.some(a => calcRelevance(a.points[0], section) > 0.3)) {
                agreed.push({ points: [section, otherSection], modelCount: 2 });
              }
              foundAgreement = true;
              break;
            }
          }
          if (foundAgreement) break;
        }
        if (!foundAgreement) unique.push(section);
      }

      if (unique.length > 0) {
        uniqueInsights.push({ provider: current.provider, info: current.info, points: unique.slice(0, 5) });
      }
    }

    const topAgreed = agreed
      .sort((a, b) => b.modelCount - a.modelCount)
      .slice(0, 6)
      .map(a => cleanMarkdown(a.points[0]));

    const uniqueInsightsClean = uniqueInsights.map(u => ({
      ...u,
      points: u.points.map(p => cleanMarkdown(p)),
    }));

    const hasDisagreement = uniqueInsights.length >= Math.min(responses.length, 2);

    return { agreed: topAgreed, uniqueInsights: uniqueInsightsClean, hasDisagreement, responderCount: responses.length, responderNames: responses.map(r => r.info.label) };
  }, [messages]);

  if (!summary) return null;

  return (
    <div className="flex flex-col rounded-2xl bg-[#1e1f20] border border-emerald-500/20 shadow-xl overflow-hidden h-full">
      <div className="flex items-center gap-2 px-4 py-3 bg-[#1e1f20]/95 backdrop-blur-sm border-b border-emerald-500/20 sticky top-0 z-10">
        <Brain size={16} className="text-emerald-400" />
        <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider">AI Summary</span>
        <span className="ml-auto text-[10px] text-gray-500 bg-white/5 px-2 py-0.5 rounded-full border border-white/10">
          {summary.responderCount} models
        </span>
      </div>

      <div className="flex-1 p-4 overflow-y-auto custom-scrollbar space-y-4">
        {summary.agreed.length > 0 && (
          <div className="space-y-2 animate-in fade-in slide-in-from-bottom-2">
            <div className="flex items-center gap-2 text-xs font-bold text-emerald-400">
              <CheckCircle2 size={14} /> What All Models Agree On
            </div>
            <div className="space-y-1.5">
              {summary.agreed.map((point, i) => (
                <div key={i} className="flex items-start gap-2 px-3 py-2.5 bg-emerald-500/5 border border-emerald-500/10 rounded-xl">
                  <CheckCircle2 size={14} className="text-emerald-400 mt-0.5 shrink-0" />
                  <p className="text-xs text-gray-200 leading-relaxed">{point}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {summary.uniqueInsights.length > 0 && (
          <div className="space-y-2 animate-in fade-in slide-in-from-bottom-2">
            <div className="flex items-center gap-2 text-xs font-bold text-yellow-400">
              <Lightbulb size={14} /> Extra Insights
            </div>
            {summary.uniqueInsights.map((item, i) => (
              <div key={i} className="space-y-1.5">
                <div className="flex items-center gap-1.5 px-1">
                  <span className={`text-[11px] font-bold ${item.info.color}`}>
                    {item.info.icon} {item.info.label}
                  </span>
                  <span className="text-[10px] text-gray-500">offers a unique perspective</span>
                </div>
                {item.points.map((point, j) => (
                  <div key={j} className="flex items-start gap-2 px-3 py-2.5 bg-yellow-500/5 border border-yellow-500/10 rounded-xl">
                    <Sparkles size={14} className="text-yellow-400 mt-0.5 shrink-0" />
                    <p className="text-xs text-gray-200 leading-relaxed">{point}</p>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {summary.hasDisagreement && summary.agreed.length < 3 && (
          <div className="space-y-2 animate-in fade-in slide-in-from-bottom-2">
            <div className="flex items-center gap-2 text-xs font-bold text-orange-400">
              <AlertTriangle size={14} /> Different Perspectives
            </div>
            <div className="flex items-start gap-2.5 px-3 py-3 bg-orange-500/5 border border-orange-500/15 rounded-xl">
              <MessageSquare size={16} className="text-orange-400 mt-0.5 shrink-0" />
              <div className="space-y-1">
                <p className="text-xs text-gray-200 leading-relaxed">
                  The AI models have different takes on this topic. Each one highlights unique aspects worth considering.
                </p>
                <p className="text-[10px] text-gray-500">
                  Models: {summary.responderNames.join(', ')}
                </p>
              </div>
            </div>
          </div>
        )}

        {summary.agreed.length === 0 && summary.uniqueInsights.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-gray-600 text-xs text-center py-8">
            <Brain size={32} className="mb-3 opacity-40" />
            <p className="text-gray-500 font-medium">Analyzing responses...</p>
            <p className="text-gray-600 mt-1">Comparing what each model says</p>
          </div>
        )}
      </div>
    </div>
  );
}
