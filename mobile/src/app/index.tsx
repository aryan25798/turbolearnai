import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  StyleSheet, Text, View, TextInput, TouchableOpacity, ScrollView,
  KeyboardAvoidingView, Platform, ActivityIndicator, Image, Alert, Keyboard,
  Animated, Dimensions, Modal, FlatList, Share
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  onAuthStateChanged, signOut,
  signInWithPopup, GoogleAuthProvider,
  signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendEmailVerification
} from 'firebase/auth';
import {
  onSnapshot, doc, getDocs, getDoc, collection, query, where, orderBy,
  addDoc, updateDoc, serverTimestamp, setDoc, limit
} from 'firebase/firestore';
import { auth, db, googleProvider } from '../lib/firebase';
import { askQuestion, fetchQuota, saveChatMessage, runOcr, ApiMessage, QuotaData } from '../lib/api';
import NetInfo from '@react-native-community/netinfo';
import * as ImagePicker from 'expo-image-picker';
import MarkdownRenderer from '../components/MarkdownRenderer';
import * as Speech from 'expo-speech';

let ExpoSpeechRecognitionModule: any = null;
let useSpeechRecognitionEvent: (event: string, callback: (e: any) => void) => void = () => {};

try {
  const speechModule = require('expo-speech-recognition');
  ExpoSpeechRecognitionModule = speechModule.ExpoSpeechRecognitionModule;
  if (ExpoSpeechRecognitionModule) {
    useSpeechRecognitionEvent = speechModule.useSpeechRecognitionEvent;
  } else {
    console.warn("⚠️ expo-speech-recognition native module is not available (running in Expo Go). Using dummy speech recognition hook.");
  }
} catch (e) {
  console.warn("⚠️ expo-speech-recognition native module is not available (running in Expo Go). Speech recognition will be disabled.");
}

type ModelKey = 'groq' | 'google' | 'deepseek';
type AccountStatus = 'loading' | 'new' | 'pending' | 'approved' | 'banned';

interface ModelDef {
  id: string;
  name: string;
  provider: ModelKey;
  supportsVision: boolean;
}

const MODELS: Record<string, ModelDef> = {
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

const DEFAULT_MODELS: Record<ModelKey, string> = {
  groq: 'llama-3.3-70b',
  google: 'gemini-2.5-flash',
  deepseek: 'hf-deepseek-r1',
};

// ── App Logging & Crash Interceptor ──
export const reportLog = async (
  level: 'crash' | 'error' | 'warning' | 'info',
  message: string,
  stack: string | null = null,
  userEmail: string | null = null
) => {
  try {
    const logData = {
      level,
      message: message || 'Unknown error',
      stack: stack || null,
      platform: Platform.OS,
      timestamp: serverTimestamp(),
      userEmail: userEmail || 'Anonymous',
      appVersion: '1.0.0'
    };
    await addDoc(collection(db, 'app_logs'), logData);
  } catch (err) {
    console.warn('Logging to Firestore failed:', err);
  }
};

// Global JS Crash Interceptor
try {
  const globalAny: any = global;
  const errorUtils = globalAny.ErrorUtils;
  if (errorUtils) {
    const defaultErrorHandler = errorUtils.getGlobalHandler();
    errorUtils.setGlobalHandler(async (error: any, isFatal?: boolean) => {
      try {
        const email = auth.currentUser?.email || 'Anonymous';
        await reportLog('crash', error?.message || 'Unhandled Runtime Crash', error?.stack || null, email);
      } catch (e) {
        console.error("Global crash logger error:", e);
      }
      if (defaultErrorHandler) {
        defaultErrorHandler(error, isFatal);
      }
    });
  }
} catch (e) {
  console.warn("Failed to set global crash handler:", e);
}

const TAB_LABELS: Record<ModelKey, string> = {
  groq: 'Llama',
  google: 'Gemini',
  deepseek: 'DeepSeek',
};

const TAB_ICONS: Record<ModelKey, any> = {
  groq: 'chatbox-ellipses-outline',
  google: 'flash-outline',
  deepseek: 'planet-outline',
};

const TAB_COLORS: Record<ModelKey, string> = {
  groq: '#8b5cf6',
  google: '#3b82f6',
  deepseek: '#10b981',
};

const QUICK_PROMPTS = [
  { text: '📝 Summarize study notes', icon: 'document-text-outline', prompt: 'Please summarize my study notes into clear bullet points with key takeaways:' },
  { text: '📐 Solve a math equation', icon: 'calculator-outline', prompt: 'Can you solve this mathematical equation step-by-step and explain the logic?' },
  { text: '💻 Explain code logic', icon: 'code-slash-outline', prompt: 'Please explain what this code snippet does and suggest any optimizations:\n\n' },
  { text: '💡 Brainstorm exam topics', icon: 'bulb-outline', prompt: 'I have an exam on this subject soon. Can you help me brainstorm the most critical topics to study?' },
];

const ENABLE_DEMO_LOGIN = process.env.EXPO_PUBLIC_ENABLE_DEMO_LOGIN === 'true';

const MAX_CHAT_MESSAGES_LOADED = 200;

interface SessionData {
  id: string;
  title: string;
  createdAt: any;
}

// ── Status Screens ──────────────────────────────────────────────────────────

function StatusScreen({ title, message, icon, color }: {
  title: string; message: string; icon: string; color: string;
}) {
  return (
    <View style={ss.center}>
      <Ionicons name={icon as any} size={56} color={color} />
      <Text style={ss.statusTitle}>{title}</Text>
      <Text style={ss.statusMessage}>{message}</Text>
    </View>
  );
}

function LimitExceededScreen({ onCheck, onSignOut }: { onCheck: () => void; onSignOut: () => void }) {
  return (
    <View style={ss.center}>
      <Ionicons name="speedometer-outline" size={56} color="#f59e0b" />
      <Text style={ss.statusTitle}>Daily Limit Exhausted</Text>
      <Text style={ss.statusMessage}>Your daily query limit has been reached. Upgrade to Pro for unlimited access.</Text>
      <View style={{ flexDirection: 'row', gap: 12, marginTop: 20 }}>
        <TouchableOpacity style={[ss.actionBtn, { backgroundColor: '#2c2d2e' }]} onPress={onCheck}>
          <Text style={{ color: '#fff', fontWeight: '600' }}>Check Again</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[ss.actionBtn, { backgroundColor: 'rgba(239,68,68,0.2)' }]} onPress={onSignOut}>
          <Text style={{ color: '#ef4444', fontWeight: '600' }}>Sign Out</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ── Support Modal ───────────────────────────────────────────────────────────

function SupportModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [supEmail, setSupEmail] = useState('');
  const [supMsg, setSupMsg] = useState('');
  const [supStatus, setSupStatus] = useState<'idle' | 'sending' | 'done'>('idle');
  const lastSubmitRef = useRef(0);
  const [supError, setSupError] = useState('');

  if (!visible) return null;

  const handleSubmit = async () => {
    setSupError('');
    if (!supEmail.trim() || !supMsg.trim()) return;
    const now = Date.now();
    if (now - lastSubmitRef.current < 60_000) {
      setSupError('Please wait at least 60 seconds between submissions.');
      return;
    }
    lastSubmitRef.current = now;
    setSupStatus('sending');
    try {
      await addDoc(collection(db, 'support_tickets'), {
        email: supEmail.trim(),
        message: supMsg.trim(),
        status: 'new',
        createdAt: serverTimestamp(),
      });
      setSupStatus('done');
      setTimeout(() => { onClose(); setSupStatus('idle'); setSupEmail(''); setSupMsg(''); }, 1500);
    } catch {
      setSupStatus('idle');
    }
  };

  return (
    <View style={ss.modalOverlay}>
      <View style={ss.modalContent}>
        <TouchableOpacity onPress={onClose} style={{ alignSelf: 'flex-end', padding: 4 }}>
          <Ionicons name="close" size={20} color="#6b7280" />
        </TouchableOpacity>
        <Text style={{ color: '#fff', fontSize: 18, fontWeight: 'bold', marginBottom: 4 }}>Contact Support</Text>
        <Text style={{ color: '#6b7280', fontSize: 12, marginBottom: 16 }}>Cannot log in? Leave a message.</Text>
        {supStatus === 'done' ? (
          <Text style={{ color: '#22c55e', textAlign: 'center', marginVertical: 20 }}>Message sent!</Text>
        ) : (
          <>
            <TextInput style={ss.modalInput} placeholder="Your email" placeholderTextColor="#4b5563"
              value={supEmail} onChangeText={setSupEmail} keyboardType="email-address" autoCapitalize="none" />
            <TextInput style={[ss.modalInput, { minHeight: 80 }]} placeholder="Describe your issue..."
              placeholderTextColor="#4b5563" value={supMsg} onChangeText={setSupMsg} multiline />
            {supError ? <Text style={{ color: '#ef4444', fontSize: 11, textAlign: 'center', marginBottom: 8 }}>{supError}</Text> : null}
            <TouchableOpacity style={ss.modalButton} onPress={handleSubmit} disabled={supStatus === 'sending'}>
              <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 14 }}>
                {supStatus === 'sending' ? 'Sending...' : 'Send Message'}
              </Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  );
}

// ── Model Selector Modal ────────────────────────────────────────────────────

function ModelSelectModal({ visible, onClose, provider, currentKey, onSelect, modelHealth }: {
  visible: boolean; onClose: () => void; provider: ModelKey;
  currentKey: string; onSelect: (key: string) => void;
  modelHealth: Record<string, 'untested' | 'healthy' | 'unhealthy'>;
}) {
  const models = Object.entries(MODELS)
    .filter(([k, m]) => m.provider === provider && modelHealth[k] !== 'unhealthy');

  const hasAny = models.length > 0;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={ss.modalOverlay} activeOpacity={1} onPress={onClose}>
        <View style={[ss.modalContent, { maxHeight: '60%' }]}>
          <Text style={{ color: '#fff', fontSize: 16, fontWeight: 'bold', marginBottom: 12 }}>
            {TAB_LABELS[provider]} Models
          </Text>
          <FlatList
            data={models}
            keyExtractor={([k]) => k}
            ListEmptyComponent={
              <Text style={{ color: '#6b7280', fontSize: 13, textAlign: 'center', paddingVertical: 20 }}>
                All models in this provider are currently unavailable.
              </Text>
            }
            renderItem={({ item: [k, m] }) => {
              const active = k === currentKey;
              return (
                <TouchableOpacity
                  style={[ss.modelRow, active && ss.modelRowActive]}
                  onPress={() => { onSelect(k); onClose(); }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[ss.modelName, active && { color: '#fff' }]}>{m.name}</Text>
                    <Text style={ss.modelInfo}>
                      {m.supportsVision ? 'Vision' : 'Text'} {active ? '• Active' : ''}
                    </Text>
                  </View>
                  {active && <Ionicons name="checkmark-circle" size={18} color="#3b82f6" />}
                </TouchableOpacity>
              );
            }}
          />
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

// Helper functions for AI Synthesis/Summary on mobile
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
  return Array.from(new Set(words));
}

function calcRelevance(a: string, b: string): number {
  const wa = keyWords(a);
  const wb = keyWords(b);
  if (wa.length === 0 || wb.length === 0) return 0;
  const overlap = wa.filter(w => wb.includes(w)).length;
  return overlap / Math.max(wa.length, wb.length);
}

const PROVIDER_INFO = {
  groq: { label: 'Llama', color: '#f97316', icon: '🦙' },
  google: { label: 'Gemini', color: '#3b82f6', icon: '✨' },
  deepseek: { label: 'DeepSeek', color: '#a855f7', icon: '🧠' },
};

// ── Main Home Screen ────────────────────────────────────────────────────────

const screenWidth = Dimensions.get('window').width;
const sidebarWidth = Math.min(280, screenWidth * 0.82);

export default function HomeScreen() {
  const insets = useSafeAreaInsets();

  // ── Auth ──
  const [user, setUser] = useState<{ email: string; uid: string } | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [accountStatus, setAccountStatus] = useState<AccountStatus>('loading');
  const [userRole, setUserRole] = useState<string>('user');

  // ── Sessions ──
  const [sessions, setSessions] = useState<SessionData[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [loadingSession, setLoadingSession] = useState(false);

  // ── Chat ──
  const [activeTab, setActiveTab] = useState<ModelKey>('google');
  const [selectedModels, setSelectedModels] = useState<Record<ModelKey, string>>({ ...DEFAULT_MODELS });
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingProviders, setLoadingProviders] = useState<Record<ModelKey, boolean>>({ groq: false, google: false, deepseek: false });
  const [groqHistory, setGroqHistory] = useState<ApiMessage[]>([]);
  const [googleHistory, setGoogleHistory] = useState<ApiMessage[]>([]);
  const [deepseekHistory, setDeepseekHistory] = useState<ApiMessage[]>([]);
  const [providerStatus, setProviderStatus] = useState<Record<ModelKey, 'idle' | 'thinking' | 'done' | 'error'>>({ groq: 'idle', google: 'idle', deepseek: 'idle' });

  const [searchQuery, setSearchQuery] = useState('');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [speakingIndex, setSpeakingIndex] = useState<number | null>(null);

  // ── Quota ──
  const [quota, setQuota] = useState<QuotaData | null>(null);

  // ── UI ──
  const [isOffline, setIsOffline] = useState(false);
  const [image, setImage] = useState<string | null>(null);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [showSupport, setShowSupport] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [showSummaryModal, setShowSummaryModal] = useState(false);
  const [unavailableProviders, setUnavailableProviders] = useState<Record<ModelKey, string | null>>({ groq: null, google: null, deepseek: null });
  const [modelHealth, setModelHealth] = useState<Record<string, 'untested' | 'healthy' | 'unhealthy'>>(() => {
    const init: Record<string, 'untested'> = {};
    for (const key of Object.keys(MODELS)) init[key] = 'untested';
    return init;
  });

  // ── Email/Password Auth State ──
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [verificationEmailSent, setVerificationEmailSent] = useState(false);
  const [verifSending, setVerifSending] = useState(false);

  // ── Refs ──
  const scrollViewRef = useRef<ScrollView>(null);
  const abortRef = useRef<AbortController | null>(null);
  const isStreamingRef = useRef(false);
  const slideAnim = useRef(new Animated.Value(-sidebarWidth)).current;
  const groqHistoryRef = useRef(groqHistory);
  const googleHistoryRef = useRef(googleHistory);
  const deepseekHistoryRef = useRef(deepseekHistory);
  groqHistoryRef.current = groqHistory;
  googleHistoryRef.current = googleHistory;
  deepseekHistoryRef.current = deepseekHistory;

  const isNearBottomRef = useRef(true);
  isNearBottomRef.current = isNearBottom;

  const textInputRef = useRef<TextInput>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const touchStartXRef = useRef(0);
  const touchStartYRef = useRef(0);
  const TABS_ORDER = useMemo<ModelKey[]>(() => ['groq', 'google', 'deepseek'], []);

  const handleSwipe = useCallback((direction: 'left' | 'right') => {
    const currentIndex = TABS_ORDER.indexOf(activeTab);
    if (direction === 'left') {
      if (currentIndex < TABS_ORDER.length - 1) {
        setActiveTab(TABS_ORDER[currentIndex + 1]);
        Keyboard.dismiss();
      }
    } else {
      if (currentIndex > 0) {
        setActiveTab(TABS_ORDER[currentIndex - 1]);
        Keyboard.dismiss();
      }
    }
  }, [activeTab, TABS_ORDER]);

  const handleTouchStart = useCallback((e: any) => {
    touchStartXRef.current = e.nativeEvent.pageX;
    touchStartYRef.current = e.nativeEvent.pageY;
  }, []);

  const handleTouchEnd = useCallback((e: any) => {
    const endX = e.nativeEvent.pageX;
    const endY = e.nativeEvent.pageY;
    const deltaX = endX - touchStartXRef.current;
    const deltaY = endY - touchStartYRef.current;

    // Minimum X swipe distance of 60, maximum Y deviation of 45 (ensures it is a clean horizontal swipe)
    if (Math.abs(deltaX) > 60 && Math.abs(deltaY) < 45) {
      if (deltaX < 0) {
        handleSwipe('left');
      } else {
        handleSwipe('right');
      }
    }
  }, [handleSwipe]);

  const handleQuickPrompt = useCallback((prompt: string) => {
    setInput(prompt);
    setTimeout(() => textInputRef.current?.focus(), 80);
  }, []);


  useSpeechRecognitionEvent('result', (e) => {
    if (e.results?.[0]) {
      const transcript = e.results[0].transcript;
      if (e.isFinal) {
        setInput(prev => prev + (prev ? ' ' : '') + transcript);
        setIsListening(false);
      }
    }
  });

  useSpeechRecognitionEvent('error', (e) => {
    console.warn('Speech recognition error:', e);
    setIsListening(false);
  });

  // ── Sidebar Animation ──
  useEffect(() => {
    Animated.timing(slideAnim, {
      toValue: sidebarOpen ? 0 : -sidebarWidth,
      duration: 250,
      useNativeDriver: true,
    }).start();
  }, [sidebarOpen, sidebarWidth, slideAnim]);

  const toggleSidebar = useCallback(() => setSidebarOpen(prev => !prev), []);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  // ── Offline Detection ──
  useEffect(() => {
    const unsub = NetInfo.addEventListener((state: any) => {
      setIsOffline(!state.isConnected);
    });
    return () => unsub();
  }, []);

  // ── Auth Listener ──
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (firebaseUser) => {
      if (firebaseUser) {
        setUser({ email: firebaseUser.email || '', uid: firebaseUser.uid });
        setNeedsVerification(!firebaseUser.emailVerified);
        if (firebaseUser.emailVerified) setVerificationEmailSent(false);
      } else {
        setUser(null);
        setNeedsVerification(false);
        setVerificationEmailSent(false);
        setGroqHistory([]);
        setGoogleHistory([]);
        setDeepseekHistory([]);
        setLoadingProviders({ groq: false, google: false, deepseek: false });
        setProviderStatus({ groq: 'idle', google: 'idle', deepseek: 'idle' });
        setQuota(null);
        setCurrentSessionId(null);
        setSessions([]);
        setAccountStatus('loading');
        setUserRole('user');
        setImage(null);
      }
      setAuthLoading(false);
    });
    return () => unsub();
  }, []);

  // ── Account Status Listener ──
  useEffect(() => {
    if (!user) return;
    setAccountStatus('loading');
    const userRef = doc(db, 'users', user.uid);
    const unsub = onSnapshot(userRef, (docSnap) => {
      if (!docSnap.exists()) {
        setAccountStatus('new');
        setUserRole('user');
      } else {
        const data = docSnap.data();
        if (data.role === 'admin') {
          setAccountStatus('approved');
        } else {
          setAccountStatus(data.status as AccountStatus);
        }
        setUserRole(data.role || 'user');
      }
    }, () => {
      setAccountStatus('new');
    });
    return () => unsub();
  }, [user]);

  // ── Create User Doc on First Login ──
  useEffect(() => {
    if (!user || accountStatus !== 'new') return;
    const initUser = async () => {
      try {
        const userRef = doc(db, 'users', user.uid);
        const userSnap = await getDoc(userRef);
        if (!userSnap.exists()) {
          await setDoc(userRef, {
            uid: user.uid,
            email: user.email,
            displayName: user.email?.split('@')[0] || 'User',
            photoURL: '',
            role: 'user',
            status: 'pending',
            tier: 'free',
            customQuota: 50,
            createdAt: serverTimestamp(),
            lastLogin: serverTimestamp(),
          });
        }
      } catch (err) {
        console.warn('Failed to init user doc:', err);
      }
    };
    initUser();
  }, [user, accountStatus]);

  // ── Fetch Sessions ──
  useEffect(() => {
    if (!user || accountStatus !== 'approved') return;
    const fetchSessions = async () => {
      try {
        const q = query(
          collection(db, 'sessions'),
          where('userId', '==', user.uid),
          where('deletedByUser', '==', false),
          orderBy('createdAt', 'desc'),
          limit(50)
        );
        const snap = await getDocs(q);
        const valid: SessionData[] = [];
        snap.forEach((d) => {
          const data = d.data();
          valid.push({ id: d.id, title: data.title || 'Study Session', createdAt: data.createdAt });
        });

        setSessions(valid);
      } catch (err) {
        console.warn('Failed to fetch sessions:', err);
      }
    };
    fetchSessions();
  }, [user, accountStatus, currentSessionId]);

  // ── Load Chat Messages When Session Changes ──
  useEffect(() => {
    if (!currentSessionId) {
      setGroqHistory([]);
      setGoogleHistory([]);
      setDeepseekHistory([]);
      return;
    }
    const loadMessages = async () => {
      if (isStreamingRef.current) return; // prevent race: streaming writes to in-memory state
      setLoadingSession(true);
      try {
        const q = query(
          collection(db, 'chats'),
          where('sessionId', '==', currentSessionId),
          orderBy('createdAt', 'asc'),
          limit(MAX_CHAT_MESSAGES_LOADED)
        );
        const snap = await getDocs(q);
        const fetchedMessages: any[] = [];
        snap.forEach((d) => {
          fetchedMessages.push({ id: d.id, ...d.data() });
        });

        const groq: ApiMessage[] = [];
        const google: ApiMessage[] = [];
        const deepseek: ApiMessage[] = [];
        fetchedMessages.forEach((data) => {
          const msg: ApiMessage = { role: data.role, content: data.content || '', id: data.id, feedback: data.feedback || null, image: data.image || null };
          if (data.provider === 'groq') groq.push(msg);
          else if (data.provider === 'google') google.push(msg);
          else if (data.provider === 'deepseek') deepseek.push(msg);
        });
        setGroqHistory(groq);
        setGoogleHistory(google);
        setDeepseekHistory(deepseek);
      } catch (err) {
        console.warn('Failed to load messages:', err);
      } finally {
        setLoadingSession(false);
      }
    };
    loadMessages();
  }, [currentSessionId]);

  // ── Fetch Quota ──
  useEffect(() => {
    if (user && accountStatus === 'approved') {
      fetchQuota(user.uid)
        .then(setQuota)
        .catch(err => console.warn('Quota fetch failed:', err));
    }
  }, [user, accountStatus]);

  // ── Update lastLogin on app start ──
  useEffect(() => {
    if (!user || accountStatus !== 'approved') return;
    const userRef = doc(db, 'users', user.uid);
    updateDoc(userRef, { lastLogin: serverTimestamp() }).catch(() => {});
  }, [user, accountStatus]);

  // ── Auth Handlers ──

  const handleGoogleLogin = useCallback(async () => {
    setError('');
    if (Platform.OS !== 'web') {
      setError('Please use email/password to sign in on mobile.');
      return;
    }
    setAuthLoading(true);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err: any) {
      if (err?.code !== 'auth/popup-closed-by-user') {
        setError(err.message || 'Google sign-in failed.');
      }
      setAuthLoading(false);
    }
  }, []);

  const handleDemoStudentLogin = useCallback(async () => {
    setError('');
    setAuthLoading(true);
    try {
      await signInWithEmailAndPassword(auth, 'student@system.com', 'student@123');
    } catch (err: any) {
      const code = err?.code || '';
      if (code === 'auth/user-not-found' || code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        try {
          const cred = await createUserWithEmailAndPassword(auth, 'student@system.com', 'student@123');
          const userRef = doc(db, 'users', cred.user.uid);
          await setDoc(userRef, {
            uid: cred.user.uid,
            email: 'student@system.com',
            displayName: 'Demo Student',
            role: 'user',
            status: 'approved',
            tier: 'free',
            customQuota: 50,
            createdAt: serverTimestamp(),
            lastLogin: serverTimestamp(),
          });
        } catch (createErr: any) {
          setError(`Demo Student registration failed: ${createErr.message}`);
          setAuthLoading(false);
        }
      } else {
        setError(`Demo Student login failed: ${err.message}`);
        setAuthLoading(false);
      }
    }
  }, []);

  // ── Email/Password Auth ──

  const handleEmailAuth = useCallback(async () => {
    setError('');
    if (!authEmail.trim() || !authPassword.trim()) {
      setError('Please enter email and password.');
      return;
    }
    setAuthLoading(true);
    try {
      if (isSignUp) {
        const cred = await createUserWithEmailAndPassword(auth, authEmail.trim(), authPassword);
        await sendEmailVerification(cred.user);
        setNeedsVerification(true);
        setVerificationEmailSent(true);
        setAuthLoading(false);
      } else {
        const cred = await signInWithEmailAndPassword(auth, authEmail.trim(), authPassword);
        if (!cred.user.emailVerified) {
          setNeedsVerification(true);
          setAuthLoading(false);
        }
        // if emailVerified, onAuthStateChanged will handle setting the user
      }
    } catch (err: any) {
      const code = err?.code || '';
      const messages: Record<string, string> = {
        'auth/user-not-found': 'No account found with this email.',
        'auth/wrong-password': 'Incorrect password.',
        'auth/invalid-credential': 'Invalid email or password.',
        'auth/email-already-in-use': 'An account with this email already exists.',
        'auth/weak-password': 'Password must be at least 6 characters.',
        'auth/invalid-email': 'Invalid email address.',
        'auth/too-many-requests': 'Too many attempts. Please try again later.',
      };
      setError(messages[code] || err.message || 'Authentication failed.');
      setAuthLoading(false);
    }
  }, [authEmail, authPassword, isSignUp]);

  const handleResendVerification = useCallback(async () => {
    if (!auth.currentUser) return;
    setVerifSending(true);
    try {
      await sendEmailVerification(auth.currentUser);
      setVerificationEmailSent(true);
    } catch (err: any) {
      setError(err.message || 'Failed to send verification email.');
    }
    setVerifSending(false);
  }, []);

  const handleLogout = useCallback(async () => {
    abortRef.current?.abort();
    await signOut(auth);
  }, []);

  // ── Session Handlers ──

  const handleSelectSession = useCallback((sessionId: string) => {
    setCurrentSessionId(sessionId);
    closeSidebar();
  }, [closeSidebar]);

  const handleDeleteSession = useCallback(async (sessionId: string) => {
    try {
      await updateDoc(doc(db, 'sessions', sessionId), { deletedByUser: true });
      setSessions(prev => prev.filter(s => s.id !== sessionId));
      if (currentSessionId === sessionId) {
        setCurrentSessionId(null);
      }
    } catch (err) {
      console.warn('Failed to delete session:', err);
    }
  }, [currentSessionId]);

  const handleNewSession = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setCurrentSessionId(null);
    setGroqHistory([]);
    setGoogleHistory([]);
    setDeepseekHistory([]);
    setLoadingProviders({ groq: false, google: false, deepseek: false });
    setProviderStatus({ groq: 'idle', google: 'idle', deepseek: 'idle' });
    setUnavailableProviders({ groq: null, google: null, deepseek: null });
    closeSidebar();
  }, [closeSidebar]);

  // ── Model Handlers ──

  const handleModelSelect = useCallback((key: string) => {
    setSelectedModels(prev => ({ ...prev, [activeTab]: key }));
  }, [activeTab]);

  // ── Image / Camera Handlers ──

  const pickImage = useCallback(async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        base64: true,
        quality: 0.7,
      });
      if (!result.canceled && result.assets?.[0]?.base64) {
        setImage(`data:image/jpeg;base64,${result.assets[0].base64}`);
      }
    } catch (err) {
      console.warn('Image picker failed:', err);
      reportLog('error', 'Image picker failed: ' + (err as any)?.message, (err as any)?.stack, user?.email || 'Anonymous');
    }
  }, [user]);

  const captureImage = useCallback(async () => {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Camera permission required to capture photos.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        base64: true,
        quality: 0.7,
      });
      if (!result.canceled && result.assets?.[0]?.base64) {
        setImage(`data:image/jpeg;base64,${result.assets[0].base64}`);
      }
    } catch (err) {
      console.warn('Camera capture failed:', err);
      reportLog('error', 'Camera capture failed: ' + (err as any)?.message, (err as any)?.stack, user?.email || 'Anonymous');
    }
  }, [user]);

  const handleScan = useCallback(async () => {
    if (!image || !user) return;
    setLoading(true);
    try {
      const result = await runOcr(image, user.uid);
      const text = result?.text || '';
      if (text) {
        setInput(prev => prev + (prev ? '\n' : '') + text);
      }
      setImage(null);
    } catch (err: any) {
      Alert.alert('OCR Failed', err.message || 'Could not extract text from image.');
      reportLog('error', 'OCR Scan Failed: ' + err?.message, err?.stack, user?.email || 'Anonymous');
    } finally {
      setLoading(false);
    }
  }, [image, user]);

  // ── Voice-to-Text ──

  const toggleMic = useCallback(async () => {
    if (!ExpoSpeechRecognitionModule) {
      Alert.alert(
        'Voice Input Unavailable',
        'Speech recognition requires a custom development build. It is not supported in the standard Expo Go sandbox. Please use the keyboard.'
      );
      return;
    }
    if (isListening) {
      await ExpoSpeechRecognitionModule.stop();
      setIsListening(false);
    } else {
      try {
        const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
        if (!perm.granted) {
          Alert.alert('Microphone permission is required for voice input.');
          return;
        }
        await ExpoSpeechRecognitionModule.start({ lang: 'en-US', interimResults: true });
        setIsListening(true);
      } catch (err: any) {
        Alert.alert('Voice Input Failed', err.message || 'Could not start speech recognition.');
      }
    }
  }, [isListening]);

  // ── Copy ──

  const handleCopy = useCallback(async (content: string, index: number) => {
    await Clipboard.setStringAsync(content);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  }, []);

  // ── Text-to-Speech ──

  const handleSpeak = useCallback((content: string, index: number) => {
    if (speakingIndex === index) {
      Speech.stop();
      setSpeakingIndex(null);
    } else {
      Speech.stop();
      Speech.speak(content, {
        language: 'en',
        onDone: () => setSpeakingIndex(null),
        onError: () => setSpeakingIndex(null),
      });
      setSpeakingIndex(index);
    }
  }, [speakingIndex]);

  // ── Feedback ──

  const handleFeedback = useCallback((index: number, value: 'up' | 'down') => {
    const tab = activeTab;
    const setHistory = tab === 'groq' ? setGroqHistory : tab === 'google' ? setGoogleHistory : setDeepseekHistory;
    const currentHistory = tab === 'groq' ? groqHistory : tab === 'google' ? googleHistory : deepseekHistory;
    const msg = currentHistory[index];
    if (!msg) return;
    const newFeedback = msg.feedback === value ? null : value;
    setHistory(prev => prev.map((m, i) => i === index ? { ...m, feedback: newFeedback } : m));
    if (msg.id) {
      updateDoc(doc(db, 'chats', msg.id), { feedback: newFeedback }).catch(e =>
        console.warn('Failed to save feedback:', e)
      );
    }
  }, [activeTab, groqHistory, googleHistory, deepseekHistory]);

  // ── Regenerate ──

  const handleRegenerate = useCallback(async (index: number) => {
    if (!user || loading) return;
    const tab = activeTab;
    const currentHistory = tab === 'groq' ? groqHistory : tab === 'google' ? googleHistory : deepseekHistory;
    const setHistory = tab === 'groq' ? setGroqHistory : tab === 'google' ? setGoogleHistory : setDeepseekHistory;

    let lastUserIdx = -1;
    for (let i = index - 1; i >= 0; i--) {
      if (currentHistory[i].role === 'user') { lastUserIdx = i; break; }
    }
    if (lastUserIdx === -1) return;

    const modelKey = selectedModels[tab];
    const modelDef = MODELS[modelKey];
    if (!modelDef) return;

    const trimmedHistory = currentHistory.slice(0, index);
    setHistory([...trimmedHistory, { role: 'assistant', content: 'Thinking...' }]);
    setProviderStatus(prev => ({ ...prev, [tab]: 'thinking' }));
    setUnavailableProviders(prev => ({ ...prev, [tab]: null }));
    setLoadingProviders(prev => ({ ...prev, [tab]: true }));

    const apiHistory = currentHistory.slice(0, lastUserIdx + 1);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const result = await askQuestion({
        messages: apiHistory,
        provider: tab,
        model: modelDef.id,
        image: undefined,
        userId: user.uid,
        signal: controller.signal,
        onChunk: (text) => {
          setHistory(prev => prev.length === 0 ? prev : prev.map((msg, i) =>
            i === prev.length - 1 && msg.role === 'assistant' ? { ...msg, content: text } : msg
          ));
          if (isNearBottomRef.current) listRef.current?.scrollToEnd({ animated: false });
        },
      });

      const fullText = result.text;
      const actualModelId = result.actualModel;

      // Auto update mobile dropdown selection dynamically!
      if (actualModelId && actualModelId !== modelDef.id) {
        const modelsEntry = Object.entries(MODELS).find(([key, val]) => val.id === actualModelId);
        if (modelsEntry) {
          const modelKey = modelsEntry[0];
          setSelectedModels(prev => ({ ...prev, [tab]: modelKey }));
        }
      }

      const textToSave = fullText.trim() || `The model ${modelDef.name} is currently unavailable.`;
      if (currentSessionId) {
        saveChatMessage({
          sessionId: currentSessionId, role: 'assistant', content: textToSave, provider: tab, userId: user.uid,
        }).catch(e => console.warn('Error saving regenerated msg:', e));
      }
          setProviderStatus(prev => ({ ...prev, [tab]: 'done' }));
          setUnavailableProviders(prev => ({ ...prev, [tab]: null }));
          setModelHealth(prev => ({ ...prev, [modelKey]: 'healthy' }));
    } catch (err: any) {
      if (err.name === 'AbortError') {
        // Keep the content exactly as-is when generation is stopped, matching ChatGPT
        setProviderStatus(prev => ({ ...prev, [tab]: 'done' }));
      } else {
        const errMsg = err.message || 'Request failed';
        setHistory(prev => prev.length === 0 ? prev : prev.map((msg, i) =>
          i === prev.length - 1 ? { ...msg, content: 'Response interrupted. Please try again.' } : msg
        ));
        setProviderStatus(prev => ({ ...prev, [tab]: 'error' }));
        setUnavailableProviders(prev => ({ ...prev, [tab]: errMsg }));
        setModelHealth(prev => ({ ...prev, [modelKey]: 'unhealthy' }));
      }
    } finally {
      setLoadingProviders(prev => ({ ...prev, [tab]: false }));
      abortRef.current = null;
    }
  }, [user, loading, activeTab, groqHistory, googleHistory, deepseekHistory, selectedModels, currentSessionId]);

  // ── Edit ──

  const handleEditStart = useCallback((index: number, content: string) => {
    setEditingIndex(index);
    setEditText(content);
  }, []);

  const handleEditCancel = useCallback(() => {
    setEditingIndex(null);
    setEditText('');
  }, []);

  const handleEditSave = useCallback(async () => {
    if (editingIndex === null || !editText.trim() || !user) return;
    const index = editingIndex;
    const updatedContent = editText.trim();
    const sessionId = currentSessionId;

    setEditingIndex(null);
    setEditText('');
    setLoading(true);
    setProviderStatus({ groq: 'thinking', google: 'thinking', deepseek: 'thinking' });
    setUnavailableProviders({ groq: null, google: null, deepseek: null });
    setLoadingProviders({ groq: true, google: true, deepseek: true });

    const updateHistory = (history: ApiMessage[]): ApiMessage[] => {
      if (index >= history.length || history[index].role !== 'user') return history;
      return [...history.slice(0, index), { ...history[index], content: updatedContent }];
    };

    const newGroq = updateHistory(groqHistoryRef.current);
    const newGoogle = updateHistory(googleHistoryRef.current);
    const newDeepseek = updateHistory(deepseekHistoryRef.current);

    setGroqHistory([...newGroq, { role: 'assistant', content: 'Thinking...' }]);
    setGoogleHistory([...newGoogle, { role: 'assistant', content: 'Thinking...' }]);
    setDeepseekHistory([...newDeepseek, { role: 'assistant', content: 'Thinking...' }]);

    const controller = new AbortController();
    abortRef.current = controller;

    const queryTab = async (tab: ModelKey) => {
      const modelKey = selectedModels[tab];
      const modelDef = MODELS[modelKey];
      if (!modelDef) {
        setLoadingProviders(prev => ({ ...prev, [tab]: false }));
        setProviderStatus(prev => ({ ...prev, [tab]: 'error' }));
        setUnavailableProviders(prev => ({ ...prev, [tab]: `Model key "${modelKey}" not found` }));
        return;
      }

      const currentHistory = tab === 'groq' ? newGroq : tab === 'google' ? newGoogle : newDeepseek;
      const setHistory = tab === 'groq' ? setGroqHistory : tab === 'google' ? setGoogleHistory : setDeepseekHistory;

      try {
        const result = await askQuestion({
          messages: currentHistory,
          provider: tab,
          model: modelDef.id,
          image: undefined,
          userId: user.uid,
          signal: controller.signal,
          onChunk: (text) => {
            setHistory(prev => prev.length === 0 ? prev : prev.map((msg, i) =>
              i === prev.length - 1 && msg.role === 'assistant' ? { ...msg, content: text } : msg
            ));
            if (isNearBottomRef.current) listRef.current?.scrollToEnd({ animated: false });
          },
        });

        const fullText = result.text;
        const actualModelId = result.actualModel;

        // Auto update mobile dropdown selection dynamically!
        if (actualModelId && actualModelId !== modelDef.id) {
          const modelsEntry = Object.entries(MODELS).find(([key, val]) => val.id === actualModelId);
          if (modelsEntry) {
            const modelKey = modelsEntry[0];
            setSelectedModels(prev => ({ ...prev, [tab]: modelKey }));
          }
        }

        const textToSave = fullText.trim() || `The model ${modelDef.name} is currently unavailable.`;
        if (sessionId) {
          saveChatMessage({
            sessionId, role: 'assistant', content: textToSave, provider: tab, userId: user.uid,
          }).catch(e => console.warn(`Error saving edited msg for ${tab}:`, e));
        }
        setProviderStatus(prev => ({ ...prev, [tab]: 'done' }));
        setUnavailableProviders(prev => ({ ...prev, [tab]: null }));
        setModelHealth(prev => ({ ...prev, [modelKey]: 'healthy' }));
      } catch (err: any) {
        if (err.name === 'AbortError') {
          // Keep the content exactly as-is when generation is stopped, matching ChatGPT
          setProviderStatus(prev => ({ ...prev, [tab]: 'done' }));
        } else {
          const errMsg = err.message || 'Request failed';
          setHistory(prev => prev.length === 0 ? prev : prev.map((msg, i) =>
            i === prev.length - 1 ? { ...msg, content: 'Response interrupted. Please try again.' } : msg
          ));
          setProviderStatus(prev => ({ ...prev, [tab]: 'error' }));
          setUnavailableProviders(prev => ({ ...prev, [tab]: errMsg }));
          setModelHealth(prev => ({ ...prev, [modelKey]: 'unhealthy' }));
        }
      } finally {
        setLoadingProviders(prev => ({ ...prev, [tab]: false }));
      }
    };

    isStreamingRef.current = true;
    try {
      await Promise.allSettled([queryTab('groq'), queryTab('google'), queryTab('deepseek')]);
      const updatedQuota = await fetchQuota(user.uid);
      setQuota(updatedQuota);
    } catch { } finally {
      setLoading(false);
      abortRef.current = null;
      isStreamingRef.current = false;
    }
  }, [editingIndex, editText, user, currentSessionId, selectedModels]);

  // ── Export ──

  const handleExport = useCallback(async () => {
    const lines: string[] = [];
    const maxLen = Math.max(groqHistory.length, googleHistory.length, deepseekHistory.length);
    for (let i = 0; i < maxLen; i++) {
      const gMsg = groqHistory[i];
      const goMsg = googleHistory[i];
      const dMsg = deepseekHistory[i];
      if (gMsg?.role === 'user' && !lines.some(l => l.includes(gMsg.content))) {
        lines.push(`## You\n\n${gMsg.content}\n`);
      }
      if (gMsg?.role === 'assistant') lines.push(`### Groq (Llama)\n\n${gMsg.content}\n`);
      if (goMsg?.role === 'assistant') lines.push(`### Google (Gemini)\n\n${goMsg.content}\n`);
      if (dMsg?.role === 'assistant') lines.push(`### DeepSeek\n\n${dMsg.content}\n`);
    }
    const markdown = `# Chat Export\n\n${lines.join('\n')}`;
    try {
      await Share.share({ message: markdown, title: 'Chat Export' });
    } catch (err: any) {
      console.warn('Export failed:', err);
    }
  }, [groqHistory, googleHistory, deepseekHistory]);

  // ── Consensus Summary Calculation ──
  const mobileSummary = useMemo(() => {
    const activeModels = [
      { provider: 'groq', msgs: groqHistory },
      { provider: 'google', msgs: googleHistory },
      { provider: 'deepseek', msgs: deepseekHistory }
    ].filter(({ msgs }) => msgs.some(m => m.role === 'assistant' && m.content.length > 10 && m.content !== 'Thinking...'));

    if (activeModels.length < 2) return null;

    const responses = activeModels.map(({ provider, msgs }) => {
      const last = [...msgs].reverse().find(m => m.role === 'assistant');
      return { provider, text: last?.content || '', info: PROVIDER_INFO[provider as 'groq' | 'google' | 'deepseek'] };
    }).filter(r => r.text.length > 10 && r.text !== 'Thinking...');

    if (responses.length < 2) return null;

    const sectionsByModel = responses.map(r => ({
      provider: r.provider,
      info: r.info,
      sections: extractSections(r.text),
    }));

    const agreed: { points: string[]; modelCount: number }[] = [];
    const uniqueInsights: { provider: string; info: typeof PROVIDER_INFO['groq']; points: string[] }[] = [];

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

    return { 
      agreed: topAgreed, 
      uniqueInsights: uniqueInsightsClean, 
      hasDisagreement, 
      responderCount: responses.length, 
      responderNames: responses.map(r => r.info.label) 
    };
  }, [groqHistory, googleHistory, deepseekHistory]);

  // ── Speech Recording & AI Summary Pulse Animation ──
  useEffect(() => {
    if (isListening || !!mobileSummary) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.15, duration: 900, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1.0, duration: 900, useNativeDriver: true }),
        ])
      ).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isListening, mobileSummary, pulseAnim]);

  // ── Scroll ──

  const handleScroll = useCallback((e: any) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const nearBottom = contentOffset.y + layoutMeasurement.height >= contentSize.height - 100;
    setIsNearBottom(nearBottom);
  }, []);

  const scrollToBottom = useCallback(() => {
    listRef.current?.scrollToEnd({ animated: true });
  }, []);

  // ── Chat History Getter ──

  const getActiveHistory = useCallback(() => {
    if (activeTab === 'groq') return { history: groqHistory, setHistory: setGroqHistory };
    if (activeTab === 'google') return { history: googleHistory, setHistory: setGoogleHistory };
    return { history: deepseekHistory, setHistory: setDeepseekHistory };
  }, [activeTab, groqHistory, googleHistory, deepseekHistory]);

  // ── Send / Stop ──

  const stopGeneration = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  const handleSend = useCallback(async () => {
    if (!input.trim() && !image) return;
    if (!user || loading) return;

    const userPrompt = input.trim() || (image ? 'Analyze this image' : '');
    setInput('');
    setLoading(true);

    const activeImage = image;
    setImage(null);

    // 1. Append user message + "Thinking..." to all three histories
    const userMsg: ApiMessage = { role: 'user', content: userPrompt, image: activeImage };
    const thinkingMsg: ApiMessage = { role: 'assistant', content: 'Thinking...' };

    setGroqHistory(prev => [...prev, userMsg, thinkingMsg]);
    setGoogleHistory(prev => [...prev, userMsg, thinkingMsg]);
    setDeepseekHistory(prev => [...prev, userMsg, thinkingMsg]);
    setProviderStatus({ groq: 'thinking', google: 'thinking', deepseek: 'thinking' });
    setUnavailableProviders({ groq: null, google: null, deepseek: null });

    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);

    const controller = new AbortController();
    abortRef.current = controller;

    setLoadingProviders({ groq: true, google: true, deepseek: true });

    try {
      // 2. Save user message for activeTab to establish/resolve sessionId
      const saveResult = await saveChatMessage({
        sessionId: currentSessionId || 'new',
        role: 'user',
        content: userPrompt,
        provider: activeTab,
        userId: user.uid,
        image: activeImage,
      });

      const activeSessionId = saveResult.sessionId;
      setCurrentSessionId(activeSessionId);

      // 3. Save user messages for other two tabs in the background
      const allTabs: ModelKey[] = ['groq', 'google', 'deepseek'];
      for (const tab of allTabs) {
        if (tab !== activeTab) {
          saveChatMessage({
            sessionId: activeSessionId,
            role: 'user',
            content: userPrompt,
            provider: tab,
            userId: user.uid,
            image: activeImage,
          }).catch(err => console.warn(`Failed to save user msg for ${tab}:`, err));
        }
      }

      // 4. Helper to query each model concurrently — uses refs for latest history
      const queryModel = async (tab: ModelKey) => {
        const modelKey = selectedModels[tab];
        const modelDef = MODELS[modelKey];
        if (!modelDef) {
          setLoadingProviders(prev => ({ ...prev, [tab]: false }));
          setProviderStatus(prev => ({ ...prev, [tab]: 'error' }));
          setUnavailableProviders(prev => ({ ...prev, [tab]: `Model key "${modelKey}" not found` }));
          return;
        }

        const setHistory = tab === 'groq' ? setGroqHistory : tab === 'google' ? setGoogleHistory : setDeepseekHistory;

        // Build API payload from refs (latest history including all previous messages)
        const currentHistory = (
          tab === 'groq' ? groqHistoryRef.current :
          tab === 'google' ? googleHistoryRef.current :
          deepseekHistoryRef.current
        );
        // currentHistory at this point already has [..., userMsg, thinkingMsg] from step 1
        // We need to send only [..., userMsg] — strip the last "Thinking..." entry
        const apiHistory = currentHistory.slice(0, -1);

        // Per-model vision fallback
        if (activeImage && !modelDef.supportsVision) {
          const fallbackText = `This model (${modelDef.name}) does not support image input. Please switch to a vision-capable model.`;
          setHistory(prev => prev.length === 0 ? prev : prev.map((msg, i) =>
            i === prev.length - 1 ? { ...msg, content: fallbackText } : msg
          ));
          await saveChatMessage({
            sessionId: activeSessionId, role: 'assistant', content: fallbackText, provider: tab, userId: user.uid,
          }).catch(e => console.warn(`Error saving fallback for ${tab}:`, e));
          setLoadingProviders(prev => ({ ...prev, [tab]: false }));
          setProviderStatus(prev => ({ ...prev, [tab]: 'done' }));
          setUnavailableProviders(prev => ({ ...prev, [tab]: null }));
          return;
        }

        try {
          const result = await askQuestion({
            messages: apiHistory,
            provider: tab,
            model: modelDef.id,
            image: activeImage,
            userId: user.uid,
            signal: controller.signal,
            onChunk: (text) => {
              setHistory(prev => prev.length === 0 ? prev : prev.map((msg, i) =>
                i === prev.length - 1 && msg.role === 'assistant'
                  ? { ...msg, content: text }
                  : msg
              ));
              if (isNearBottomRef.current && activeTab === tab) {
                listRef.current?.scrollToEnd({ animated: false });
              }
            },
          });

          const fullText = result.text;
          const actualModelId = result.actualModel;

          // Auto update mobile dropdown selection dynamically!
          if (actualModelId && actualModelId !== modelDef.id) {
            const modelsEntry = Object.entries(MODELS).find(([key, val]) => val.id === actualModelId);
            if (modelsEntry) {
              const modelKey = modelsEntry[0];
              setSelectedModels(prev => ({ ...prev, [tab]: modelKey }));
            }
          }

          const textToSave = fullText.trim() || `The model ${modelDef.name} is currently unavailable. Please try again later.`;
          await saveChatMessage({
            sessionId: activeSessionId, role: 'assistant', content: textToSave, provider: tab, userId: user.uid,
          });
          setProviderStatus(prev => ({ ...prev, [tab]: 'done' }));
          setUnavailableProviders(prev => ({ ...prev, [tab]: null }));
          setModelHealth(prev => ({ ...prev, [modelKey]: 'healthy' }));
        } catch (err: any) {
          if (err.name === 'AbortError') {
            // Keep the content exactly as-is when generation is stopped, matching ChatGPT
            setProviderStatus(prev => ({ ...prev, [tab]: 'done' }));
          } else {
            const errMsg = err.message || 'Request failed';
            setHistory(prev => prev.length === 0 ? prev : prev.map((msg, i) =>
              i === prev.length - 1 ? { ...msg, content: 'Response interrupted. Please try again.' } : msg
            ));
            setProviderStatus(prev => ({ ...prev, [tab]: 'error' }));
            setUnavailableProviders(prev => ({ ...prev, [tab]: errMsg }));
            setModelHealth(prev => ({ ...prev, [modelKey]: 'unhealthy' }));
          }
        } finally {
          setLoadingProviders(prev => ({ ...prev, [tab]: false }));
        }
      };

      // 5. Fire all three queries concurrently
      isStreamingRef.current = true;
      await Promise.allSettled([
        queryModel('groq'),
        queryModel('google'),
        queryModel('deepseek'),
      ]);
      isStreamingRef.current = false;

      const updatedQuota = await fetchQuota(user.uid);
      setQuota(updatedQuota);

    } catch (err: any) {
      console.warn("Concurrent streaming failed:", err);
    } finally {
      setLoading(false);
      abortRef.current = null;
      isStreamingRef.current = false;
    }
  }, [input, image, user, loading, activeTab, selectedModels, currentSessionId]);

  // ── Dismiss Keyboard ──

  const dismissKeyboard = useCallback(() => Keyboard.dismiss(), []);
  const listRef = useRef<FlatList<ApiMessage>>(null);

  // ── Format Quota ──

  const formatQuota = useCallback((val: number | string | undefined): string => {
    if (val === undefined || val === null) return '—';
    if (val === 'Unlimited') return '∞';
    return String(val);
  }, []);

  // ══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════════════════

  const showLimitExceeded = quota && quota.tier !== 'pro' && typeof quota.remaining === 'number' && quota.remaining <= 0;

  // ── Loading ──
  if (authLoading) {
    return (
      <View style={ss.center}>
        <ActivityIndicator size="large" color="#a855f7" />
        <Text style={ss.loadingText}>Authenticating...</Text>
      </View>
    );
  }

  // ── Auth ──
  if (!user) {
    return (
      <View style={ss.authContainer}>
        <SafeAreaView style={ss.authInner}>
          <View style={ss.logoContainer}>
            <View style={ss.iconCircle}>
              <Ionicons name="sparkles" size={38} color="#a855f7" />
            </View>
            <Text style={ss.authTitle}>TurboLearn AI</Text>
            <Text style={ss.authSubtitle}>Dual-Core Native Study Engine</Text>
          </View>

          <View style={ss.formContainer}>
            {Platform.OS === 'web' ? (
              <TouchableOpacity style={ss.googleButton} onPress={handleGoogleLogin} disabled={authLoading}>
                {authLoading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Ionicons name="logo-google" size={18} color="#fff" />
                    <Text style={ss.googleButtonText}>Continue with Google</Text>
                  </>
                )}
              </TouchableOpacity>
            ) : (
              <>
                <TextInput style={ss.input} placeholder="Email"
                  placeholderTextColor="#4b5563" value={authEmail}
                  onChangeText={setAuthEmail} keyboardType="email-address"
                  autoCapitalize="none" autoComplete="email" />
                <TextInput style={ss.input} placeholder="Password"
                  placeholderTextColor="#4b5563" value={authPassword}
                  onChangeText={setAuthPassword} secureTextEntry
                  autoCapitalize="none" autoComplete={isSignUp ? 'new-password' : 'password'} />
                <TouchableOpacity style={ss.authButton} onPress={handleEmailAuth} disabled={authLoading}>
                  {authLoading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={ss.authButtonText}>{isSignUp ? 'Create Account' : 'Sign In'}</Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity onPress={() => { setIsSignUp(!isSignUp); setError(''); }} style={{ alignSelf: 'center', marginTop: 4 }}>
                  <Text style={{ color: '#6b7280', fontSize: 13 }}>
                    {isSignUp ? 'Already have an account? Sign In' : "Don't have an account? Create One"}
                  </Text>
                </TouchableOpacity>
                {ENABLE_DEMO_LOGIN && (
                  <TouchableOpacity style={ss.demoButton} onPress={handleDemoStudentLogin} disabled={authLoading}>
                    <Ionicons name="flask-outline" size={18} color="#a855f7" />
                    <Text style={ss.demoButtonText}>Demo Student Login</Text>
                  </TouchableOpacity>
                )}
              </>
            )}

            {error ? <Text style={ss.errorText}>{error}</Text> : null}
          </View>

          <TouchableOpacity onPress={() => setShowSupport(true)} style={{ marginTop: 16, alignSelf: 'center' }}>
            <Text style={{ color: '#4b5563', fontSize: 11, textDecorationLine: 'underline' }}>Having trouble logging in?</Text>
          </TouchableOpacity>
          <Text style={ss.authFooter}>Protected by Firebase Authentication</Text>
        </SafeAreaView>
        <SupportModal visible={showSupport} onClose={() => setShowSupport(false)} />
      </View>
    );
  }

  // ── Email Verification Screen ──
  if (needsVerification) {
    return (
      <View style={ss.authContainer}>
        <SafeAreaView style={ss.authInner}>
          <View style={ss.logoContainer}>
            <View style={ss.iconCircle}>
              <Ionicons name="mail-outline" size={38} color="#f59e0b" />
            </View>
            <Text style={ss.authTitle}>Verify Your Email</Text>
            <Text style={[ss.authSubtitle, { textAlign: 'center', paddingHorizontal: 20 }]}>
              We sent a verification email to {'\n'}
              <Text style={{ color: '#a855f7', fontWeight: '600' }}>{user?.email}</Text>
              {'\n\n'}
              Please check your inbox and click the link to activate your account.
            </Text>
          </View>

          <View style={{ gap: 10, marginBottom: 20 }}>
            {verificationEmailSent && (
              <Text style={{ color: '#22c55e', fontSize: 13, textAlign: 'center', marginBottom: 8 }}>
                <Ionicons name="checkmark-circle" size={16} color="#22c55e" /> Verification email sent!
              </Text>
            )}

            <TouchableOpacity style={ss.authButton} onPress={async () => {
              if (!auth.currentUser) return;
              setAuthLoading(true);
              try {
                await auth.currentUser.reload();
                if (auth.currentUser.emailVerified) {
                  setNeedsVerification(false);
                  setVerificationEmailSent(false);
                } else {
                  setError('Email not verified yet. Please check your inbox.');
                }
              } catch (err: any) {
                setError(err.message || 'Failed to check verification status.');
              }
              setAuthLoading(false);
            }} disabled={authLoading}>
              {authLoading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={ss.authButtonText}>I've Verified — Continue</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity style={ss.googleButton} onPress={handleResendVerification} disabled={verifSending}>
              {verifSending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={ss.googleButtonText}>Resend Verification Email</Text>
              )}
            </TouchableOpacity>

            <Text style={{ color: '#6b7280', fontSize: 12, textAlign: 'center', marginTop: 4 }}>
              Didn't receive it? Check spam or try a different email.
            </Text>

            {error ? <Text style={ss.errorText}>{error}</Text> : null}
          </View>

          <TouchableOpacity onPress={handleLogout} style={{ alignSelf: 'center', marginTop: 8 }}>
            <Text style={{ color: '#4b5563', fontSize: 13, textDecorationLine: 'underline' }}>Sign Out</Text>
          </TouchableOpacity>
        </SafeAreaView>
        <SupportModal visible={showSupport} onClose={() => setShowSupport(false)} />
      </View>
    );
  }

  // ── Account Status Screens ──
  if (accountStatus === 'loading') {
    return (
      <View style={ss.center}>
        <ActivityIndicator size="large" color="#a855f7" />
        <Text style={ss.loadingText}>Checking account...</Text>
      </View>
    );
  }

  if (accountStatus === 'pending') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#050505' }}>
        <StatusScreen
          title="Verification Pending"
          message="Your account is awaiting admin approval. You'll be notified once verified."
          icon="hourglass-outline"
          color="#f59e0b"
        />
        <TouchableOpacity onPress={handleLogout} style={ss.signOutBtn}>
          <Text style={{ color: '#6b7280', fontWeight: '600', fontSize: 13 }}>Sign Out</Text>
        </TouchableOpacity>
        <SupportModal visible={showSupport} onClose={() => setShowSupport(false)} />
      </SafeAreaView>
    );
  }

  if (accountStatus === 'banned') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#050505' }}>
        <StatusScreen
          title="Access Revoked"
          message="Your account has been suspended. Contact support if you believe this is an error."
          icon="shield-checkmark-outline"
          color="#ef4444"
        />
        <TouchableOpacity onPress={() => setShowSupport(true)} style={ss.signOutBtn}>
          <Text style={{ color: '#3b82f6', fontWeight: '600', fontSize: 13 }}>Contact Support</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={handleLogout} style={[ss.signOutBtn, { marginTop: 8 }]}>
          <Text style={{ color: '#6b7280', fontWeight: '600', fontSize: 13 }}>Sign Out</Text>
        </TouchableOpacity>
        <SupportModal visible={showSupport} onClose={() => setShowSupport(false)} />
      </SafeAreaView>
    );
  }

  // ── Limit Exceeded ──
  if (showLimitExceeded) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#050505' }}>
        <LimitExceededScreen
          onCheck={() => fetchQuota(user!.uid).then(setQuota).catch(() => {})}
          onSignOut={handleLogout}
        />
      </SafeAreaView>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // MAIN CHAT
  // ══════════════════════════════════════════════════════════════════════════

  const { history: activeHistory } = getActiveHistory();
  const activeModelKey = selectedModels[activeTab];
  const activeModel = MODELS[activeModelKey];

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={ss.dashboardContainer}
    >
      <View style={ss.dashboardInner}>
        {/* ── Sidebar Overlay ── */}
        {sidebarOpen && (
          <TouchableOpacity style={ss.overlay} activeOpacity={1} onPress={closeSidebar} />
        )}

        {/* ── Sidebar Drawer ── */}
        <Animated.View style={[ss.sidebar, { transform: [{ translateX: slideAnim }] }]}>
          <SafeAreaView style={ss.sidebarInner}>
            <View style={ss.sidebarHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={ss.sidebarTitle}>TurboLearn</Text>
                {quota && quota.tier === 'pro' && (
                  <View style={{ backgroundColor: 'rgba(234,179,8,0.15)', borderColor: 'rgba(234,179,8,0.3)', borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                    <Text style={{ color: '#eab308', fontSize: 9, fontWeight: 'bold' }}>PRO</Text>
                  </View>
                )}
              </View>
              <TouchableOpacity onPress={closeSidebar} style={{ padding: 4 }}>
                <Ionicons name="close" size={22} color="#9ca3af" />
              </TouchableOpacity>
            </View>

            {/* Profile Avatar Card */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16, paddingHorizontal: 4 }}>
              <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: '#a855f7', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: '#fff', fontSize: 12, fontWeight: 'bold' }}>
                  {user.email?.charAt(0).toUpperCase() || 'U'}
                </Text>
              </View>
              <Text style={{ color: '#e5e7eb', fontSize: 13, fontWeight: '500', flex: 1 }} numberOfLines={1}>
                {user.email}
              </Text>
            </View>

            <TextInput
              style={ss.sidebarSearch}
              placeholder="Search conversations..."
              placeholderTextColor="#4b5563"
              value={searchQuery}
              onChangeText={setSearchQuery}
            />

            <TouchableOpacity style={ss.newChatBtn} onPress={handleNewSession}>
              <Ionicons name="add-circle-outline" size={18} color="#fff" />
              <Text style={ss.newChatText}>New Chat</Text>
            </TouchableOpacity>

            {quota && (
              <View style={ss.sidebarQuota}>
                <Text style={ss.sidebarQuotaLabel}>
                  {quota.tier === 'pro' ? 'Pro Engine' : 'Free tier'}
                </Text>
                {quota.tier === 'pro' ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                    <Ionicons name="sparkles" size={12} color="#eab308" />
                    <Text style={{ color: '#eab308', fontSize: 11, fontWeight: 'bold' }}>Unlimited Access</Text>
                  </View>
                ) : (
                  <>
                    <Text style={ss.sidebarQuotaLabel}>
                      {formatQuota(quota.remaining)} / {formatQuota(quota.limit)} today
                    </Text>
                    {typeof quota.limit === 'number' && typeof quota.remaining === 'number' && (
                      <View style={ss.quotaBar}>
                        <View style={[ss.quotaFill, { width: `${Math.max(0, (quota.remaining / quota.limit) * 100)}%` }]} />
                      </View>
                    )}
                  </>
                )}
              </View>
            )}

            {/* ── Sessions List ── */}
            <ScrollView style={ss.sidebarSessionList} showsVerticalScrollIndicator={false}>
              {sessions.filter(s => s.title.toLowerCase().includes(searchQuery.toLowerCase())).length === 0 ? (
                <Text style={ss.noSessionsText}>{searchQuery ? 'No matching conversations' : 'No conversations yet'}</Text>
              ) : (
                sessions.filter(s => s.title.toLowerCase().includes(searchQuery.toLowerCase())).map((session) => {
                  const isActive = session.id === currentSessionId;
                  return (
                    <TouchableOpacity
                      key={session.id}
                      style={[ss.sessionItem, isActive && ss.sessionItemActive]}
                      onPress={() => handleSelectSession(session.id)}
                      onLongPress={() => {
                        Alert.alert('Delete Session', `Delete "${session.title}"?`, [
                          { text: 'Cancel', style: 'cancel' },
                          { text: 'Delete', style: 'destructive', onPress: () => handleDeleteSession(session.id) },
                        ]);
                      }}
                    >
                      <Ionicons name="chatbubble-ellipses-outline" size={14} color={isActive ? '#3b82f6' : '#6b7280'} />
                      <Text style={[ss.sessionTitle, isActive && ss.sessionTitleActive]} numberOfLines={1}>
                        {session.title}
                      </Text>
                      <TouchableOpacity
                        onPress={() => {
                          Alert.alert('Delete Session', `Delete "${session.title}"?`, [
                            { text: 'Cancel', style: 'cancel' },
                            { text: 'Delete', style: 'destructive', onPress: () => handleDeleteSession(session.id) },
                          ]);
                        }}
                        style={{ padding: 6, marginRight: -4 }}
                      >
                        <Ionicons name="trash-outline" size={14} color={isActive ? '#ef4444' : '#6b7280'} />
                      </TouchableOpacity>
                    </TouchableOpacity>
                  );
                })
              )}
            </ScrollView>

            <View style={ss.sidebarFooter}>
              <TouchableOpacity style={ss.sidebarFooterBtn} onPress={handleExport}>
                <Ionicons name="download-outline" size={16} color="#6b7280" />
                <Text style={ss.sidebarFooterText}>Export</Text>
              </TouchableOpacity>
              <TouchableOpacity style={ss.sidebarFooterBtn} onPress={() => setShowSupport(true)}>
                <Ionicons name="help-buoy-outline" size={16} color="#6b7280" />
                <Text style={ss.sidebarFooterText}>Support</Text>
              </TouchableOpacity>
              <TouchableOpacity style={ss.sidebarFooterBtn} onPress={handleLogout}>
                <Ionicons name="log-out-outline" size={16} color="#6b7280" />
                <Text style={ss.sidebarFooterText}>Sign Out</Text>
              </TouchableOpacity>
            </View>
          </SafeAreaView>
        </Animated.View>

        {/* ── Header ── */}
        <View style={[ss.header, { paddingTop: insets.top, height: insets.top + 56 }]}>
          <View style={ss.headerLeft}>
            <TouchableOpacity onPress={toggleSidebar} style={ss.menuBtn}>
              <Ionicons name="menu-outline" size={22} color="#9ca3af" />
            </TouchableOpacity>
            <Text style={ss.headerTitle}>TurboLearn</Text>
            {quota && (
              <View style={[
                ss.quotaBadge, 
                quota.tier === 'pro' && { backgroundColor: 'rgba(234,179,8,0.15)', borderColor: 'rgba(234,179,8,0.3)', borderWidth: 1 }
              ]}>
                <Text style={[
                  ss.quotaText, 
                  quota.tier === 'pro' && { color: '#eab308', fontWeight: 'bold' }
                ]}>
                  {quota.tier === 'pro' ? 'PRO' : `${formatQuota(quota.remaining)}/${formatQuota(quota.limit)}`}
                </Text>
              </View>
            )}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            {mobileSummary ? (
              <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
                <TouchableOpacity 
                  style={{ padding: 6, backgroundColor: 'rgba(16,185,129,0.12)', borderRadius: 20, borderColor: 'rgba(16,185,129,0.25)', borderWidth: 1 }}
                  onPress={() => setShowSummaryModal(true)}
                >
                  <Ionicons name="sparkles" size={18} color="#10b981" />
                </TouchableOpacity>
              </Animated.View>
            ) : (
              <TouchableOpacity 
                style={{ padding: 6, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 20, borderColor: 'rgba(255,255,255,0.06)', borderWidth: 1, opacity: 0.4 }}
                onPress={() => {
                  Alert.alert(
                    'AI Summary',
                    'Ask a question first! The local consensus engine will automatically summarize agreements and insights once Llama, Gemini, and DeepSeek respond.'
                  );
                }}
              >
                <Ionicons name="sparkles-outline" size={18} color="#9ca3af" />
              </TouchableOpacity>
            )}
            <TouchableOpacity 
              style={ss.avatarCircle} 
              onPress={() => {
                Alert.alert(
                  'Profile Info',
                  `Logged in as:\n${user.email}\n\nTier: ${quota?.tier === 'pro' ? 'Pro Unlimited' : 'Free tier'}\nRole: ${userRole.toUpperCase()}`,
                  [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Sign Out', style: 'destructive', onPress: handleLogout }
                  ]
                );
              }}
            >
              <Text style={ss.avatarText}>
                {user.email?.charAt(0).toUpperCase() || 'U'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Tabs ── */}
        <View style={[ss.tabBar, { marginTop: insets.top + 56 }]}>
          {(Object.keys(TAB_LABELS) as ModelKey[]).map((key) => {
            const isActive = activeTab === key;
            const isLoading = loadingProviders[key];
            const status = providerStatus[key];
            const allUnhealthy = Object.entries(MODELS)
              .filter(([, m]) => m.provider === key)
              .every(([k]) => modelHealth[k] === 'unhealthy');

            // Resolve the dynamic model label (e.g. "Gemini 2.5" instead of hardcoded "Gemini")
            const activeModelId = selectedModels[key];
            const activeModelObj = MODELS[activeModelId];
            const dynamicLabel = activeModelObj 
              ? activeModelObj.name.split(' ').slice(0, 2).join(' ') 
              : TAB_LABELS[key];

            return (
              <TouchableOpacity
                key={key}
                style={[ss.tabButton, isActive && !allUnhealthy && { borderBottomColor: TAB_COLORS[key], borderBottomWidth: 2 }]}
                onPress={() => { setActiveTab(key); dismissKeyboard(); }}
              >
                {allUnhealthy ? (
                  <Ionicons name="close-circle-outline" size={16} color="#ef4444" />
                ) : isLoading ? (
                  <ActivityIndicator size={12} color={TAB_COLORS[key]} />
                ) : status === 'done' ? (
                  <Ionicons name="checkmark-circle" size={16} color={TAB_COLORS[key]} />
                ) : status === 'error' ? (
                  <Ionicons name="alert-circle" size={16} color="#ef4444" />
                ) : (
                  <Ionicons name={TAB_ICONS[key]} size={16} color={isActive ? TAB_COLORS[key] : '#6b7280'} />
                )}
                <Text 
                  numberOfLines={1} 
                  ellipsizeMode="tail" 
                  style={[ss.tabText, isActive && !allUnhealthy ? { color: '#fff', fontWeight: 'bold' } : allUnhealthy ? { color: '#ef4444' } : { color: '#6b7280' }]}
                >
                  {allUnhealthy ? 'Unavailable' : dynamicLabel}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* ── Model Selector ── */}
        <TouchableOpacity style={ss.modelSelector} onPress={() => setShowModelPicker(true)}>
          <Text style={ss.modelSelectorText}>{activeModel?.name || 'Select Model'}</Text>
          <Ionicons name="chevron-down" size={14} color="#6b7280" />
        </TouchableOpacity>

        {/* ── Offline Banner ── */}
        {isOffline && (
          <View style={ss.offlineBanner}>
            <Ionicons name="cloud-offline-outline" size={14} color="#fca5a5" />
            <Text style={ss.offlineText}>You are offline. Messages will send when connection restores.</Text>
          </View>
        )}

        {/* ── Error Banner ── */}
        {providerStatus[activeTab] === 'error' && (
          <View style={ss.errorBanner}>
            <Ionicons name="alert-circle" size={16} color="#ef4444" />
            <Text style={ss.errorBannerText}>
              {unavailableProviders[activeTab] || 'Request failed. Try again.'}
            </Text>
          </View>
        )}

        {/* ── Chat Area ── */}
        {loadingSession ? (
          <View style={ss.center}>
            <ActivityIndicator size="small" color="#a855f7" />
            <Text style={ss.loadingText}>Loading messages...</Text>
          </View>
        ) : (
          <View 
            style={ss.chatArea} 
            onTouchStart={(e) => {
              dismissKeyboard();
              handleTouchStart(e);
            }}
            onTouchEnd={handleTouchEnd}
          >
              <FlatList
                ref={listRef}
                data={activeHistory}
                extraData={`${activeHistory.length}-${editingIndex}-${copiedIndex}-${speakingIndex}-${activeHistory.map(m => m.feedback || '').join(',')}`}
                keyExtractor={(item, index) => `${item.role}-${index}-${item.content.length}`}
                contentContainerStyle={ss.chatContent}
                keyboardShouldPersistTaps="handled"
                onScroll={handleScroll}
                scrollEventThrottle={100}
                ListEmptyComponent={
                  <View style={ss.emptyContainer}>
                    <Ionicons name={TAB_ICONS[activeTab]} size={40} color={unavailableProviders[activeTab] ? '#ef4444' : TAB_COLORS[activeTab]} style={{ marginBottom: 12 }} />
                    <Text style={[ss.emptyTitle, unavailableProviders[activeTab] && { color: '#ef4444' }]}>
                      {unavailableProviders[activeTab] ? 'Model Unavailable' : 'TurboLearn Engine'}
                    </Text>
                    <Text style={ss.emptySubtitle}>
                      {unavailableProviders[activeTab]
                        ? unavailableProviders[activeTab]
                        : `${activeModel?.name || 'Engine active'}. Tap a shortcut below or ask your own question.`
                      }
                    </Text>
                    {!unavailableProviders[activeTab] && (
                      <View style={ss.quickPromptsGrid}>
                        {QUICK_PROMPTS.map((qp, idx) => (
                          <TouchableOpacity
                            key={idx}
                            style={ss.quickPromptCard}
                            onPress={() => handleQuickPrompt(qp.prompt)}
                            activeOpacity={0.7}
                          >
                            <Ionicons name={qp.icon as any} size={15} color={TAB_COLORS[activeTab]} />
                            <Text style={ss.quickPromptText}>{qp.text}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                  </View>
                }
                renderItem={({ item: msg, index }: { item: ApiMessage; index: number }) => {
                  const isUser = msg.role === 'user';
                  const isEditing = editingIndex === index;
                  const showCopied = copiedIndex === index;
                  const fb = msg.feedback;

                  const chatImageWidth = Math.min(260, screenWidth * 0.65);
                  const chatImageHeight = Math.min(180, chatImageWidth * 0.7);

                  return (
                    <View style={[ss.messageRow, isUser ? ss.messageUserRow : ss.messageAssistantRow, { marginVertical: 6 }]}>
                      <View style={{ maxWidth: isUser ? '85%' : '94%', alignItems: isUser ? 'flex-end' : 'flex-start' }}>
                        <View style={[ss.bubble, isUser ? ss.bubbleUser : [ss.bubbleAssistant, { borderLeftColor: TAB_COLORS[activeTab], borderLeftWidth: 3 }]]}>
                          {msg.image && (
                            <TouchableOpacity
                              activeOpacity={0.85}
                              onPress={() => setLightboxImage(msg.image || null)}
                              style={{
                                width: chatImageWidth,
                                height: chatImageHeight,
                                borderRadius: 12,
                                overflow: 'hidden',
                                borderWidth: 1,
                                borderColor: isUser ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.1)',
                                marginBottom: 8,
                                backgroundColor: '#1e1f20',
                                shadowColor: '#000',
                                shadowOffset: { width: 0, height: 2 },
                                shadowOpacity: 0.25,
                                shadowRadius: 3.84,
                                elevation: 5,
                              }}
                            >
                              <Image 
                                source={{ uri: msg.image }} 
                                style={{ width: '100%', height: '100%', resizeMode: 'cover' }} 
                              />
                            </TouchableOpacity>
                          )}
                          {isUser ? (
                            isEditing ? (
                              <View>
                                <TextInput
                                  style={ss.editInput}
                                  value={editText}
                                  onChangeText={setEditText}
                                  autoFocus
                                  multiline
                                />
                                <View style={ss.editActions}>
                                  <TouchableOpacity onPress={handleEditCancel} style={ss.editBtn}>
                                    <Text style={{ color: '#ef4444', fontSize: 12 }}>Cancel</Text>
                                  </TouchableOpacity>
                                  <TouchableOpacity onPress={handleEditSave} style={ss.editBtn}>
                                    <Text style={{ color: '#22c55e', fontSize: 12, fontWeight: 'bold' }}>Save</Text>
                                  </TouchableOpacity>
                                </View>
                              </View>
                            ) : (
                              <Text style={ss.messageText}>{msg.content}</Text>
                            )
                          ) : (
                            <MarkdownRenderer content={msg.content} />
                          )}
                        </View>
                        
                        {/* Horizontal Actions Under Bubble */}
                        {!isEditing && (
                          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 14, alignSelf: isUser ? 'flex-end' : 'flex-start', paddingHorizontal: 6 }}>
                            <TouchableOpacity onPress={() => handleCopy(msg.content, index)} style={{ padding: 4 }}>
                              {showCopied ? (
                                <Text style={{ fontSize: 9, color: '#22c55e', fontWeight: 'bold' }}>Copied!</Text>
                              ) : (
                                <Ionicons name="copy-outline" size={13} color="#9ca3af" />
                              )}
                            </TouchableOpacity>

                            {isUser ? (
                              <TouchableOpacity onPress={() => handleEditStart(index, msg.content)} style={{ padding: 4 }}>
                                <Ionicons name="pencil-outline" size={13} color="#9ca3af" />
                              </TouchableOpacity>
                            ) : (
                              <>
                                <TouchableOpacity onPress={() => handleRegenerate(index)} style={{ padding: 4 }}>
                                  <Ionicons name="refresh-outline" size={13} color="#9ca3af" />
                                </TouchableOpacity>
                                <TouchableOpacity onPress={() => handleSpeak(msg.content, index)} style={{ padding: 4 }}>
                                  <Ionicons name={speakingIndex === index ? "stop-circle" : "volume-high-outline"} size={13} color={speakingIndex === index ? '#f43f5e' : '#9ca3af'} />
                                </TouchableOpacity>
                                <TouchableOpacity onPress={() => handleFeedback(index, 'up')} style={{ padding: 4 }}>
                                  <Ionicons name={fb === 'up' ? "thumbs-up" : "thumbs-up-outline"} size={13} color={fb === 'up' ? '#10b981' : '#9ca3af'} />
                                </TouchableOpacity>
                                <TouchableOpacity onPress={() => handleFeedback(index, 'down')} style={{ padding: 4 }}>
                                  <Ionicons name={fb === 'down' ? "thumbs-down" : "thumbs-down-outline"} size={13} color={fb === 'down' ? '#ef4444' : '#9ca3af'} />
                                </TouchableOpacity>
                              </>
                            )}
                          </View>
                        )}
                      </View>
                    </View>
                  );
                }}
              />
              {!isNearBottom && activeHistory.length > 0 && (
                <TouchableOpacity style={ss.scrollDownBtn} onPress={scrollToBottom}>
                  <Ionicons name="arrow-down" size={18} color="#fff" />
                </TouchableOpacity>
              )}
          </View>
        )}

        {/* ── Image Preview ── */}
        {image && (
          <View style={ss.imagePreviewContainer}>
            <View style={ss.imagePreviewCard}>
              <Image source={{ uri: image }} style={ss.imagePreviewImgPremium} />
              
              {/* Scan / OCR Button Overlay */}
              <TouchableOpacity 
                onPress={handleScan} 
                style={ss.imagePreviewScanBtn}
                activeOpacity={0.8}
              >
                <Ionicons name="scan" size={14} color="#fff" />
              </TouchableOpacity>

              {/* Close / Remove Button Overlay */}
              <TouchableOpacity 
                onPress={() => setImage(null)} 
                style={ss.imagePreviewCloseBtn}
                activeOpacity={0.8}
              >
                <Ionicons name="close" size={14} color="#fff" />
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ── Input Bar ── */}
        {isListening && (
          <View style={ss.listeningBar}>
            <Ionicons name="mic" size={14} color="#ef4444" />
            <Text style={ss.listeningText}>Listening...</Text>
          </View>
        )}
        <View style={[ss.inputBar, { marginBottom: Math.max(14, insets.bottom) }]}>
          <TouchableOpacity style={ss.cameraIcon} onPress={pickImage}>
            <Ionicons name="image-outline" size={22} color={image ? '#3b82f6' : '#9ca3af'} />
          </TouchableOpacity>

          <TouchableOpacity style={ss.cameraIcon} onPress={captureImage}>
            <Ionicons name="camera-outline" size={22} color="#9ca3af" />
          </TouchableOpacity>

          <TextInput
            ref={textInputRef}
            style={ss.textInput}
            placeholder={`Ask ${activeModel?.name || 'a question'}...`}
            placeholderTextColor="#6b7280"
            value={input}
            onChangeText={setInput}
            onSubmitEditing={handleSend}
          />

          <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
            <TouchableOpacity style={[ss.cameraIcon, isListening && { backgroundColor: 'rgba(239,68,68,0.15)' }]} onPress={toggleMic}>
              <Ionicons name={isListening ? "mic" : "mic-outline"} size={22} color={isListening ? '#ef4444' : '#9ca3af'} />
            </TouchableOpacity>
          </Animated.View>

          {loading ? (
            <TouchableOpacity style={ss.stopIcon} onPress={stopGeneration}>
              <Ionicons name="stop" size={18} color="#fff" />
            </TouchableOpacity>
          ) : isListening ? (
            <TouchableOpacity style={[ss.sendIcon, { backgroundColor: '#ef4444' }]} onPress={toggleMic}>
              <Ionicons name="stop-circle" size={18} color="#fff" />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[ss.sendIcon, !input.trim() && !image && ss.sendIconDisabled]}
              onPress={handleSend}
              disabled={(!input.trim() && !image) || loading}
            >
              <Ionicons name="send" size={18} color="#fff" />
            </TouchableOpacity>
          )}
        </View>

        {/* ── Modals ── */}
        <SupportModal visible={showSupport} onClose={() => setShowSupport(false)} />
        <ModelSelectModal
          visible={showModelPicker}
          onClose={() => setShowModelPicker(false)}
          provider={activeTab}
          currentKey={selectedModels[activeTab]}
          onSelect={handleModelSelect}
          modelHealth={modelHealth}
        />
        <Modal
          visible={showSummaryModal}
          animationType="slide"
          transparent={true}
          onRequestClose={() => setShowSummaryModal(false)}
        >
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' }}>
            <View style={{ backgroundColor: '#1e1f20', borderTopLeftRadius: 20, borderTopRightRadius: 20, height: '80%', padding: 20, borderTopWidth: 1, borderTopColor: 'rgba(16,185,129,0.2)' }}>
              {/* Header */}
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)', paddingBottom: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Ionicons name="sparkles" size={20} color="#10b981" />
                  <Text style={{ color: '#10b981', fontSize: 16, fontWeight: 'bold' }}>AI Summary</Text>
                  <View style={{ backgroundColor: 'rgba(255,255,255,0.06)', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 }}>
                    <Text style={{ color: '#9ca3af', fontSize: 10 }}>{mobileSummary?.responderCount} models</Text>
                  </View>
                </View>
                <TouchableOpacity onPress={() => setShowSummaryModal(false)} style={{ padding: 4 }}>
                  <Ionicons name="close" size={24} color="#9ca3af" />
                </TouchableOpacity>
              </View>

              {/* Body */}
              <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
                {mobileSummary && (
                  <View style={{ gap: 20, paddingBottom: 30 }}>
                    {/* What All Models Agree On */}
                    {mobileSummary.agreed.length > 0 && (
                      <View style={{ gap: 8 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                          <Ionicons name="checkmark-circle" size={16} color="#10b981" />
                          <Text style={{ color: '#10b981', fontSize: 14, fontWeight: 'bold' }}>What All Models Agree On</Text>
                        </View>
                        {mobileSummary.agreed.map((point, idx) => (
                          <View key={idx} style={{ flexDirection: 'row', gap: 8, backgroundColor: 'rgba(16,185,129,0.04)', borderColor: 'rgba(16,185,129,0.1)', borderWidth: 1, padding: 12, borderRadius: 12 }}>
                            <Ionicons name="checkmark" size={14} color="#10b981" style={{ marginTop: 2 }} />
                            <Text style={{ color: '#e5e7eb', fontSize: 13, flex: 1, lineHeight: 18 }}>{point}</Text>
                          </View>
                        ))}
                      </View>
                    )}

                    {/* Extra Insights */}
                    {mobileSummary.uniqueInsights.length > 0 && (
                      <View style={{ gap: 12 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                          <Ionicons name="bulb-outline" size={16} color="#eab308" />
                          <Text style={{ color: '#eab308', fontSize: 14, fontWeight: 'bold' }}>Extra Insights</Text>
                        </View>
                        {mobileSummary.uniqueInsights.map((insight, idx) => (
                          <View key={idx} style={{ gap: 8 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4 }}>
                              <Text style={{ color: '#eab308', fontSize: 12 }}>{insight.info.icon}</Text>
                              <Text style={{ color: insight.info.color, fontSize: 12, fontWeight: 'bold' }}>{insight.info.label}</Text>
                              <Text style={{ color: '#9ca3af', fontSize: 11 }}>offers a unique perspective:</Text>
                            </View>
                            {insight.points.map((point, pointIdx) => (
                              <View key={pointIdx} style={{ flexDirection: 'row', gap: 8, backgroundColor: 'rgba(234,179,8,0.04)', borderColor: 'rgba(234,179,8,0.1)', borderWidth: 1, padding: 12, borderRadius: 12 }}>
                                <Ionicons name="sparkles" size={14} color="#eab308" style={{ marginTop: 2 }} />
                                <Text style={{ color: '#e5e7eb', fontSize: 13, flex: 1, lineHeight: 18 }}>{point}</Text>
                              </View>
                            ))}
                          </View>
                        ))}
                      </View>
                    )}

                    {/* Different Perspectives */}
                    {mobileSummary.hasDisagreement && mobileSummary.agreed.length < 3 && (
                      <View style={{ flexDirection: 'row', gap: 10, backgroundColor: 'rgba(249,115,22,0.06)', borderColor: 'rgba(249,115,22,0.15)', borderWidth: 1, padding: 14, borderRadius: 12, borderLeftWidth: 4, borderLeftColor: '#f97316' }}>
                        <Ionicons name="chatbubbles-outline" size={18} color="#f97316" style={{ marginTop: 2 }} />
                        <View style={{ flex: 1, gap: 4 }}>
                          <Text style={{ color: '#f97316', fontSize: 13, fontWeight: 'bold' }}>Different Perspectives</Text>
                          <Text style={{ color: '#d1d5db', fontSize: 12, lineHeight: 16 }}>
                            The AI models have different takes on this topic. Each one highlights unique aspects worth considering.
                          </Text>
                          <Text style={{ color: '#9ca3af', fontSize: 10 }}>
                            Models: {mobileSummary.responderNames.join(', ')}
                          </Text>
                        </View>
                      </View>
                    )}
                  </View>
                )}
              </ScrollView>
            </View>
          </View>
        </Modal>

        {/* ── Image Lightbox Modal ── */}
        <Modal
          visible={lightboxImage !== null}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setLightboxImage(null)}
        >
          <View style={ss.lightboxContainer}>
            {/* Background Touchable to dismiss */}
            <TouchableOpacity 
              activeOpacity={1} 
              style={StyleSheet.absoluteFillObject} 
              onPress={() => setLightboxImage(null)} 
            />

            {lightboxImage && (
              <Image 
                source={{ uri: lightboxImage }} 
                style={ss.lightboxImage} 
              />
            )}

            {/* Close Button placed dynamically under the notch */}
            <TouchableOpacity 
              onPress={() => setLightboxImage(null)} 
              style={[ss.lightboxCloseBtn, { top: Math.max(20, insets.top) }]}
              activeOpacity={0.8}
            >
              <Ionicons name="close" size={28} color="#fff" />
            </TouchableOpacity>
          </View>
        </Modal>
      </View>
    </KeyboardAvoidingView>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// STYLES
// ══════════════════════════════════════════════════════════════════════════════

const ss = StyleSheet.create({
  center: { flex: 1, backgroundColor: '#050505', alignItems: 'center', justifyContent: 'center', gap: 16 },
  loadingText: { color: '#6b7280', fontSize: 14 },
  statusTitle: { fontSize: 22, fontWeight: 'bold', color: '#fff', marginTop: 16, letterSpacing: -0.5 },
  statusMessage: { fontSize: 13, color: '#6b7280', textAlign: 'center', lineHeight: 20, paddingHorizontal: 40, marginTop: 8 },
  signOutBtn: { alignSelf: 'center', paddingVertical: 12, paddingHorizontal: 20, marginTop: 8 },

  // ── Auth ──
  authContainer: { flex: 1, backgroundColor: '#050505', justifyContent: 'center', padding: 24 },
  authInner: { flex: 1, justifyContent: 'center' },
  logoContainer: { alignItems: 'center', marginBottom: 48 },
  iconCircle: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: 'rgba(168, 85, 247, 0.1)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(168, 85, 247, 0.2)',
    marginBottom: 16,
  },
  authTitle: { fontSize: 32, fontWeight: 'bold', color: '#fff', letterSpacing: -0.5 },
  authSubtitle: { fontSize: 14, color: '#6b7280', marginTop: 4 },
  formContainer: {
    gap: 20, backgroundColor: '#0c0c0e', padding: 24,
    borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)',
  },
  inputGroup: { gap: 8 },
  inputLabel: { fontSize: 12, fontWeight: 'bold', color: '#4b5563', textTransform: 'uppercase', letterSpacing: 1 },
  input: {
    backgroundColor: '#18181b', borderColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14,
    color: '#fff', fontSize: 14,
  },
  authButton: { backgroundColor: '#a855f7', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 10 },
  authButtonText: { color: '#fff', fontWeight: 'bold', fontSize: 15 },
  googleButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: '#18181b', borderRadius: 12, paddingVertical: 14,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  googleButtonText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  authFooter: { textAlign: 'center', color: '#374151', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1.5, marginTop: 32 },
  toggleContainer: {
    flexDirection: 'row', padding: 4, backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', marginBottom: 10,
  },
  toggleButton: { flex: 1, paddingVertical: 10, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  toggleActive: {
    backgroundColor: '#2c2d2e', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4, elevation: 2,
  },
  toggleText: { fontSize: 12, fontWeight: '600' },
  toggleTextActive: { color: '#fff' },
  toggleTextInactive: { color: '#9ca3af' },
  demoButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: 'rgba(168, 85, 247, 0.05)', borderRadius: 12, paddingVertical: 14,
    borderWidth: 1, borderColor: 'rgba(168, 85, 247, 0.2)', marginTop: 4,
  },
  demoButtonText: { color: '#a855f7', fontWeight: '600', fontSize: 14 },
  errorText: { color: '#ef4444', fontSize: 12, textAlign: 'center', backgroundColor: 'rgba(239,68,68,0.1)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.2)', borderRadius: 8, padding: 10 },

  // ── Action Buttons ──
  actionBtn: { paddingVertical: 12, paddingHorizontal: 24, borderRadius: 12, alignItems: 'center' },

  // ── Sidebar ──
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 90 },
  sidebar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: sidebarWidth,
    backgroundColor: '#0c0c0e',
    zIndex: 100,
    borderRightWidth: 1,
    borderRightColor: 'rgba(255,255,255,0.05)',
    shadowColor: '#000',
    shadowOffset: { width: 4, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 16,
  },
  sidebarInner: { flex: 1, padding: 16 },
  sidebarHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  sidebarTitle: { fontSize: 20, fontWeight: 'bold', color: '#fff' },
  sidebarEmail: { color: '#6b7280', fontSize: 11, marginBottom: 16 },
  newChatBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#2563eb', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 16, marginBottom: 16,
    shadowColor: '#2563eb', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 4, elevation: 4,
  },
  newChatText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },
  sidebarQuota: { marginBottom: 16, paddingHorizontal: 4 },
  sidebarQuotaLabel: { color: '#4b5563', fontSize: 10, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 1 },
  quotaBar: { height: 4, backgroundColor: '#2c2d2e', borderRadius: 2, marginTop: 6, overflow: 'hidden' },
  quotaFill: { height: '100%', backgroundColor: '#3b82f6', borderRadius: 2 },
  sidebarSessionList: { flex: 1, marginBottom: 12 },
  sidebarSearch: {
    backgroundColor: '#18181b', borderColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    color: '#fff', fontSize: 13, marginBottom: 16,
  },
  noSessionsText: { color: '#4b5563', fontSize: 12, textAlign: 'center', marginTop: 20 },
  sessionItem: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 12, paddingHorizontal: 12, borderRadius: 8, marginBottom: 2,
  },
  sessionItemActive: { backgroundColor: 'rgba(59,130,246,0.1)' },
  sessionTitle: { color: '#9ca3af', fontSize: 13, flex: 1 },
  sessionTitleActive: { color: '#fff', fontWeight: '600' },
  sidebarFooter: { gap: 4, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.05)', paddingTop: 12 },
  sidebarFooterBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 4 },
  sidebarFooterText: { color: '#6b7280', fontSize: 13 },

  // ── Offline Banner ──
  offlineBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 16, backgroundColor: 'rgba(239,68,68,0.15)', borderBottomWidth: 1, borderBottomColor: 'rgba(239,68,68,0.3)' },
  offlineText: { color: '#fca5a5', fontSize: 11, textAlign: 'center' },

  // ── Header ──
  header: {
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 40,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20,
    backgroundColor: 'rgba(19, 19, 20, 0.85)',
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerTitle: { fontSize: 18, fontWeight: 'bold', color: '#fff' },
  menuBtn: { padding: 4 },
  quotaBadge: {
    backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3,
  },
  quotaText: { fontSize: 9, fontWeight: 'bold', color: '#9ca3af' },
  avatarCircle: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: '#a855f7', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.15)',
    shadowColor: '#a855f7', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 3, elevation: 3,
  },
  avatarText: { color: '#fff', fontSize: 13, fontWeight: 'bold' },

  // ── Tabs ──
  tabBar: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)', backgroundColor: '#1e1f20' },
  tabButton: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 14, borderBottomWidth: 2, borderBottomColor: 'transparent',
  },
  tabText: { fontSize: 12, fontWeight: '500' },

  // ── Model Selector ──
  modelSelector: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 8, backgroundColor: '#1e1f20', borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  modelSelectorText: { color: '#9ca3af', fontSize: 11, fontWeight: '600' },

  // ── Model Modal ──
  modelRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 4, borderRadius: 8 },
  modelRowActive: { backgroundColor: 'rgba(59,130,246,0.1)' },
  modelName: { color: '#9ca3af', fontSize: 14 },
  modelInfo: { color: '#4b5563', fontSize: 11, marginTop: 2 },

  // ── Chat ──
  chatArea: { flex: 1, backgroundColor: '#131314' },
  chatContent: { padding: 20, gap: 16, paddingBottom: 40 },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', marginTop: 15, paddingHorizontal: 20 },
  emptyTitle: { fontSize: 16, fontWeight: 'bold', color: '#fff', marginBottom: 6 },
  emptySubtitle: { fontSize: 12, color: '#6b7280', textAlign: 'center', lineHeight: 18 },
  messageRow: { flexDirection: 'row', width: '100%' },
  messageUserRow: { justifyContent: 'flex-end' },
  messageAssistantRow: { justifyContent: 'flex-start' },
  bubble: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 20 },
  bubbleUser: { backgroundColor: '#2563eb', borderTopLeftRadius: 20, borderTopRightRadius: 20, borderBottomLeftRadius: 20, borderBottomRightRadius: 4 },
  bubbleAssistant: {
    backgroundColor: '#1e1f20', borderTopLeftRadius: 20, borderTopRightRadius: 20, borderBottomRightRadius: 20, borderBottomLeftRadius: 4,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)',
  },
  messageText: { fontSize: 14, color: '#e5e7eb', lineHeight: 20 },
  msgActionsCol: { flexDirection: 'column', gap: 6, paddingHorizontal: 4, justifyContent: 'flex-start', paddingTop: 8 },
  msgActionBtn: { padding: 4, borderRadius: 4 },
  userMsgActions: { flexDirection: 'row', gap: 4, justifyContent: 'flex-end', marginTop: 4 },
  assistantFeedback: { flexDirection: 'row', gap: 4, marginTop: 4 },
  editInput: {
    backgroundColor: '#131314', borderColor: 'rgba(255,255,255,0.15)',
    borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8,
    color: '#fff', fontSize: 14, minHeight: 60, textAlignVertical: 'top',
  },
  editActions: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end', marginTop: 6 },
  editBtn: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 6 },
  scrollDownBtn: {
    position: 'absolute', bottom: 16, alignSelf: 'center',
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#3b82f6', alignItems: 'center', justifyContent: 'center',
    elevation: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4,
  },

  // ── Image Preview ──
  imagePreviewContainer: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
    backgroundColor: '#131314',
    flexDirection: 'row',
  },
  imagePreviewCard: {
    width: 80,
    height: 80,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.15)',
    position: 'relative',
    overflow: 'visible',
  },
  imagePreviewImgPremium: {
    width: '100%',
    height: '100%',
    borderRadius: 10,
    resizeMode: 'cover',
  },
  imagePreviewCloseBtn: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#ef4444',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 1.5,
    elevation: 3,
  },
  imagePreviewScanBtn: {
    position: 'absolute',
    bottom: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#a855f7',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 1.5,
    elevation: 3,
  },

  // ── Input Bar ──
  inputBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: '#1e1f20', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 28, marginHorizontal: 14, marginBottom: 14, marginTop: 4,
    gap: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 5, elevation: 6,
  },
  cameraIcon: {
    padding: 8, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.03)',
    alignItems: 'center', justifyContent: 'center',
  },
  textInput: {
    flex: 1, backgroundColor: '#131314', borderColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1, borderRadius: 24, paddingHorizontal: 16, paddingVertical: 8,
    color: '#fff', fontSize: 14,
  },
  sendIcon: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: '#3b82f6', alignItems: 'center', justifyContent: 'center',
  },
  sendIconDisabled: { backgroundColor: '#131314', borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)', opacity: 0.5 },
  stopIcon: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: '#ef4444', alignItems: 'center', justifyContent: 'center',
  },

  // ── Error Banner ──
  errorBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 10, paddingHorizontal: 16,
    backgroundColor: 'rgba(239,68,68,0.12)', borderBottomWidth: 1, borderBottomColor: 'rgba(239,68,68,0.25)',
  },
  errorBannerText: { color: '#fca5a5', fontSize: 12, flex: 1 },

  // ── Listening Bar ──
  listeningBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 8, paddingHorizontal: 16,
    backgroundColor: 'rgba(239,68,68,0.08)',
  },
  listeningText: { color: '#ef4444', fontSize: 12, fontWeight: '600' },

  // ── Modals ──
  modalOverlay: { position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', zIndex: 999, padding: 24 },
  modalContent: { width: '100%', maxWidth: 400, backgroundColor: '#0c0c0e', borderRadius: 16, padding: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  modalInput: { backgroundColor: '#18181b', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, color: '#fff', fontSize: 14, marginBottom: 12 },
  modalButton: { backgroundColor: '#3b82f6', borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 4 },

  // ── Dashboard ──
  dashboardContainer: { flex: 1, backgroundColor: '#131314' },
  dashboardInner: { flex: 1, backgroundColor: '#131314' },

  // ── Quick Prompts ──
  quickPromptsGrid: { width: '100%', gap: 10, marginTop: 24 },
  quickPromptCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#1e1f20', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
    borderRadius: 12, paddingHorizontal: 16, paddingVertical: 11,
  },
  quickPromptText: { color: '#e5e7eb', fontSize: 13, fontWeight: '500' },

  // ── Lightbox Modal ──
  lightboxContainer: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  lightboxImage: {
    width: '100%',
    height: '80%',
  },
  lightboxCloseBtn: {
    position: 'absolute',
    right: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
});
