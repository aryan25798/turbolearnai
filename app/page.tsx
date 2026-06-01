'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic'; 

import { 
  Terminal, Cpu, Sparkles, Plus, Trash2, LogOut, Menu, X, User as UserIcon, 
  Mic, StopCircle, VolumeX, Camera, ScanText, Maximize2, Minimize2, ArrowLeft, Shield,
  Clock, ShieldAlert, History, Brain, Crown, LifeBuoy, WifiOff,
  Copy, Edit3, ThumbsUp, ThumbsDown, Download, RotateCcw, Search, ArrowDown, Check,
  Loader2, Share2,
} from 'lucide-react';
import { db, auth, storage } from '@/lib/firebase';
import { signOut, onAuthStateChanged, onIdTokenChanged, User } from 'firebase/auth';
import { 
  collection, addDoc, query, where, orderBy, onSnapshot, serverTimestamp, doc, getDoc, setDoc, updateDoc, Unsubscribe, limit, getDocs, Timestamp
} from 'firebase/firestore';
import { ref, uploadString, getDownloadURL } from 'firebase/storage';
import Login from '@/components/Login';
import CameraModal from '@/components/CameraModal';
import ErrorBoundary from '@/components/ErrorBoundary';
import ImageLightbox from '@/components/ImageLightbox';
import FlashcardExport from '@/components/FlashcardExport';
import CommandPalette from '@/components/CommandPalette';
import ShareSession from '@/components/ShareSession';
import SummaryColumn from '@/components/SynthesisColumn';

// ✅ DYNAMIC IMPORT: Lazy loads the heavy Markdown/Math renderer
const MarkdownRenderer = dynamic(() => import('@/components/MarkdownRenderer'), {
  loading: () => <div className="h-10 w-full animate-pulse rounded bg-[#2c2d2e]/50 mb-2" />,
  ssr: false // ✅ Disable SSR for chat content to avoid hydration mismatches
});

// --- TYPES ---
type Message = {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  image?: string | null;
  provider?: 'groq' | 'google' | 'deepseek'; 
  createdAt?: Timestamp;
  feedback?: 'up' | 'down' | null;
};

type Session = {
  id: string;
  userId: string;
  title: string;
  createdAt: Timestamp;
  deletedByUser?: boolean;
};

type QuotaData = {
  tier: 'free' | 'pro';
  limit: number | 'Unlimited';
  remaining: number | 'Unlimited';
  usage: number;
};

type UserStatus = 'loading' | 'approved' | 'pending' | 'banned' | 'new';

// --- UTILS ---
const sanitizeInput = (str: string) => str.replace(/[<>]/g, '');

// Safe localStorage wrappers — private browsing, storage quota, or sandboxed
// iframes will throw; these catch the error and degrade gracefully.
const safeLocalStorage = {
  getItem(key: string): string | null {
    try { return safeLocalStorage.getItem(key); } catch { return null; }
  },
  setItem(key: string, value: string): void {
    try { safeLocalStorage.setItem(key, value); } catch { /* quota exceeded / private browsing */ }
  },
  removeItem(key: string): void {
    try { safeLocalStorage.removeItem(key); } catch { /* best effort */ }
  }
};

// --- MODELS ---
const MODELS: Record<string, { id: string; name: string; provider: 'groq' | 'google' | 'deepseek'; supportsVision: boolean }> = {
  'gemini-3.5-flash': { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash', provider: 'google', supportsVision: true },
  'gemini-2.5-flash': { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'google', supportsVision: true },
  'gemini-1.5-flash': { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', provider: 'google', supportsVision: true },
  'llama-3.2-11b-vision': { id: 'llama-3.2-11b-vision-preview', name: 'Llama 3.2 11B Vision', provider: 'groq', supportsVision: true },
  'llama-3.3-70b': { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B', provider: 'groq', supportsVision: false },
  'deepseek-r1-native': { id: 'deepseek-reasoner', name: 'DeepSeek R1 (Native)', provider: 'deepseek', supportsVision: false },
  'deepseek-v3-native': { id: 'deepseek-chat', name: 'DeepSeek V3 (Native)', provider: 'deepseek', supportsVision: false },

  // --- 🌐 OpenRouter Free Models ---
  'or-qwen-vision-free': { id: 'nvidia/nemotron-nano-12b-v2-vl:free', name: 'NVIDIA VL (Free Photo 📷)', provider: 'google', supportsVision: true },
  'or-llama-vision-free': { id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Llama 3.3 70B (Free 💬)', provider: 'groq', supportsVision: false },
  'or-deepseek-r1-free': { id: 'deepseek/deepseek-r1:free', name: 'DeepSeek R1 (Free 💬)', provider: 'deepseek', supportsVision: false },
  'or-gemma-free': { id: 'openrouter/free', name: 'Auto Free Router (Free 💬)', provider: 'google', supportsVision: false },
  'or-llama31-8b-free': { id: 'meta-llama/llama-3.1-8b-instruct:free', name: 'Llama 3.1 8B (Free 💬)', provider: 'groq', supportsVision: false },
  'or-llama32-3b-free': { id: 'meta-llama/llama-3.2-3b-instruct:free', name: 'Llama 3.2 3B (Free 💬)', provider: 'groq', supportsVision: false },
  'or-qwen2-7b-free': { id: 'qwen/qwen-2.5-7b-instruct:free', name: 'Qwen 2.5 7B (Free 💬)', provider: 'google', supportsVision: false },
  'or-phi3-mini-free': { id: 'microsoft/phi-3-mini-128k-instruct:free', name: 'Phi-3 Mini 128K (Free 💬)', provider: 'google', supportsVision: false },
  'hf-mistral7b': { id: 'huggingface/mistralai/Mistral-7B-Instruct-v0.3', name: 'Mistral 7B (Free HF 💬)', provider: 'groq', supportsVision: false },

  // --- 🆕 Hugging Face Serverless Models ---
  'hf-phi3': { id: 'huggingface/microsoft/Phi-3-mini-4k-instruct', name: 'HF Phi-3 Mini (Serverless 💬)', provider: 'google', supportsVision: false },
  'hf-qwen-72b': { id: 'huggingface/Qwen/Qwen2.5-72B-Instruct', name: 'HF Qwen 72B (Serverless 💬)', provider: 'groq', supportsVision: false },
  'hf-deepseek-r1': { id: 'huggingface/deepseek-ai/DeepSeek-R1-Distill-Qwen-32B', name: 'DeepSeek R1 32B (Free HF 💬)', provider: 'deepseek', supportsVision: false }
};

// --- COMPONENTS ---

// 3. Status Screens
const StatusScreen = ({ icon, title, description, subtext, color }: {
  icon: React.ReactNode; title: string; description: string; subtext: string; color: string
}) => {
  const isRed = color === 'red';
  return (
  <div className="flex h-[100dvh] w-full items-center justify-center bg-[#050505] p-6 text-center animate-in fade-in zoom-in duration-500">
    <div className="max-w-md w-full bg-[#0c0c0e] border border-white/10 rounded-2xl p-8 shadow-2xl flex flex-col items-center">
      <div className={`w-20 h-20 rounded-full flex items-center justify-center mb-6 border ${isRed ? 'bg-red-500/10 border-red-500/20' : 'bg-yellow-500/10 border-yellow-500/20'}`}>
        {icon}
      </div>
      <h2 className="text-2xl font-bold text-white mb-3">{title}</h2>
      <p className="text-gray-400 text-sm leading-relaxed mb-6">{description}</p>
      
      <div className="w-full bg-[#111] rounded-lg p-3 border border-white/5 mb-6">
         <div className="flex items-center gap-2 justify-center mb-1">
            <div className={`w-2 h-2 rounded-full animate-pulse ${isRed ? 'bg-red-500' : 'bg-yellow-500'}`} />
            <span className={`text-xs font-bold uppercase tracking-widest ${isRed ? 'text-red-400' : 'text-yellow-400'}`}>Live Status</span>
         </div>
         <p className="text-[10px] text-gray-500">{subtext}</p>
      </div>

      <button onClick={() => signOut(auth)} className="flex items-center gap-2 px-6 py-2.5 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300 hover:text-white text-sm font-medium transition-all">
        <LogOut size={16} /> Sign Out
      </button>
    </div>
  </div>
  );
};

// ✅ NEW LIMIT EXCEEDED SCREEN
const LimitExceededScreen = () => (
  <div className="flex h-[100dvh] w-full items-center justify-center bg-[#050505] p-6 text-center animate-in fade-in zoom-in duration-500">
    <div className="max-w-md w-full bg-[#0c0c0e] border border-white/10 rounded-2xl p-8 shadow-2xl flex flex-col items-center relative overflow-hidden">
      <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-red-500 via-orange-500 to-red-500 animate-pulse" />
      
      <div className="w-20 h-20 rounded-full bg-red-500/10 flex items-center justify-center mb-6 border border-red-500/20">
        <ShieldAlert size={40} className="text-red-500" />
      </div>
      
      <h2 className="text-2xl font-bold text-white mb-2">Daily Limit Exhausted</h2>
      <p className="text-gray-400 text-sm leading-relaxed mb-6">
        You&apos;ve used all your free requests for today. 
        <br/>Upgrade to Pro for unlimited access.
      </p>
      
      <div className="flex gap-3 w-full">
        <button onClick={() => window.location.reload()} className="flex-1 px-4 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-sm font-medium text-gray-300 transition-colors">
           Check Again
        </button>
        <button onClick={() => signOut(auth)} className="flex-1 px-4 py-2.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-medium transition-colors">
           Sign Out
        </button>
      </div>
      
      <div className="mt-6 text-[10px] text-gray-600 uppercase tracking-widest">
         Contact Admin for Premium
      </div>
    </div>
  </div>
);

// --- MAIN APP ---
export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [accountStatus, setAccountStatus] = useState<UserStatus>('loading');
  
  // ✅ Quota State
  const [quotaData, setQuotaData] = useState<QuotaData | null>(null);

  // ✅ New Selected Model States for Three Columns
  const [modelCol1, setModelCol1] = useState<string>('llama-3.3-70b');
  const [modelCol2, setModelCol2] = useState<string>('gemini-2.5-flash');
  const [modelCol3, setModelCol3] = useState<string>('hf-deepseek-r1');

  // Load saved models from localStorage on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const m1 = safeLocalStorage.getItem('turboModelCol1');
      const m2 = safeLocalStorage.getItem('turboModelCol2');
      const m3 = safeLocalStorage.getItem('turboModelCol3');
      if (m1 && MODELS[m1]) setModelCol1(m1);
      if (m2 && MODELS[m2]) setModelCol2(m2);
      if (m3 && MODELS[m3]) setModelCol3(m3);
    }
  }, []);

  const handleModelChange = (col: 1 | 2 | 3, modelKey: string) => {
    if (col === 1) {
      setModelCol1(modelKey);
      safeLocalStorage.setItem('turboModelCol1', modelKey);
    } else if (col === 2) {
      setModelCol2(modelKey);
      safeLocalStorage.setItem('turboModelCol2', modelKey);
    } else {
      setModelCol3(modelKey);
      safeLocalStorage.setItem('turboModelCol3', modelKey);
    }
  };

  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const _pendingNewSessionRef = useRef(false);
  const _isSendingRef = useRef(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Focus Mode State
  const [focusedProvider, setFocusedProvider] = useState<'groq' | 'google' | 'deepseek' | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);

  // User Role State
  const [userRole, setUserRole] = useState<'user' | 'admin' | null>(null);

  // Media & Tools
  const [image, setImage] = useState<string | null>(null);
  const [imageUploading, setImageUploading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false); 
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);

  const [cameraMode, setCameraMode] = useState<'capture' | 'scan' | null>(null);

  // 🔴 Maintenance State
  const [deepseekError, setDeepseekError] = useState(false);
  
  // Offline detection
  const [isOffline, setIsOffline] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<{
    stop: () => void;
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    onstart: (() => void) | null;
    onend: (() => void) | null;
    onresult: ((event: { results: { [index: number]: { [index: number]: { transcript: string } } } }) => void) | null;
    start: () => void;
  } | null>(null); 
  const mountedRef = useRef(true);

  // Data
  const [groqMessages, setGroqMessages] = useState<Message[]>([]);
  const [googleMessages, setGoogleMessages] = useState<Message[]>([]);
  const [deepseekMessages, setDeepseekMessages] = useState<Message[]>([]);

  const showSummaryButton = useMemo(() => {
    const allProviders = ['groq', 'google', 'deepseek'] as const;
    const responsesCount = allProviders
      .map(p => ({ provider: p, msgs: p === 'groq' ? groqMessages : p === 'google' ? googleMessages : deepseekMessages }))
      .filter(({ msgs }) => msgs.some(m => m.role === 'assistant')).length;
    return responsesCount >= 2;
  }, [groqMessages, googleMessages, deepseekMessages]);

  // Auto-close synthesis sidebar if responses are cleared or less than 2
  useEffect(() => {
    if (!showSummaryButton) {
      setSummaryOpen(false);
    }
  }, [showSummaryButton]);

  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  
  // ⚡ FIX: Add loading state for sessions
  const [sessionsLoaded, setSessionsLoaded] = useState(false);

  const groqEndRef = useRef<HTMLDivElement>(null);
  const googleEndRef = useRef<HTMLDivElement>(null);
  const deepseekEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Scroll container refs
  const groqScrollRef = useRef<HTMLDivElement>(null);
  const googleScrollRef = useRef<HTMLDivElement>(null);
  const deepseekScrollRef = useRef<HTMLDivElement>(null);

  // Edit state
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');

  // Search state
  const [searchTerm, setSearchTerm] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll lock state
  const [isAtBottom, setIsAtBottom] = useState<Record<string, boolean>>({ groq: true, google: true, deepseek: true });

  // Keyboard shortcut refs
  const formRef = useRef<HTMLFormElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);

  const unsubUserRef = useRef<Unsubscribe | null>(null);

  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [flashcardExportOpen, setFlashcardExportOpen] = useState(false);
  const [shareSessionOpen, setShareSessionOpen] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Load sessions from Firestore (one-time fetch, not real-time listener)
  const loadSessions = useCallback(async (uid: string, autoSelectRecent: boolean = false) => {
    try {
      const q = query(
        collection(db, 'sessions'), 
        where('userId', '==', uid),
        where('deletedByUser', '==', false),
        orderBy('createdAt', 'desc'),
        limit(50)
      );
      const snapshot = await getDocs(q);
      if (!mountedRef.current) return;
      
      const valid = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Session));
      
      setSessions(valid);
      setSessionsLoaded(true);

      // Validate or auto-select session
      const storedId = safeLocalStorage.getItem('turboLastSession');
      if (storedId) {
        if (valid.find(s => s.id === storedId)) {
          setCurrentSessionId(storedId);
        } else {
          setCurrentSessionId(null);
          safeLocalStorage.removeItem('turboLastSession');
        }
      } else if (autoSelectRecent && valid.length > 0) {
        const lastSessionId = valid[0].id;
        setCurrentSessionId(lastSessionId);
        safeLocalStorage.setItem('turboLastSession', lastSessionId);
      }
    } catch (err) {
      console.error("Failed to load sessions:", err);
      if (mountedRef.current) setSessionsLoaded(true);
    }
  }, []);

  // Load chat messages for a session (one-time fetch)
  const loadChatMessages = useCallback(async (sessionId: string) => {
    try {
      const q = query(
        collection(db, 'chats'), 
        where('sessionId', '==', sessionId),
        orderBy('createdAt', 'asc')
      );
      const snapshot = await getDocs(q);
      if (!mountedRef.current) return;
      
      const allMessages = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Message));

      setGroqMessages(allMessages.filter(m => m.provider === 'groq'));
      setGoogleMessages(allMessages.filter(m => m.provider === 'google'));
      setDeepseekMessages(allMessages.filter(m => m.provider === 'deepseek'));
    } catch (err) {
      console.error("Failed to load chat messages:", err);
    }
  }, []);

  // 1. AUTH & INIT
  useEffect(() => {
    mountedRef.current = true;
    if (typeof window !== 'undefined') {
        setSidebarOpen(window.innerWidth >= 1024); 
    }

    // --- OFFLINE DETECTION ---
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    const unsubAuth = onAuthStateChanged(auth, async (currentUser) => {
      if (unsubUserRef.current) { unsubUserRef.current(); unsubUserRef.current = null; }

      if (currentUser) {
        setUser(currentUser);
        setAuthLoading(true);

        const userRef = doc(db, 'users', currentUser.uid);
        
        try {
            const docSnap = await getDoc(userRef);
            if (!docSnap.exists()) {
                await setDoc(userRef, {
                    uid: currentUser.uid,
                    email: currentUser.email,
                    displayName: currentUser.displayName || 'User',
                    photoURL: currentUser.photoURL,
                    role: 'user', 
                    status: 'pending', 
                    tier: 'free', 
                    customQuota: 50,
                    createdAt: serverTimestamp(),
                    lastLogin: serverTimestamp()
                });
            } else {
                await updateDoc(userRef, { lastLogin: serverTimestamp() });
            }
        } catch (err) {
            console.error("Error creating/updating user profile:", err);
        }

        // Keep real-time listener on user doc (critical for ban detection)
        const unsubUser = onSnapshot(userRef, (docSnap) => {
             const data = docSnap.data();
             if (data) {
                 setUserRole(data.role);
                 if (data.role === 'admin') {
                     setAccountStatus('approved');
                 } else {
                     setAccountStatus(data.status as UserStatus);
                 }
             }
             setAuthLoading(false);
        });
        unsubUserRef.current = unsubUser;

        // --- PERSIST CHAT ON REFRESH ---
        const savedSessionId = safeLocalStorage.getItem('turboLastSession');
        
        if (savedSessionId) {
             setCurrentSessionId(savedSessionId);
             loadSessions(currentUser.uid, false);
        } else {
             // Fetch sessions and automatically select the most recent one if no saved session exists
             loadSessions(currentUser.uid, true);
        }

      } else {
        setSessions([]); setGroqMessages([]); setGoogleMessages([]); setDeepseekMessages([]);
        safeLocalStorage.removeItem('turboLastSession');
        setUser(null);
        setAccountStatus('loading'); 
        setAuthLoading(false);
        setQuotaData(null);
        setSessionsLoaded(false);
      }
    });

    // Token refresh listener — prevents 403 errors on expired tokens
    const unsubToken = onIdTokenChanged(auth, async (user) => {
      if (user) {
        try { await user.getIdToken(true); } catch { /* token refresh failed silently */ }
      }
    });

    return () => {
        mountedRef.current = false;
        unsubAuth();
        unsubToken();
        if (unsubUserRef.current) unsubUserRef.current();
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
        // Abort any in-flight requests on unmount
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
          abortControllerRef.current = null;
        }
    };
  }, [loadSessions]);

  // ✅ NEW: SMART QUOTA FETCH (Fixes 403 Error)
  // Only fetches quota when we are SURE the user is approved or admin.
  useEffect(() => {
    if (user && (accountStatus === 'approved' || userRole === 'admin')) {
        const fetchQuotaData = async () => {
          try {
            const token = await auth.currentUser?.getIdToken();
            const headers: Record<string, string> = {};
            if (token) {
              headers['Authorization'] = `Bearer ${token}`;
            }
            const res = await fetch(`/api/quota?userId=${user.uid}`, { headers });
            if (res.status === 403) return; // Gracefully handle if still forbidden
            const data = await res.json();
            if (data && !data.error) setQuotaData(data);
          } catch (err) {
            console.error("Quota fetch failed", err);
          }
        };
        fetchQuotaData();
    }
  }, [user, accountStatus, userRole]);

  // 2. LOAD CHAT (one-time fetch — streamed responses update local state directly)
  useEffect(() => {
    // When a new session was just created in handleSearch, the user message
    // has already been added to local state. Skip clearing + reloading here
    // to avoid wiping that message before Firestore finishes persisting it.
    if (_pendingNewSessionRef.current) return;

    const isValidSession = sessions.find(s => s.id === currentSessionId);

    if (currentSessionId && user && accountStatus === 'approved' && sessionsLoaded && isValidSession) {
      setGroqMessages([]); setGoogleMessages([]); setDeepseekMessages([]);
      setDeepseekError(false);
      loadChatMessages(currentSessionId);
    } else {
      setGroqMessages([]); setGoogleMessages([]); setDeepseekMessages([]);
      setDeepseekError(false);
    }
  }, [currentSessionId, user, accountStatus, sessionsLoaded, sessions, loadChatMessages]); 

  useEffect(() => { 
      if ((!focusedProvider || focusedProvider === 'groq') && isAtBottom.groq) groqEndRef.current?.scrollIntoView({ behavior: 'smooth' }); 
  }, [groqMessages, focusedProvider, isAtBottom.groq]);
  
  useEffect(() => { 
      if ((!focusedProvider || focusedProvider === 'google') && isAtBottom.google) googleEndRef.current?.scrollIntoView({ behavior: 'smooth' }); 
  }, [googleMessages, focusedProvider, isAtBottom.google]);

  useEffect(() => { 
      if ((!focusedProvider || focusedProvider === 'deepseek') && isAtBottom.deepseek) deepseekEndRef.current?.scrollIntoView({ behavior: 'smooth' }); 
  }, [deepseekMessages, focusedProvider, isAtBottom.deepseek]);

  // --- ACTIONS ---
  const handleLogout = async () => { 
      if (unsubUserRef.current) { unsubUserRef.current(); unsubUserRef.current = null; }
      await signOut(auth); 
      startNewChat(); 
  };
  
  const startNewChat = () => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setCurrentSessionId(null);
    safeLocalStorage.removeItem('turboLastSession');
    setGroqMessages([]); setGoogleMessages([]); setDeepseekMessages([]);
    setDeepseekError(false); 
    setImage(null);
    stopSpeaking();
    setFocusedProvider(null);
    if (window.innerWidth < 1024) setSidebarOpen(false);
  };

  const selectSession = (sessId: string) => {
    setCurrentSessionId(sessId);
    setDeepseekError(false); 
    safeLocalStorage.setItem('turboLastSession', sessId);
    if (window.innerWidth < 1024) setSidebarOpen(false);
  };

  const deleteSession = async (e: React.MouseEvent, sessId: string) => {
    e.stopPropagation();
    if (!confirm("Delete this chat from history?")) return;

    try {
      await updateDoc(doc(db, 'sessions', sessId), { deletedByUser: true });
      if (currentSessionId === sessId) startNewChat();
      setSessions(prev => prev.filter(s => s.id !== sessId));
    } catch (error) {
      console.error("Error deleting session:", error);
      alert("Failed to delete session. Please try again.");
    }
  };

  // --- MEDIA ---
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) { alert("File too large. Max 5MB."); return; }
      setImageUploading(true);
      // Compress image client-side via canvas to reduce base64 payload size
      const img = new Image();
      const blobUrl = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(blobUrl);
        const MAX_DIM = 1200;
        let { width, height } = img;
        if (width > MAX_DIM || height > MAX_DIM) {
          if (width > height) { height = Math.round(height * MAX_DIM / width); width = MAX_DIM; }
          else { width = Math.round(width * MAX_DIM / height); height = MAX_DIM; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) { alert("Failed to process image."); setImageUploading(false); return; }
        ctx.drawImage(img, 0, 0, width, height);
        setImage(canvas.toDataURL('image/jpeg', 0.8));
        setImageUploading(false);
      };
      img.onerror = () => { URL.revokeObjectURL(blobUrl); alert("Failed to read image file."); setImageUploading(false); };
      img.src = blobUrl;
    }
  };

  const toggleVoiceInput = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }
    if (!('webkitSpeechRecognition' in window)) {
      alert("Voice input requires Chrome/Edge.");
      return;
    }
    const SpeechRecognitionConstructor = (window as typeof window & Record<string, unknown>).webkitSpeechRecognition as new () => NonNullable<typeof recognitionRef.current>;
    const recognition = new SpeechRecognitionConstructor();
    if (!recognition) return;
    recognitionRef.current = recognition;
    recognition.continuous = false; recognition.interimResults = false; recognition.lang = 'en-US';
    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => setIsListening(false);
    recognition.onresult = (event: { results: { [index: number]: { [index: number]: { transcript: string } } } }) => {
      const transcript = event.results[0][0].transcript;
      setInput(prev => prev + (prev ? ' ' : '') + transcript);
    };
    recognition.start();
  };

  const toggleSpeak = (text: string, msgId: string) => {
    if (isSpeaking && speakingMessageId === msgId) {
        stopSpeaking();
        return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    const preferredVoice = voices.find(v => v.name.includes('Google US English') || v.name.includes('Samantha'));
    if (preferredVoice) utterance.voice = preferredVoice;

    utterance.onstart = () => { setIsSpeaking(true); setSpeakingMessageId(msgId); };
    utterance.onend = () => { setIsSpeaking(false); setSpeakingMessageId(null); };
    utterance.onerror = () => { setIsSpeaking(false); setSpeakingMessageId(null); };
    window.speechSynthesis.speak(utterance);
  };

  const stopSpeaking = () => { 
      window.speechSynthesis.cancel(); 
      setIsSpeaking(false); 
      setSpeakingMessageId(null);
  };

  const stopGenerating = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setLoading(false);
    }
  };

  const streamAnswer = async (provider: 'groq' | 'google' | 'deepseek', currentHistory: Message[], sessId: string, signal: AbortSignal, imgData: string | null, modelId: string) => {
    const tempId = 'temp_' + Date.now();
    try {
      // ✅ OPTIMIZED PAYLOAD CONSTRUCTION
      // This solves "Payload Too Large" and preserves history.
      const apiHistory = currentHistory.map((msg, index) => {
          let content: string | { type: string; text?: string; image?: string }[] = msg.content;

          // 🧠 Intelligent Image Handling:
          // If this is a PAST message (not the new one at the end), and it has an image:
          // We MUST use the URL version (from Firestore) to avoid sending huge Base64 strings.
          // Note: The LAST message's image is handled separately by the 'image' param in the body.
          if (index < currentHistory.length - 1 && msg.role === 'user' && msg.image) {
              // Only attach if it's a URL (prevents 413 Errors)
              if (msg.image.startsWith('http')) {
                  content = [
                    { type: 'text', text: msg.content },
                    { type: 'image', image: msg.image }
                  ];
              }
          }
          
          return { role: msg.role, content };
      });

      const token = await auth.currentUser?.getIdToken();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch('/api/ask', {
        method: 'POST',
        headers,
        body: JSON.stringify({ 
            messages: apiHistory, 
            provider, 
            model: modelId, // Pass the dynamic model ID
            image: imgData, // Send the NEW image (Base64) separately
            userId: user?.uid 
        }),
        signal: signal
      });

      // 🛑 HANDLE MAINTENANCE / ERRORS 
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({})); 
        
        if (response.status === 503 || errorData.code === 'DEEPSEEK_MAINTENANCE') {
           if (provider === 'deepseek') {
               setDeepseekError(true); 
           }
           return; 
        }
        
        if (response.status === 429 && errorData.code === 'QUOTA_EXCEEDED') {
            setQuotaData(prev => prev ? { ...prev, remaining: 0 } : null);
            return;
        }
        
        // Generic server error — show message instead of silently failing
        const errorMessage = errorData?.error || `Server error (${response.status})`;
        const errorTempId = 'error_' + Date.now();
        let setErrorState;
        if (provider === 'groq') setErrorState = setGroqMessages;
        else if (provider === 'google') setErrorState = setGoogleMessages;
        else setErrorState = setDeepseekMessages;
        setErrorState(prev => [...prev, { id: errorTempId, role: 'assistant', content: `⚠️ ${errorMessage}`, provider }]);
        return;
      }

      setQuotaData(prev => {
          if (!prev || prev.remaining === 'Unlimited' || prev.remaining <= 0) return prev;
          return { ...prev, remaining: prev.remaining - 1, usage: prev.usage + 1 };
      });

      // Read the resolved model from response headers to detect fallbacks!
      const actualModelId = response.headers.get('X-Resolved-Model');
      const fallbackApplied = response.headers.get('X-Fallback-Applied') === 'true';

      let fallbackText = '';
      if (fallbackApplied && actualModelId) {
        const modelsEntry = Object.entries(MODELS).find(([, val]) => val.id === actualModelId);
        if (modelsEntry) {
          const modelKey = modelsEntry[0];
          fallbackText = `> ⚠️ **Auto-Fallback**: Switched to **${modelsEntry[1].name}** due to API rate limits.\n\n`;
          
          // Auto change dropdown state dynamically!
          if (provider === 'groq') {
            setModelCol1(modelKey);
            safeLocalStorage.setItem('turboModelCol1', modelKey);
          } else if (provider === 'google') {
            setModelCol2(modelKey);
            safeLocalStorage.setItem('turboModelCol2', modelKey);
          } else {
            setModelCol3(modelKey);
            safeLocalStorage.setItem('turboModelCol3', modelKey);
          }
        }
      }

      console.log(`[streamAnswer ${provider}] response.ok=${response.ok} status=${response.status} model=${modelId} actualModel=${response.headers.get('X-Resolved-Model')} fallbackApplied=${response.headers.get('X-Fallback-Applied')} body=`, !!response.body);

      if (!response.body) {
        console.log(`[streamAnswer ${provider}] response.body is NULL — streaming disabled or empty response`);
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let done = false;
      let fullResponse = fallbackText;
      
      let chunkCount = 0;
      while (!done) {
        const { value, done: doneReading } = await reader.read();
        done = doneReading;
        if (done) {
          console.log(`[streamAnswer ${provider}] stream done after ${chunkCount} chunks, fullResponse so far length=${fullResponse.length}`);
          break;
        }
        const chunkValue = decoder.decode(value, { stream: true });
        chunkCount++;
        if (chunkCount <= 2) console.log(`[streamAnswer ${provider}] chunk#${chunkCount} length=${chunkValue.length} preview="${chunkValue.substring(0, 80)}"`);
        fullResponse += chunkValue;
        
        let updateState;
        if (provider === 'groq') updateState = setGroqMessages;
        else if (provider === 'google') updateState = setGoogleMessages;
        else updateState = setDeepseekMessages;

        updateState(prev => {
          const lastMsg = prev[prev.length - 1];
          if (lastMsg && lastMsg.id === tempId) {
            return [...prev.slice(0, -1), { ...lastMsg, content: fullResponse }];
          }
          return [...prev, { id: tempId, role: 'assistant', content: fullResponse, provider }];
        });
      }

      console.log(`[streamAnswer ${provider}] finished. fullResponse length=${fullResponse.length}`, fullResponse.substring(0, 200));

      addDoc(collection(db, 'chats'), { 
          sessionId: sessId, 
          role: 'assistant', 
          content: fullResponse, 
          provider, 
          createdAt: serverTimestamp() 
      }).catch(e => console.error("Error saving chat:", e));

    } catch (err: unknown) { 
        if (err instanceof Error && err.name !== 'AbortError') {
          console.error(err);
          // Append error indicator so the user knows the response is incomplete
          const errorIndicator = '\n\nResponse interrupted. The connection was lost. Please click Regenerate to retry.';
          let setErrorState;
          if (provider === 'groq') setErrorState = setGroqMessages;
          else if (provider === 'google') setErrorState = setGoogleMessages;
          else setErrorState = setDeepseekMessages;
          setErrorState(prev => {
            const lastMsg = prev[prev.length - 1];
            if (lastMsg && lastMsg.id === tempId) {
              return [...prev.slice(0, -1), { ...lastMsg, content: lastMsg.content + errorIndicator }];
            }
            return prev;
          });
        }
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanInput = sanitizeInput(input); 
    if ((!cleanInput.trim() && !image) || !user) return;
    
    // Prevent double-submit: React 18 batches state updates, so loading
    // can be stale when handleSearch fires a second time rapidly.
    if (_isSendingRef.current) return;
    _isSendingRef.current = true;
    
    if (loading) stopGenerating();
    stopSpeaking(); 
    setLoading(true);
    setInput('');
    setDeepseekError(false); 
    
    const localImageBase64 = image; 
    setImage(null);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    let activeSessionId = currentSessionId;
    if (!activeSessionId) {
      try {
        const docRef = await addDoc(collection(db, 'sessions'), {
          userId: user.uid,
          title: cleanInput.substring(0, 30) + (cleanInput.length > 30 ? '...' : '') || "Image Query",
          createdAt: serverTimestamp(),
          deletedByUser: false
        });
        activeSessionId = docRef.id;
        _pendingNewSessionRef.current = true;
        setCurrentSessionId(activeSessionId);
        setSessions(prev => [{ id: docRef.id, userId: user.uid, title: cleanInput.substring(0, 30) + (cleanInput.length > 30 ? '...' : '') || "Image Query", createdAt: { seconds: Date.now() / 1000 } } as Session, ...prev]);
        safeLocalStorage.setItem('turboLastSession', activeSessionId);
      } catch (err) {
        console.error("Failed to create session:", err);
        alert("Failed to create session. Check your connection.");
        setLoading(false);
        return;
      }
    }

    const tempId = 'temp_user_' + Date.now();
    
    const userMsg: Message = { 
        id: tempId, 
        role: 'user', 
        content: cleanInput, 
        image: localImageBase64, 
        provider: 'google' 
    };

    // Resolve models for each column slot
    const col1Model = MODELS[modelCol1];
    const col2Model = MODELS[modelCol2];
    const col3Model = MODELS[modelCol3];
    if (!col1Model || !col2Model || !col3Model) return;

    // Add user message to Column 1 (groq slot)
    if (!focusedProvider || focusedProvider === 'groq') {
        setGroqMessages(prev => [...prev, { ...userMsg, provider: 'groq' }]);
    }

    // Add user message to Column 2 (google slot)
    if (!focusedProvider || focusedProvider === 'google') {
        setGoogleMessages(prev => [...prev, { ...userMsg, provider: 'google' }]);
    }

    // Add user message to Column 3 (deepseek slot)
    if (!focusedProvider || focusedProvider === 'deepseek') {
        setDeepseekMessages(prev => [...prev, { ...userMsg, provider: 'deepseek' }]);
    }

    // Fire-and-forget: persist user message to Firestore without blocking responses.
    // This runs in background and catches errors silently — stream answers do not depend on it.
    // Always writes regardless of image vs text-only — otherwise the message disappears on reload.
    (async () => {
        let downloadUrl: string | null = null;
        if (localImageBase64) {
            try {
                const storageRef = ref(storage, `chat-images/${user.uid}/${activeSessionId}/${Date.now()}.jpg`);
                await uploadString(storageRef, localImageBase64, 'data_url');
                downloadUrl = await getDownloadURL(storageRef);
            } catch (err) {
                console.warn("⚠️ Firebase Storage unavailable. Storing Base64 directly:", err);
                downloadUrl = localImageBase64;
            }
        }
        const msgBase = { sessionId: activeSessionId, role: 'user' as const, content: cleanInput, createdAt: serverTimestamp() };
        if (!focusedProvider || focusedProvider === 'groq') {
            addDoc(collection(db, 'chats'), { ...msgBase, image: downloadUrl, provider: 'groq' })
                .catch(e => console.error("Failed to save message:", e));
        }
        if (!focusedProvider || focusedProvider === 'google') {
            addDoc(collection(db, 'chats'), { ...msgBase, image: downloadUrl, provider: 'google' })
                .catch(e => console.error("Failed to save message:", e));
        }
        if (!focusedProvider || focusedProvider === 'deepseek') {
            addDoc(collection(db, 'chats'), { ...msgBase, image: downloadUrl, provider: 'deepseek' })
                .catch(e => console.error("Failed to save message:", e));
        }
    })();

    const promises = [];

    // If Column 1 doesn't support vision, fallback directly in frontend
    if (localImageBase64 && !col1Model.supportsVision) {
        if (!focusedProvider || focusedProvider === 'groq') {
            setTimeout(() => {
                const fallbackMsg = { id: 'fallback_' + Date.now(), role: 'assistant' as const, content: "This model doesn't take photos as input.", provider: 'groq' as const };
                setGroqMessages(prev => [...prev, fallbackMsg]);
                addDoc(collection(db, 'chats'), { 
                    sessionId: activeSessionId!, role: 'assistant', content: "This model doesn't take photos as input.", 
                    provider: 'groq', createdAt: serverTimestamp() 
                }).catch(e => console.error("Failed to save message:", e));
            }, 500);
        }
    } else {
        if (!focusedProvider || focusedProvider === 'groq') {
            promises.push(streamAnswer('groq', [...groqMessages, { ...userMsg, provider: 'groq' }], activeSessionId!, controller.signal, localImageBase64, col1Model.id));
        }
    }

    // If Column 2 doesn't support vision, fallback directly in frontend
    if (localImageBase64 && !col2Model.supportsVision) {
        if (!focusedProvider || focusedProvider === 'google') {
            setTimeout(() => {
                const fallbackMsg = { id: 'fallback_' + Date.now(), role: 'assistant' as const, content: "This model doesn't take photos as input.", provider: 'google' as const };
                setGoogleMessages(prev => [...prev, fallbackMsg]);
                addDoc(collection(db, 'chats'), { 
                    sessionId: activeSessionId!, role: 'assistant', content: "This model doesn't take photos as input.", 
                    provider: 'google', createdAt: serverTimestamp() 
                }).catch(e => console.error("Failed to save message:", e));
            }, 500);
        }
    } else {
        if (!focusedProvider || focusedProvider === 'google') {
            promises.push(streamAnswer('google', [...googleMessages, { ...userMsg, provider: 'google' }], activeSessionId!, controller.signal, localImageBase64, col2Model.id));
        }
    }

    // If Column 3 doesn't support vision, fallback directly in frontend
    if (localImageBase64 && !col3Model.supportsVision) {
        if (!focusedProvider || focusedProvider === 'deepseek') {
            setTimeout(() => {
                const fallbackMsg = { id: 'fallback_' + Date.now(), role: 'assistant' as const, content: "This model doesn't take photos as input.", provider: 'deepseek' as const };
                setDeepseekMessages(prev => [...prev, fallbackMsg]);
                addDoc(collection(db, 'chats'), { 
                    sessionId: activeSessionId!, role: 'assistant', content: "This model doesn't take photos as input.", 
                    provider: 'deepseek', createdAt: serverTimestamp() 
                }).catch(e => console.error("Failed to save message:", e));
            }, 500);
        }
    } else {
        if (!focusedProvider || focusedProvider === 'deepseek') {
            promises.push(streamAnswer('deepseek', [...deepseekMessages, { ...userMsg, provider: 'deepseek' }], activeSessionId!, controller.signal, localImageBase64, col3Model.id));
        }
    }

    try {
        await Promise.allSettled(promises);
    } catch (err) {
        console.error("Stream/Upload error", err);
    } finally {
        setLoading(false); 
        abortControllerRef.current = null;
        _pendingNewSessionRef.current = false;
        _isSendingRef.current = false;
    }
  };

  // --- REGENERATE: re-query a single provider with the last user message ---
  const regenerateColumn = async (provider: 'groq' | 'google' | 'deepseek') => {
    let messages: Message[];
    let setMessages: React.Dispatch<React.SetStateAction<Message[]>>;

    if (provider === 'groq') {
      messages = groqMessages;
      setMessages = setGroqMessages;
    } else if (provider === 'google') {
      messages = googleMessages;
      setMessages = setGoogleMessages;
    } else {
      messages = deepseekMessages;
      setMessages = setDeepseekMessages;
    }

    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    if (!lastUserMsg || !currentSessionId || loading) return;

    const lastIsAssistant = messages.length > 0 && messages[messages.length - 1].role === 'assistant';
    const history = lastIsAssistant ? messages.slice(0, -1) : messages;
    setMessages(history);

    const modelKey = provider === 'groq' ? modelCol1 : provider === 'google' ? modelCol2 : modelCol3;
    const modelObj = MODELS[modelKey];
    if (!modelObj) return;

    // Use a separate controller per column so regenerating one doesn't kill others
    const controller = new AbortController();

    // Extract image from last user message so regeneration preserves vision context
    const imgData = lastUserMsg.image || null;

    await streamAnswer(provider, history, currentSessionId, controller.signal, imgData, modelObj.id);
  };

  // --- EDIT: start editing a user message ---
  const handleStartEdit = (msg: Message) => {
    setEditingMessageId(msg.id || null);
    setEditContent(msg.content);
  };

  const handleCancelEdit = () => {
    setEditingMessageId(null);
    setEditContent('');
  };

  const handleSaveEdit = async (msgId: string) => {
    if (!editContent.trim() || !currentSessionId || !user) return;
    const editedContent = sanitizeInput(editContent);
    setEditingMessageId(null);

    updateDoc(doc(db, 'chats', msgId), { content: editedContent }).catch(e => console.error("Failed to update message:", e));

    const processProvider = (messages: Message[]): Message[] => {
      const idx = messages.findIndex(m => m.id === msgId);
      if (idx === -1) return messages;
      return [...messages.slice(0, idx), { ...messages[idx], content: editedContent }];
    };

    const groqMsgs = processProvider(groqMessages);
    const googleMsgs = processProvider(googleMessages);
    const deepseekMsgs = processProvider(deepseekMessages);

    setGroqMessages(groqMsgs);
    setGoogleMessages(googleMsgs);
    setDeepseekMessages(deepseekMsgs);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    setLoading(true);

    const col1Model = MODELS[modelCol1];
    const col2Model = MODELS[modelCol2];
    const col3Model = MODELS[modelCol3];

    const promises: Promise<void>[] = [];

    if (!focusedProvider || focusedProvider === 'groq') {
      promises.push(streamAnswer('groq', groqMsgs, currentSessionId, abortController.signal, null, col1Model.id));
    }
    if (!focusedProvider || focusedProvider === 'google') {
      promises.push(streamAnswer('google', googleMsgs, currentSessionId, abortController.signal, null, col2Model.id));
    }
    if (!focusedProvider || focusedProvider === 'deepseek') {
      promises.push(streamAnswer('deepseek', deepseekMsgs, currentSessionId, abortController.signal, null, col3Model.id));
    }

    try {
      await Promise.allSettled(promises);
    } catch (err) {
      console.error("Re-query error", err);
    } finally {
      setLoading(false);
      abortControllerRef.current = null;
    }
  };

  // --- FEEDBACK: thumbs up/down on assistant messages ---
  const handleFeedback = async (msgId: string, feedback: 'up' | 'down') => {
    if (!msgId) return;

    const allMessages = [...groqMessages, ...googleMessages, ...deepseekMessages];
    const msg = allMessages.find(m => m.id === msgId);
    const newFeedback = msg?.feedback === feedback ? null : feedback;

    try {
      await updateDoc(doc(db, 'chats', msgId), { feedback: newFeedback });
    } catch (e) {
      console.error("Failed to update feedback:", e);
      return;
    }

    const updateFeedback = (prev: Message[]) => prev.map(m => m.id === msgId ? { ...m, feedback: newFeedback } : m);
    setGroqMessages(updateFeedback);
    setGoogleMessages(updateFeedback);
    setDeepseekMessages(updateFeedback);
  };

  // --- EXPORT: download current conversation as Markdown ---
  const exportConversation = () => {
    const allMessages = [...groqMessages, ...googleMessages, ...deepseekMessages]
      .sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));

    if (allMessages.length === 0) return;

    const markdown = allMessages.map(m =>
      `## ${m.role === 'user' ? 'You' : 'Assistant'}${m.provider ? ` (${m.provider})` : ''}\n\n${m.content}`
    ).join('\n\n---\n\n');

    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chat-export-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // --- SCROLL HANDLER for auto-scroll lock ---
  const handleScroll = useCallback((provider: string, e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const threshold = 100;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    setIsAtBottom(prev => ({ ...prev, [provider]: atBottom }));
  }, []);

  // --- KEYBOARD SHORTCUTS ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;

      if (isMod && e.key === 'Enter') {
        if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') {
          e.preventDefault();
          if (formRef.current) {
            formRef.current.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
          }
        }
      }

      if (isMod && e.key === 'n') {
        e.preventDefault();
        startNewChat();
      }

      if (isMod && e.key === 'k') {
        e.preventDefault();
        setCommandPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [startNewChat]);


  if (authLoading) return <div className="flex h-[100dvh] items-center justify-center bg-[#131314] text-white"><Cpu size={48} className="text-purple-500 animate-pulse" /></div>;
  if (!user) return <Login />;

  if (accountStatus === 'banned') return <StatusScreen color="red" icon={<ShieldAlert size={40} className="text-red-500" />} title="Access Revoked" description="Your account has been flagged and banned." subtext="You are currently locked out." />;
  if (accountStatus === 'pending') return <StatusScreen color="yellow" icon={<Clock size={40} className="text-yellow-500 animate-pulse" />} title="Verification Pending" description="Your account is waiting for approval." subtext="Wait here. This page will unlock automatically." />;

  if (quotaData?.tier !== 'pro' && typeof quotaData?.remaining === 'number' && quotaData.remaining <= 0) {
      return <LimitExceededScreen />;
  }

  return (
    <div className="flex h-[100dvh] bg-[#131314] text-gray-100 font-sans overflow-hidden selection:bg-purple-500/30 selection:text-white relative">
      
      {cameraMode && (
        <CameraModal 
          mode={cameraMode}
          onClose={() => setCameraMode(null)}
          onCapture={(imgSrc) => { setImage(imgSrc); setCameraMode(null); }}
          onScan={(text) => { setInput(text); setCameraMode(null); }}
        />
      )}

      {commandPaletteOpen && (
        <CommandPalette
          onNewChat={startNewChat}
          onExportFlashcards={() => { setCommandPaletteOpen(false); setFlashcardExportOpen(true); }}
          onExportConversation={() => { exportConversation(); setCommandPaletteOpen(false); }}
          onShareSession={() => { setCommandPaletteOpen(false); setShareSessionOpen(true); }}
          onClose={() => setCommandPaletteOpen(false)}
          sessions={sessions}
          onSelectSession={selectSession}
          currentSessionId={currentSessionId}
        />
      )}

      {flashcardExportOpen && (
        <FlashcardExport
          messages={[...groqMessages, ...googleMessages, ...deepseekMessages]}
          onClose={() => setFlashcardExportOpen(false)}
        />
      )}

      {shareSessionOpen && (
        <ShareSession
          sessionId={currentSessionId}
          onClose={() => setShareSessionOpen(false)}
        />
      )}

      {lightboxImage && (
        <ImageLightbox src={lightboxImage} onClose={() => setLightboxImage(null)} />
      )}

      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 lg:hidden backdrop-blur-sm transition-opacity"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside 
        className={`fixed lg:static inset-y-0 left-0 z-50 flex flex-col bg-[#1e1f20] border-r border-white/5 transition-all duration-300 ease-in-out shadow-2xl
          ${sidebarOpen ? 'translate-x-0 w-[280px]' : '-translate-x-full lg:translate-x-0 lg:w-0 lg:border-none lg:overflow-hidden'}
        `}
      >
        <div className="p-4 flex flex-col gap-4 min-w-[280px]">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
                <button 
                onClick={() => setSidebarOpen(false)} 
                className="p-2 text-gray-400 hover:bg-[#333537] hover:text-white rounded-full transition-colors active:scale-95"
                title="Close Menu"
                aria-label="Close sidebar menu"
                >
                <Menu size={20} />
                </button>
                <span className="text-sm font-bold text-gray-200 tracking-wide">TurboLearn</span>
            </div>
            
            {quotaData?.tier === 'pro' ? (
                <span className="flex items-center gap-1 text-[9px] font-bold bg-yellow-900/20 text-yellow-400 px-2 py-1 rounded border border-yellow-500/30 uppercase tracking-wide">
                    <Crown size={10} fill="currentColor" /> Pro
                </span>
            ) : (
                <span className="flex items-center gap-1 text-[9px] font-bold bg-white/5 text-gray-400 px-2 py-1 rounded border border-white/10 uppercase tracking-wide">
                    Free
                </span>
            )}
          </div>

          {quotaData && quotaData.tier !== 'pro' && (
              <div className="mx-2 px-3 py-2 bg-black/20 rounded-lg border border-white/5">
                  <div className="flex justify-between items-center mb-1">
                      <span className="text-[10px] text-gray-400 uppercase font-bold tracking-widest">Daily Limit</span>
                      <span className="text-[10px] text-white font-mono">{quotaData.remaining}/{quotaData.limit}</span>
                  </div>
                  <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden">
                      <div 
                          className="h-full bg-blue-500 transition-all duration-500" 
                          style={{ width: `${Math.min(100, ((quotaData.usage || 0) / (quotaData.limit as number || 50)) * 100)}%` }} 
                      />
                  </div>
              </div>
          )}

           {userRole === 'admin' && (
              <button 
                onClick={() => window.location.href='/admin'} 
                className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-red-900/15 text-red-400 border border-red-500/20 hover:bg-red-900/25 transition-all text-[10px] font-bold uppercase tracking-wider"
              >
                <Shield size={12} /> Admin
              </button>
           )}

          <button onClick={startNewChat} className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#1a1b1c] hover:bg-[#333537] transition-all text-xs font-medium text-gray-300 border border-white/5 active:scale-95">
            <Plus size={16} className="text-gray-400" /> New chat
          </button>

          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search conversations..."
              className="w-full bg-[#1e1f20] text-gray-200 placeholder-gray-500 text-xs rounded-lg pl-8 pr-3 py-2 border border-white/5 focus:outline-none focus:border-white/20 transition-colors"
            />
            {searchTerm && (
              <button onClick={() => setSearchTerm('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white transition-colors">
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar px-3 min-w-[280px]">
          <div className="text-[11px] font-bold text-gray-500 mb-2 px-3 mt-2 uppercase tracking-widest flex items-center gap-2">
             <History size={12} /> Recent
          </div>
          <div className="space-y-1">
            {(searchTerm ? sessions.filter(s => s.title.toLowerCase().includes(searchTerm.toLowerCase())) : sessions).map((sess) => (
              <div key={sess.id} onClick={() => selectSession(sess.id)}
                className={`group flex items-center justify-between px-4 py-3 rounded-xl cursor-pointer text-sm transition-all border border-transparent min-h-[44px] ${
                  currentSessionId === sess.id 
                    ? 'bg-blue-600/15 text-blue-100 border-blue-500/20 font-medium' 
                    : 'text-gray-400 hover:bg-[#282a2c] hover:text-gray-200 active:bg-[#333537]'
                }`}>
                <span className="truncate w-44 text-[13px]">{sess.title}</span>
                <button 
                    onClick={(e) => deleteSession(e, sess.id)} 
                    className="text-gray-500 hover:text-red-400 p-2 transition-colors md:opacity-0 group-hover:opacity-100 focus:opacity-100 active:opacity-100 opacity-100"
                    title="Delete Chat"
                    aria-label="Delete this chat session"
                >
                    <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="px-4 mb-2 min-w-[280px]">
          <div className="grid grid-cols-2 gap-1.5">
            <button
              onClick={exportConversation}
              className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10 hover:text-gray-200 transition-all text-[11px] font-medium"
              title="Export conversation as Markdown"
            >
               <Download size={14} /> 
               Export
            </button>
            <button
              onClick={() => setShareSessionOpen(true)}
              className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10 hover:text-gray-200 transition-all text-[11px] font-medium"
              title="Share session as read-only link"
            >
               <Share2 size={14} /> 
               Share
            </button>
            <button
              onClick={() => setFlashcardExportOpen(true)}
              className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10 hover:text-gray-200 transition-all text-[11px] font-medium"
              title="Export flashcards from this session"
            >
               <Sparkles size={14} /> 
               Cards
            </button>
            <button 
              onClick={() => window.location.href='/support'}
              className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-blue-900/10 text-blue-400 border border-blue-500/20 hover:bg-blue-900/20 transition-all text-[11px] font-medium"
              title="Contact support"
            >
               <LifeBuoy size={14} /> 
               Help
            </button>
          </div>
        </div>

        <div className="p-3 mt-auto border-t border-white/5 bg-[#171819] min-w-[280px]">
          <div className="flex items-center gap-2.5 px-2 py-2 hover:bg-[#2c2d2e] rounded-xl cursor-pointer transition-colors group" onClick={handleLogout}>
              {user.photoURL ? <img src={user.photoURL} alt="User avatar" className="w-7 h-7 rounded-full border border-gray-600 group-hover:border-gray-400 transition-colors shrink-0" /> : <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center shrink-0"><UserIcon size={14} /></div>}
              <div className="text-xs font-medium truncate flex-1 text-gray-300">{user.displayName}</div>
              <LogOut size={14} className="text-gray-500 group-hover:text-gray-300 transition-colors shrink-0" />
          </div>
        </div>
      </aside>

      <main 
        className={`flex-1 flex flex-col h-[100dvh] relative bg-[#131314] w-full min-w-0 transition-all duration-300 ${isDragging ? 'ring-2 ring-blue-500/50 ring-inset' : ''}`}
        onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true); }}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true); }}
        onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(false); }}
        onDrop={(e) => {
          e.preventDefault(); e.stopPropagation(); setIsDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file && file.type.startsWith('image/')) {
            if (file.size > 5 * 1024 * 1024) { alert('File too large. Max 5MB.'); return; }
            setImageUploading(true);
            const reader = new FileReader();
            reader.onloadend = () => { setImage(reader.result as string); setImageUploading(false); };
            reader.onerror = () => { alert('Failed to read image file.'); setImageUploading(false); };
            reader.readAsDataURL(file);
          }
        }}
      >
        
        {/* OFFLINE BANNER */}
        {isOffline && (
          <div className="flex-none flex items-center justify-center gap-2 px-4 py-2 bg-red-900/30 border-b border-red-500/30 text-red-300 text-xs font-medium z-50 animate-in slide-in-from-top">
            <WifiOff size={14} /> You are offline. Please reconnect before sending messages.
          </div>
        )}

        <div className="flex-none h-14 md:h-16 flex items-center px-3 md:px-4 z-40 bg-[#131314]/80 backdrop-blur-md border-b border-white/5 justify-between relative shrink-0">
          <div className={`flex items-center transition-opacity duration-300 ${sidebarOpen ? 'lg:opacity-0 pointer-events-none' : 'opacity-100'}`}>
             <button 
              onClick={() => setSidebarOpen(true)}
              className="p-2 text-gray-400 hover:bg-[#2c2d2e]/80 hover:text-white rounded-xl transition-colors active:scale-95 pointer-events-auto"
              aria-label="Open sidebar menu"
            >
              <Menu size={22} />
            </button>
          </div>

          <div className="absolute left-1/2 transform -translate-x-1/2 font-bold text-lg md:text-xl tracking-tighter bg-gradient-to-r from-blue-400 via-purple-400 to-orange-400 bg-clip-text text-transparent select-none pointer-events-none hidden sm:block">
            TurboLearn AI
          </div>

          {/* Model indicators */}
          {!focusedProvider && (
            <div className="hidden md:flex items-center gap-2 absolute left-1/2 transform -translate-x-1/2 translate-y-6 mt-1">
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-orange-400" />
                <span className="text-[9px] text-gray-500 font-mono truncate max-w-[60px]">{MODELS[modelCol1]?.name.split(' ').slice(0,2).join(' ') || 'Llama'}</span>
              </div>
              <span className="text-gray-700 text-[8px]">+</span>
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                <span className="text-[9px] text-gray-500 font-mono truncate max-w-[60px]">{MODELS[modelCol2]?.name.split(' ').slice(0,2).join(' ') || 'Gemini'}</span>
              </div>
              <span className="text-gray-700 text-[8px]">+</span>
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />
                <span className="text-[9px] text-gray-500 font-mono truncate max-w-[60px]">{MODELS[modelCol3]?.name.split(' ').slice(0,2).join(' ') || 'DeepSeek'}</span>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2">
            {isSpeaking && (
                <button onClick={stopSpeaking} className="flex items-center gap-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 backdrop-blur-md text-red-400 px-4 py-1.5 rounded-full shadow-lg transition-all animate-pulse text-xs font-bold z-50 pointer-events-auto">
                <VolumeX size={14} /> <span className="hidden md:inline">Stop</span>
                </button>
            )}
            {showSummaryButton && (
              <button 
                onClick={() => setSummaryOpen(prev => !prev)} 
                className={`flex items-center gap-2 px-4 py-1.5 rounded-full border shadow-lg transition-all text-xs font-bold pointer-events-auto active:scale-95 z-50
                  ${summaryOpen 
                    ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40 shadow-emerald-500/10' 
                    : 'bg-emerald-500/5 hover:bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:border-emerald-500/30'}`}
                title="AI Summary — see what the models agree on"
              >
                <Brain size={14} className={summaryOpen ? "animate-pulse" : ""} />
                <span>AI Summary</span>
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-hidden p-2 md:p-4 pb-0 pt-0 flex flex-col relative z-0">
          <div className={`w-full h-full mx-auto transition-all duration-300 overflow-hidden
             ${focusedProvider ? 'max-w-4xl' : 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 md:gap-3 lg:gap-4'} 
          `}>
            
            {(!focusedProvider || focusedProvider === 'groq') && (
              <ErrorBoundary>
              <div className={`flex flex-col rounded-2xl bg-[#1e1f20] border border-[#2c2d2e] shadow-xl relative overflow-hidden transition-all duration-300 min-h-0 h-full
                ${focusedProvider === 'groq' ? 'ring-2 ring-orange-500/30 shadow-[0_0_50px_rgba(249,115,22,0.1)]' : ''} 
              `}>
                <div className="flex items-center justify-between px-4 py-3 bg-[#1e1f20]/95 backdrop-blur-sm border-b border-[#2c2d2e] sticky top-0 z-10">
                  <div className="flex items-center gap-2">
                    {focusedProvider === 'groq' && <button onClick={() => setFocusedProvider(null)}><ArrowLeft size={18} className="text-gray-400 hover:text-white mr-2" /></button>}
                    <Cpu size={16} className="text-orange-400" />
                    <select 
                      value={modelCol1} 
                      onChange={(e) => handleModelChange(1, e.target.value)}
                      className="bg-[#2c2d2e]/50 hover:bg-[#333537] text-gray-200 font-medium text-xs rounded-lg px-2 py-1 border border-white/10 focus:outline-none cursor-pointer transition-colors max-w-[170px]"
                    >
                      {Object.entries(MODELS).map(([key, m]) => (
                        <option key={key} value={key} className="bg-[#1e1f20] text-gray-200 text-xs">
                          {m.name} {m.supportsVision ? '📷' : '💬'}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button 
                    onClick={() => setFocusedProvider(focusedProvider === 'groq' ? null : 'groq')}
                    className="p-1.5 text-gray-500 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                    title={focusedProvider === 'groq' ? "Minimize" : "Focus Mode"}
                  >
                    {focusedProvider === 'groq' ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                  </button>
                </div>
                <div ref={groqScrollRef} className="flex-1 p-3 md:p-5 overflow-y-auto custom-scrollbar pb-5" onScroll={(e) => handleScroll('groq', e)}>
                  {!currentSessionId && groqMessages.length === 0 && (
                    <div className="h-full flex flex-col gap-3 items-center justify-center text-gray-600 px-6">
                      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-orange-500/20 to-orange-600/10 flex items-center justify-center border border-orange-500/10">
                        <Cpu size={32} className="text-orange-400/60" />
                      </div>
                      <span className="text-sm font-medium text-gray-500">Llama</span>
                      <span className="text-[11px] text-gray-600 text-center max-w-[200px] leading-relaxed">Ask a question to get started</span>
                    </div>
                  )}
                  {groqMessages.map((m, i) => (
                    <div key={m.id || `msg-groq-${i}`} className={`mb-6 flex ${m.role === 'user' ? 'justify-end' : 'justify-start'} group`}>
                      <div className={`max-w-[95%] md:max-w-[90%] relative ${m.role === 'user' ? 'bg-[#2c2d2e] px-4 py-3 rounded-2xl rounded-tr-none' : 'px-1'}`}>

                        <button
                          onClick={() => navigator.clipboard.writeText(m.content)}
                          className="absolute -top-2 -right-2 p-1.5 text-gray-500 hover:text-white hover:bg-[#2c2d2e] rounded-lg transition-all opacity-0 group-hover:opacity-100 z-10"
                          title="Copy message"
                          aria-label="Copy message text"
                        >
                          <Copy size={14} />
                        </button>

                        {m.role === 'user' && editingMessageId !== m.id && (
                          <button
                            onClick={() => handleStartEdit(m)}
                            className="absolute -top-2 right-6 p-1.5 text-gray-500 hover:text-white hover:bg-[#2c2d2e] rounded-lg transition-all opacity-0 group-hover:opacity-100 z-10"
                            title="Edit message"
                            aria-label="Edit this message"
                          >
                            <Edit3 size={14} />
                          </button>
                        )}

                        {m.image && (
                          <div className="mb-3 cursor-pointer" onClick={() => m.image && setLightboxImage(m.image)}>
                            <img src={m.image} alt="User uploaded image" className="max-h-48 rounded-lg border border-[#3c3d3e] object-contain bg-black/50 hover:opacity-80 transition-opacity" />
                          </div>
                        )}

                        <div className="prose prose-invert max-w-none text-gray-100 text-sm leading-relaxed break-words">
                          {editingMessageId === m.id ? (
                            <div className="flex flex-col gap-2">
                              <textarea
                                value={editContent}
                                onChange={(e) => setEditContent(e.target.value)}
                                className="w-full bg-[#1e1f20] text-gray-100 rounded-lg px-3 py-2 border border-white/10 focus:outline-none focus:border-blue-500/50 text-sm resize-none"
                                rows={3}
                                autoFocus
                              />
                              <div className="flex gap-2 justify-end">
                                <button onClick={handleCancelEdit} className="px-3 py-1 text-xs rounded-lg bg-[#2c2d2e] text-gray-300 hover:text-white transition-colors">
                                  Cancel
                                </button>
                                <button onClick={() => handleSaveEdit(m.id || '')} className="px-3 py-1 text-xs rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition-colors">
                                  <Check size={12} className="inline mr-1" /> Save
                                </button>
                              </div>
                            </div>
                          ) : m.role === 'user' ? (
                            <p>{m.content}</p>
                          ) : (
                            <MarkdownRenderer content={m.content} msgId={m.id || `groq-${i}`} isSpeaking={speakingMessageId === (m.id || `groq-${i}`)} onToggleSpeak={toggleSpeak} />
                          )}
                        </div>

                        {m.role === 'assistant' && editingMessageId !== m.id && (
                          <div className="flex items-center gap-1 mt-2">
                            <button
                              onClick={() => regenerateColumn('groq')}
                              className="p-1.5 text-gray-500 hover:text-white hover:bg-[#2c2d2e] rounded-lg transition-all opacity-0 group-hover:opacity-100"
                              title="Regenerate"
                              aria-label="Regenerate response"
                            >
                              <RotateCcw size={14} />
                            </button>
                            <button
                              onClick={() => handleFeedback(m.id || '', 'up')}
                              className={`p-1.5 rounded-lg transition-all ${m.feedback === 'up' ? 'text-green-400 bg-green-500/10' : 'text-gray-500 hover:text-white hover:bg-[#2c2d2e] opacity-0 group-hover:opacity-100'}`}
                              title="Helpful"
                              aria-label="Mark as helpful"
                            >
                              <ThumbsUp size={14} />
                            </button>
                            <button
                              onClick={() => handleFeedback(m.id || '', 'down')}
                              className={`p-1.5 rounded-lg transition-all ${m.feedback === 'down' ? 'text-red-400 bg-red-500/10' : 'text-gray-500 hover:text-white hover:bg-[#2c2d2e] opacity-0 group-hover:opacity-100'}`}
                              title="Not helpful"
                              aria-label="Mark as not helpful"
                            >
                              <ThumbsDown size={14} />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  {!isAtBottom.groq && groqMessages.length > 0 && (
                    <div className="sticky bottom-2 flex justify-center">
                      <button
                        onClick={() => { groqEndRef.current?.scrollIntoView({ behavior: 'smooth' }); setIsAtBottom(prev => ({ ...prev, groq: true })); }}
                        className="bg-[#2c2d2e] text-gray-300 hover:text-white px-3 py-1.5 rounded-full text-xs border border-white/10 shadow-lg transition-all flex items-center gap-1"
                      >
                        <ArrowDown size={14} /> Scroll to bottom
                      </button>
                    </div>
                  )}
                  <div ref={groqEndRef} />
                </div>
              </div>
              </ErrorBoundary>
            )}

            {(!focusedProvider || focusedProvider === 'google') && (
              <ErrorBoundary>
              <div className={`flex flex-col rounded-2xl bg-[#1e1f20] border border-[#2c2d2e] shadow-xl overflow-hidden transition-all duration-300 min-h-0 h-full
                ${focusedProvider === 'google' ? 'ring-2 ring-blue-500/30 shadow-[0_0_50px_rgba(59,130,246,0.1)]' : ''}
              `}>
                <div className="flex items-center justify-between px-4 py-3 bg-[#1e1f20]/95 backdrop-blur-sm border-b border-[#2c2d2e] sticky top-0 z-10">
                  <div className="flex items-center gap-2">
                    {focusedProvider === 'google' && <button onClick={() => setFocusedProvider(null)}><ArrowLeft size={18} className="text-gray-400 hover:text-white mr-2" /></button>}
                    <Sparkles size={16} className="text-blue-400" />
                    <select 
                      value={modelCol2} 
                      onChange={(e) => handleModelChange(2, e.target.value)}
                      className="bg-[#2c2d2e]/50 hover:bg-[#333537] text-gray-200 font-medium text-xs rounded-lg px-2 py-1 border border-white/10 focus:outline-none cursor-pointer transition-colors max-w-[170px]"
                    >
                      {Object.entries(MODELS).map(([key, m]) => (
                        <option key={key} value={key} className="bg-[#1e1f20] text-gray-200 text-xs">
                          {m.name} {m.supportsVision ? '📷' : '💬'}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button 
                    onClick={() => setFocusedProvider(focusedProvider === 'google' ? null : 'google')}
                    className="p-1.5 text-gray-500 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                    title={focusedProvider === 'google' ? "Minimize" : "Focus Mode"}
                  >
                    {focusedProvider === 'google' ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                  </button>
                </div>
                <div ref={googleScrollRef} className="flex-1 p-3 md:p-5 overflow-y-auto custom-scrollbar pb-5" onScroll={(e) => handleScroll('google', e)}>
                  {!currentSessionId && googleMessages.length === 0 && (
                    <div className="h-full flex flex-col gap-3 items-center justify-center text-gray-600 px-6">
                      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500/20 to-indigo-600/10 flex items-center justify-center border border-blue-500/10">
                        <Sparkles size={32} className="text-blue-400/60" />
                      </div>
                      <span className="text-sm font-medium text-gray-500">Gemini</span>
                      <span className="text-[11px] text-gray-600 text-center max-w-[200px] leading-relaxed">Powered by Google AI</span>
                    </div>
                  )}
                  {googleMessages.map((m, i) => (
                    <div key={m.id || `msg-google-${i}`} className={`mb-6 flex ${m.role === 'user' ? 'justify-end' : 'justify-start'} group`}>
                      <div className={`max-w-[95%] md:max-w-[90%] relative ${m.role === 'user' ? 'bg-[#2c2d2e] px-4 py-3 rounded-2xl rounded-tr-none' : 'px-1'}`}>

                        <button
                          onClick={() => navigator.clipboard.writeText(m.content)}
                          className="absolute -top-2 -right-2 p-1.5 text-gray-500 hover:text-white hover:bg-[#2c2d2e] rounded-lg transition-all opacity-0 group-hover:opacity-100 z-10"
                          title="Copy message"
                          aria-label="Copy message text"
                        >
                          <Copy size={14} />
                        </button>

                        {m.role === 'user' && editingMessageId !== m.id && (
                          <button
                            onClick={() => handleStartEdit(m)}
                            className="absolute -top-2 right-6 p-1.5 text-gray-500 hover:text-white hover:bg-[#2c2d2e] rounded-lg transition-all opacity-0 group-hover:opacity-100 z-10"
                            title="Edit message"
                            aria-label="Edit this message"
                          >
                            <Edit3 size={14} />
                          </button>
                        )}

                        {m.image && (
                          <div className="mb-3 cursor-pointer" onClick={() => m.image && setLightboxImage(m.image)}>
                            <img src={m.image} alt="User uploaded image" className="max-h-48 rounded-lg border border-[#3c3d3e] object-contain bg-black/50 hover:opacity-80 transition-opacity" />
                          </div>
                        )}

                        <div className="prose prose-invert max-w-none text-gray-100 text-sm leading-relaxed break-words">
                          {editingMessageId === m.id ? (
                            <div className="flex flex-col gap-2">
                              <textarea
                                value={editContent}
                                onChange={(e) => setEditContent(e.target.value)}
                                className="w-full bg-[#1e1f20] text-gray-100 rounded-lg px-3 py-2 border border-white/10 focus:outline-none focus:border-blue-500/50 text-sm resize-none"
                                rows={3}
                                autoFocus
                              />
                              <div className="flex gap-2 justify-end">
                                <button onClick={handleCancelEdit} className="px-3 py-1 text-xs rounded-lg bg-[#2c2d2e] text-gray-300 hover:text-white transition-colors">
                                  Cancel
                                </button>
                                <button onClick={() => handleSaveEdit(m.id || '')} className="px-3 py-1 text-xs rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition-colors">
                                  <Check size={12} className="inline mr-1" /> Save
                                </button>
                              </div>
                            </div>
                          ) : m.role === 'user' ? (
                            <p>{m.content}</p>
                          ) : (
                            <MarkdownRenderer content={m.content} msgId={m.id || `google-${i}`} isSpeaking={speakingMessageId === (m.id || `google-${i}`)} onToggleSpeak={toggleSpeak} />
                          )}
                        </div>

                        {m.role === 'assistant' && editingMessageId !== m.id && (
                          <div className="flex items-center gap-1 mt-2">
                            <button
                              onClick={() => regenerateColumn('google')}
                              className="p-1.5 text-gray-500 hover:text-white hover:bg-[#2c2d2e] rounded-lg transition-all opacity-0 group-hover:opacity-100"
                              title="Regenerate"
                              aria-label="Regenerate response"
                            >
                              <RotateCcw size={14} />
                            </button>
                            <button
                              onClick={() => handleFeedback(m.id || '', 'up')}
                              className={`p-1.5 rounded-lg transition-all ${m.feedback === 'up' ? 'text-green-400 bg-green-500/10' : 'text-gray-500 hover:text-white hover:bg-[#2c2d2e] opacity-0 group-hover:opacity-100'}`}
                              title="Helpful"
                              aria-label="Mark as helpful"
                            >
                              <ThumbsUp size={14} />
                            </button>
                            <button
                              onClick={() => handleFeedback(m.id || '', 'down')}
                              className={`p-1.5 rounded-lg transition-all ${m.feedback === 'down' ? 'text-red-400 bg-red-500/10' : 'text-gray-500 hover:text-white hover:bg-[#2c2d2e] opacity-0 group-hover:opacity-100'}`}
                              title="Not helpful"
                              aria-label="Mark as not helpful"
                            >
                              <ThumbsDown size={14} />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  {!isAtBottom.google && googleMessages.length > 0 && (
                    <div className="sticky bottom-2 flex justify-center">
                      <button
                        onClick={() => { googleEndRef.current?.scrollIntoView({ behavior: 'smooth' }); setIsAtBottom(prev => ({ ...prev, google: true })); }}
                        className="bg-[#2c2d2e] text-gray-300 hover:text-white px-3 py-1.5 rounded-full text-xs border border-white/10 shadow-lg transition-all flex items-center gap-1"
                      >
                        <ArrowDown size={14} /> Scroll to bottom
                      </button>
                    </div>
                  )}
                  <div ref={googleEndRef} />
                </div>
              </div>
              </ErrorBoundary>
            )}



            {(!focusedProvider || focusedProvider === 'deepseek') && (
              <ErrorBoundary>
              <div className={`flex flex-col rounded-2xl bg-[#1e1f20] border border-[#2c2d2e] shadow-xl overflow-hidden transition-all duration-300 min-h-0 h-full
                ${focusedProvider === 'deepseek' ? 'ring-2 ring-purple-500/30 shadow-[0_0_50px_rgba(168,85,247,0.1)]' : ''}
              `}>
                <div className="flex items-center justify-between px-4 py-3 bg-[#1e1f20]/95 backdrop-blur-sm border-b border-[#2c2d2e] sticky top-0 z-10">
                  <div className="flex items-center gap-2">
                    {focusedProvider === 'deepseek' && <button onClick={() => setFocusedProvider(null)}><ArrowLeft size={18} className="text-gray-400 hover:text-white mr-2" /></button>}
                    <Brain size={16} className="text-purple-400" />
                    <select 
                      value={modelCol3} 
                      onChange={(e) => handleModelChange(3, e.target.value)}
                      className="bg-[#2c2d2e]/50 hover:bg-[#333537] text-gray-200 font-medium text-xs rounded-lg px-2 py-1 border border-white/10 focus:outline-none cursor-pointer transition-colors max-w-[170px]"
                    >
                      {Object.entries(MODELS).map(([key, m]) => (
                        <option key={key} value={key} className="bg-[#1e1f20] text-gray-200 text-xs">
                          {m.name} {m.supportsVision ? '📷' : '💬'}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button 
                    onClick={() => setFocusedProvider(focusedProvider === 'deepseek' ? null : 'deepseek')}
                    className="p-1.5 text-gray-500 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                    title={focusedProvider === 'deepseek' ? "Minimize" : "Focus Mode"}
                  >
                    {focusedProvider === 'deepseek' ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                  </button>
                </div>
                <div ref={deepseekScrollRef} className="flex-1 p-3 md:p-5 overflow-y-auto custom-scrollbar pb-5 relative" onScroll={(e) => handleScroll('deepseek', e)}>
                  {!currentSessionId && deepseekMessages.length === 0 && !deepseekError && (
                    <div className="h-full flex flex-col gap-3 items-center justify-center text-gray-600 px-6">
                      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-500/20 to-violet-600/10 flex items-center justify-center border border-purple-500/10">
                        <Brain size={32} className="text-purple-400/60" />
                      </div>
                      <span className="text-sm font-medium text-gray-500">DeepSeek</span>
                      <span className="text-[11px] text-gray-600 text-center max-w-[200px] leading-relaxed">Advanced reasoning model</span>
                    </div>
                  )}

                  {deepseekMessages.map((m, i) => (
                    <div key={m.id || `msg-deepseek-${i}`} className={`mb-6 flex ${m.role === 'user' ? 'justify-end' : 'justify-start'} group`}>
                      <div className={`max-w-[95%] md:max-w-[90%] relative ${m.role === 'user' ? 'bg-[#2c2d2e] px-4 py-3 rounded-2xl rounded-tr-none' : 'px-1'}`}>

                        <button
                          onClick={() => navigator.clipboard.writeText(m.content)}
                          className="absolute -top-2 -right-2 p-1.5 text-gray-500 hover:text-white hover:bg-[#2c2d2e] rounded-lg transition-all opacity-0 group-hover:opacity-100 z-10"
                          title="Copy message"
                          aria-label="Copy message text"
                        >
                          <Copy size={14} />
                        </button>

                        {m.role === 'user' && editingMessageId !== m.id && (
                          <button
                            onClick={() => handleStartEdit(m)}
                            className="absolute -top-2 right-6 p-1.5 text-gray-500 hover:text-white hover:bg-[#2c2d2e] rounded-lg transition-all opacity-0 group-hover:opacity-100 z-10"
                            title="Edit message"
                            aria-label="Edit this message"
                          >
                            <Edit3 size={14} />
                          </button>
                        )}

                        {m.image && (
                          <div className="mb-3 cursor-pointer" onClick={() => m.image && setLightboxImage(m.image)}>
                            <img src={m.image} alt="User uploaded image" className="max-h-48 rounded-lg border border-[#3c3d3e] object-contain bg-black/50 hover:opacity-80 transition-opacity" />
                          </div>
                        )}

                        <div className="prose prose-invert max-w-none text-gray-100 text-sm leading-relaxed break-words">
                          {editingMessageId === m.id ? (
                            <div className="flex flex-col gap-2">
                              <textarea
                                value={editContent}
                                onChange={(e) => setEditContent(e.target.value)}
                                className="w-full bg-[#1e1f20] text-gray-100 rounded-lg px-3 py-2 border border-white/10 focus:outline-none focus:border-blue-500/50 text-sm resize-none"
                                rows={3}
                                autoFocus
                              />
                              <div className="flex gap-2 justify-end">
                                <button onClick={handleCancelEdit} className="px-3 py-1 text-xs rounded-lg bg-[#2c2d2e] text-gray-300 hover:text-white transition-colors">
                                  Cancel
                                </button>
                                <button onClick={() => handleSaveEdit(m.id || '')} className="px-3 py-1 text-xs rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition-colors">
                                  <Check size={12} className="inline mr-1" /> Save
                                </button>
                              </div>
                            </div>
                          ) : m.role === 'user' ? (
                            <p>{m.content}</p>
                          ) : (
                            <MarkdownRenderer content={m.content} msgId={m.id || `deepseek-${i}`} isSpeaking={speakingMessageId === (m.id || `deepseek-${i}`)} onToggleSpeak={toggleSpeak} />
                          )}
                        </div>

                        {m.role === 'assistant' && editingMessageId !== m.id && (
                          <div className="flex items-center gap-1 mt-2">
                            <button
                              onClick={() => regenerateColumn('deepseek')}
                              className="p-1.5 text-gray-500 hover:text-white hover:bg-[#2c2d2e] rounded-lg transition-all opacity-0 group-hover:opacity-100"
                              title="Regenerate"
                              aria-label="Regenerate response"
                            >
                              <RotateCcw size={14} />
                            </button>
                            <button
                              onClick={() => handleFeedback(m.id || '', 'up')}
                              className={`p-1.5 rounded-lg transition-all ${m.feedback === 'up' ? 'text-green-400 bg-green-500/10' : 'text-gray-500 hover:text-white hover:bg-[#2c2d2e] opacity-0 group-hover:opacity-100'}`}
                              title="Helpful"
                              aria-label="Mark as helpful"
                            >
                              <ThumbsUp size={14} />
                            </button>
                            <button
                              onClick={() => handleFeedback(m.id || '', 'down')}
                              className={`p-1.5 rounded-lg transition-all ${m.feedback === 'down' ? 'text-red-400 bg-red-500/10' : 'text-gray-500 hover:text-white hover:bg-[#2c2d2e] opacity-0 group-hover:opacity-100'}`}
                              title="Not helpful"
                              aria-label="Mark as not helpful"
                            >
                              <ThumbsDown size={14} />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}

                  {!isAtBottom.deepseek && deepseekMessages.length > 0 && (
                    <div className="sticky bottom-2 flex justify-center">
                      <button
                        onClick={() => { deepseekEndRef.current?.scrollIntoView({ behavior: 'smooth' }); setIsAtBottom(prev => ({ ...prev, deepseek: true })); }}
                        className="bg-[#2c2d2e] text-gray-300 hover:text-white px-3 py-1.5 rounded-full text-xs border border-white/10 shadow-lg transition-all flex items-center gap-1"
                      >
                        <ArrowDown size={14} /> Scroll to bottom
                      </button>
                    </div>
                  )}

                  {deepseekError && (
                      <div className="mt-4 p-4 rounded-xl bg-red-500/10 border border-red-500/20 flex flex-col items-center justify-center text-red-400 animate-in fade-in slide-in-from-bottom-2">
                           <ShieldAlert size={20} className="mb-2" />
                           <span className="text-sm font-bold">Under Maintenance</span>
                           <span className="text-[10px] opacity-70">DeepSeek R1 is currently unavailable.</span>
                      </div>
                  )}

                  <div ref={deepseekEndRef} />
                </div>
              </div>
              </ErrorBoundary>
            )}

          </div>
        </div>

        <div className="flex-none w-full p-3 md:p-6 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] md:pb-[calc(env(safe-area-inset-bottom,0px)+1.5rem)] bg-[#131314] z-20 border-t border-white/5">
          <div className={`mx-auto relative transition-all duration-300 ${focusedProvider ? 'max-w-3xl' : 'max-w-5xl'}`}>
            
            {image && (
              <div className="absolute -top-16 left-0 bg-[#1e1f20]/90 backdrop-blur-md p-2 rounded-xl border border-[#2c2d2e] flex items-center gap-3 shadow-2xl animate-in slide-in-from-bottom-2 z-10">
                <img src={image} alt="Attached preview" className="h-10 w-10 object-cover rounded-lg" />
                <span className="text-xs text-gray-400 font-medium">Image attached</span>
                <button onClick={() => setImage(null)} className="p-1 hover:text-red-400 text-gray-400 transition-colors" aria-label="Remove attached image"><X size={14}/></button>
              </div>
            )}

            <form ref={formRef} onSubmit={handleSearch} className="relative group">
              <textarea
                ref={chatInputRef as React.RefObject<HTMLTextAreaElement>}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  const el = e.target;
                  el.style.height = 'auto';
                  el.style.height = Math.min(el.scrollHeight, 200) + 'px';
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (formRef.current) formRef.current.requestSubmit();
                  }
                }}
                rows={1}
                placeholder={isListening ? "Listening..." : focusedProvider ? `Talk to ${focusedProvider === 'groq' ? 'Llama' : focusedProvider === 'deepseek' ? 'DeepSeek' : 'Gemini'}...` : "Ask anything..."}
                className={`w-full bg-[#1e1f20] text-gray-100 placeholder-gray-500 rounded-2xl py-3 md:py-4 pl-12 md:pl-14 pr-36 md:pr-40 
                  focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:bg-[#2c2d2e]
                  transition-all text-[15px] border border-[#2c2d2e] shadow-lg hover:shadow-xl resize-none overflow-y-auto min-h-[48px] max-h-[200px]
                  ${isListening ? 'border-red-500/50 bg-red-900/10' : ''}`}
                style={{ fontSize: '16px' }} 
              />
              
              <div className="absolute left-2 top-2 bottom-2 flex items-center gap-0 md:gap-1 rounded-full px-1">
                <button type="button" onClick={() => fileInputRef.current?.click()} disabled={imageUploading} className={`p-1.5 md:p-2 rounded-full transition-colors ${imageUploading ? 'text-blue-400 animate-pulse' : 'text-gray-400 hover:text-white hover:bg-white/10'}`} title="Upload Image" aria-label="Upload an image">{imageUploading ? <Loader2 size={18} className="animate-spin" /> : <Plus size={20} />}</button>
                <input type="file" ref={fileInputRef} onChange={handleImageUpload} accept="image/*" className="hidden" />
              </div>

              <div className="absolute right-2 top-2 bottom-2 flex items-center gap-1 md:gap-2">
                 <button type="button" onClick={() => setCameraMode('scan')} className="p-1.5 md:p-2 text-gray-400 hover:text-white rounded-full transition-colors hover:bg-white/10" title="Scan Text" aria-label="Scan text with camera"><ScanText size={18} /></button>
                 <button type="button" onClick={() => setCameraMode('capture')} className="p-1.5 md:p-2 text-gray-400 hover:text-white rounded-full transition-colors hover:bg-white/10" title="Camera" aria-label="Open camera"><Camera size={18} /></button>
                <button type="button" onClick={toggleVoiceInput} className={`p-2 md:p-2.5 rounded-full transition-all active:scale-90 ${isListening ? 'text-white bg-red-500 animate-pulse shadow-lg shadow-red-500/30' : 'text-gray-400 hover:text-white hover:bg-white/10'}`}>
                  <Mic size={20} />
                </button>
                <button 
                  type={loading ? 'button' : 'submit'} 
                  onClick={loading ? stopGenerating : undefined} 
                  className={`p-2 md:p-2.5 rounded-full transition-all active:scale-90 shadow-lg ${loading ? 'bg-white text-black' : 'bg-[#3c3d3e] text-white hover:bg-[#4a4b4d] disabled:opacity-50 disabled:bg-transparent disabled:shadow-none'}`} 
                  disabled={(!input.trim() && !image) && !loading}
                >
                  {loading ? <StopCircle size={20} fill="currentColor" /> : <Terminal size={20} />}
                </button>
              </div>
            </form>
          </div>
        </div>
      </main>

      {/* RIGHT SIDEBAR BACKDROP */}
      {summaryOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 lg:hidden backdrop-blur-sm transition-opacity"
          onClick={() => setSummaryOpen(false)}
        />
      )}

      {/* RIGHT SIDEBAR (AI SUMMARY) */}
      <aside 
        className={`fixed lg:static inset-y-0 right-0 z-50 flex flex-col bg-[#1e1f20] border-l border-white/5 transition-all duration-300 ease-in-out shadow-2xl
          ${summaryOpen ? 'translate-x-0 w-full sm:w-[380px] max-w-[90vw] lg:max-w-none' : 'translate-x-full lg:translate-x-0 lg:w-0 lg:border-none lg:overflow-hidden'}
        `}
      >
        <div className="h-full flex flex-col w-full max-w-[380px] lg:max-w-none min-w-0 relative">
          <div className="flex-1 min-h-0 overflow-hidden">
            <SummaryColumn
              messages={{ groq: groqMessages, google: googleMessages, deepseek: deepseekMessages }}
            />
          </div>
          {/* Close button inside sidebar on mobile */}
          <button 
            onClick={() => setSummaryOpen(false)}
            className="absolute top-3 right-3 p-1.5 text-gray-500 hover:text-white hover:bg-white/10 rounded-lg lg:hidden"
            aria-label="Close AI Summary panel"
          >
            <X size={16} />
          </button>
        </div>
      </aside>

    </div>
  );
}