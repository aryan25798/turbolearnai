'use client';
import { useState } from 'react';
import { Share2, Link, Check, Loader2, Globe, Lock } from 'lucide-react';

interface ShareSessionProps {
  sessionId: string | null;
  onClose: () => void;
}

export default function ShareSession({ sessionId, onClose }: ShareSessionProps) {
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);

  const handleCreateLink = async () => {
    if (!sessionId) {
      setError('No session selected. Send a message first.');
      return;
    }
    setCreating(true);
    setError('');
    try {
      const token = Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
      const url = `${window.location.origin}/share/${token}`;
      setShareUrl(url);
    } catch {
      setError('Failed to create share link.');
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const textArea = document.createElement('textarea');
      textArea.value = shareUrl;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-[#0c0c0e] border border-white/10 w-full max-w-md rounded-2xl p-6 shadow-2xl relative">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-3 bg-blue-600/10 rounded-xl border border-blue-500/20 text-blue-400">
            <Share2 size={24} />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">Share Session</h3>
            <p className="text-xs text-gray-400">Create a read-only link to share</p>
          </div>
        </div>

        {error && (
          <div className="mb-4 px-4 py-2.5 bg-red-900/10 border border-red-500/20 rounded-xl text-red-400 text-xs">{error}</div>
        )}

        {!shareUrl ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-3 bg-black/20 rounded-xl border border-white/5">
              <Lock size={16} className="text-gray-500" />
              <span className="text-xs text-gray-400">Anyone with the link can view this conversation</span>
            </div>
            <button
              onClick={handleCreateLink}
              disabled={creating}
              className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {creating ? <Loader2 size={16} className="animate-spin" /> : <Globe size={16} />}
              {creating ? 'Creating...' : 'Create Share Link'}
            </button>
          </div>
        ) : (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2">
            <div className="flex items-center gap-2 p-3 bg-green-900/10 border border-green-500/20 rounded-xl">
              <Check size={16} className="text-green-400 shrink-0" />
              <span className="text-xs text-green-300">Link created</span>
            </div>
            <div className="flex items-center gap-2 p-3 bg-black/20 rounded-xl border border-white/5">
              <Link size={16} className="text-gray-500 shrink-0" />
              <input
                type="text"
                readOnly
                value={shareUrl}
                className="flex-1 bg-transparent text-gray-300 text-xs focus:outline-none truncate"
                onClick={(e) => (e.target as HTMLInputElement).select()}
              />
            </div>
            <div className="flex gap-3">
              <button onClick={onClose} className="flex-1 py-3 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 text-sm font-medium border border-white/10 transition-colors">
                Close
              </button>
              <button onClick={handleCopy} className="flex-1 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold transition-all flex items-center justify-center gap-2">
                {copied ? <Check size={16} /> : <CopyIcon />}
                {copied ? 'Copied!' : 'Copy Link'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CopyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}
