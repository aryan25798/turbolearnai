'use client';
import { useState, useEffect, useRef, useMemo } from 'react';
import { Search, Plus, FileText, Share2, Sparkles, Command, ArrowRight } from 'lucide-react';

interface CommandPaletteProps {
  onNewChat: () => void;
  onExportFlashcards: () => void;
  onExportConversation: () => void;
  onShareSession: () => void;
  onClose: () => void;
  sessions: { id: string; title: string }[];
  onSelectSession: (id: string) => void;
  currentSessionId: string | null;
}

export default function CommandPalette({
  onNewChat, onExportFlashcards, onExportConversation, onShareSession, onClose,
  sessions, onSelectSession, currentSessionId,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const actions = useMemo(() => [
    { icon: <Plus size={16} />, label: 'New Chat', shortcut: '⌘N', action: onNewChat },
    { icon: <Sparkles size={16} />, label: 'Export Flashcards', shortcut: '', action: onExportFlashcards },
    { icon: <FileText size={16} />, label: 'Export Conversation as Markdown', shortcut: '', action: onExportConversation },
    { icon: <Share2 size={16} />, label: 'Share Session', shortcut: '', action: onShareSession },
  ], [onNewChat, onExportFlashcards, onExportConversation, onShareSession]);

  const filteredSessions = useMemo(() =>
    sessions.filter(s =>
      s.title.toLowerCase().includes(query.toLowerCase()) && s.id !== currentSessionId
    ),
    [sessions, query, currentSessionId]
  );

  const filteredActions = useMemo(() =>
    actions.filter(a => a.label.toLowerCase().includes(query.toLowerCase())),
    [actions, query]
  );

  const allItems = useMemo(() =>
    [...filteredActions, ...filteredSessions.map(s => ({ icon: <ArrowRight size={16} />, label: s.title, shortcut: '', id: s.id }))],
    [filteredActions, filteredSessions]
  );

  useEffect(() => {
    inputRef.current?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex(i => Math.min(i + 1, actions.length + filteredSessions.length - 1)); }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIndex(i => Math.max(i - 1, 0)); }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (selectedIndex < actions.length) {
          const action = actions[selectedIndex];
          action.action();
          onClose();
        } else {
          const sessionIdx = selectedIndex - actions.length;
          if (filteredSessions[sessionIdx]) {
            onSelectSession(filteredSessions[sessionIdx].id);
            onClose();
          }
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [query, selectedIndex, onClose, actions, filteredSessions, onSelectSession]);

  const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    setSelectedIndex(0);
    if (listRef.current) listRef.current.scrollTop = 0;
  };

  const handleSelect = (item: (typeof allItems)[number]) => {
    if ('action' in item) {
      (item as (typeof actions)[number]).action();
    } else {
      onSelectSession((item as { id: string }).id);
    }
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] bg-black/60 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-[#1e1f20] border border-white/10 w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden animate-in slide-in-from-top-4 duration-200">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5">
          <Search size={18} className="text-gray-500 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={handleQueryChange}
            placeholder="Type a command or search sessions..."
            className="flex-1 bg-transparent text-gray-100 placeholder-gray-500 text-sm focus:outline-none"
          />
          <kbd className="hidden sm:inline-flex items-center gap-1 px-2 py-1 text-[10px] font-mono text-gray-500 bg-white/5 rounded border border-white/10">
            <Command size={10} /> K
          </kbd>
        </div>

        <div ref={listRef} className="max-h-80 overflow-y-auto custom-scrollbar p-2 space-y-0.5">
          {allItems.length === 0 && (
            <div className="text-center py-8 text-gray-500 text-sm">No results found</div>
          )}
          {allItems.map((item, i) => (
            <button
              key={`${item.label}-${i}`}
              onClick={() => handleSelect(item)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors text-left ${
                i === selectedIndex ? 'bg-blue-600/20 text-blue-100 border border-blue-500/30' : 'text-gray-300 hover:bg-white/5'
              }`}
            >
              <span className="shrink-0">{item.icon}</span>
              <span className="truncate flex-1">{item.label}</span>
              {item.shortcut && (
                <kbd className="text-[10px] font-mono text-gray-500 bg-white/5 px-1.5 py-0.5 rounded border border-white/10">{item.shortcut}</kbd>
              )}
            </button>
          ))}
        </div>

        <div className="px-4 py-2 border-t border-white/5 flex items-center gap-4 text-[10px] text-gray-600">
          <span><kbd className="font-mono bg-white/5 px-1 rounded">↑↓</kbd> Navigate</span>
          <span><kbd className="font-mono bg-white/5 px-1 rounded">↵</kbd> Select</span>
          <span><kbd className="font-mono bg-white/5 px-1 rounded">Esc</kbd> Close</span>
        </div>
      </div>
    </div>
  );
}
