import { Platform } from 'react-native';
import { auth } from './firebase';

// Helper to retrieve the current user's Firebase ID Token (JWT)
async function getAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const currentUser = auth.currentUser;
  if (currentUser) {
    try {
      const token = await currentUser.getIdToken();
      headers['Authorization'] = `Bearer ${token}`;
    } catch (err) {
      console.warn('[API] Failed to retrieve Firebase ID token:', err);
    }
  }
  return headers;
}

// Resolve localhost to the host machine IP when running on Android Emulator
const getBaseUrl = () => {
  const url = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000';
  if (Platform.OS === 'android' && url.includes('localhost')) {
    return url.replace('localhost', '10.0.2.2');
  }
  return url;
};

export const BASE_URL = getBaseUrl();

export interface ApiMessage {
  role: 'user' | 'assistant';
  content: string;
  id?: string;
  feedback?: 'up' | 'down' | null;
}

export interface QuotaData {
  tier: 'free' | 'pro';
  limit: number;
  usage: number;
  remaining: number | string;
}

/**
 * Submit chat query to the backend Next.js server.
 * Uses response.text() instead of ReadableStream for reliable Hermes support.
 */
export async function askQuestion(params: {
  messages: ApiMessage[];
  provider: 'google' | 'groq' | 'deepseek';
  model: string;
  image?: string | null;
  userId: string;
  signal?: AbortSignal;
  onChunk: (text: string) => void;
}): Promise<{ text: string; actualModel: string | null }> {
  const { messages, provider, model, image, userId, signal, onChunk } = params;

  const headers = await getAuthHeaders();
  const response = await fetch(`${BASE_URL}/api/ask`, {
    method: 'POST',
    headers,
    signal,
    body: JSON.stringify({ messages, provider, model, image, userId, stream: false }),
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.error || `Server responded with ${response.status}`);
  }

  const actualModel = response.headers.get('X-Resolved-Model');
  const fallbackApplied = response.headers.get('X-Fallback-Applied') === 'true';

  const text = await response.text();
  
  let finalText = text;
  if (fallbackApplied && actualModel) {
    finalText = `> ⚠️ **Auto-Fallback**: Switched model due to API rate limits.\n\n` + text;
  }

  onChunk(finalText);
  return { text: finalText, actualModel };
}

/**
 * Saves chat message to the backend Firestore database securely.
 * Automatically creates a new study session if sessionId is passed as 'new'.
 */
export async function saveChatMessage(params: {
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  provider: 'google' | 'groq' | 'deepseek';
  userId: string;
}): Promise<{ success: boolean; messageId: string; sessionId: string }> {
  try {
    const headers = await getAuthHeaders();
    const response = await fetch(`${BASE_URL}/api/chats`, {
      method: 'POST',
      headers,
      body: JSON.stringify(params),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || 'Failed to save chat message');
    }

    return await response.json();
  } catch (error) {
    console.error('[API] saveChatMessage failed:', error);
    throw error;
  }
}

/**
 * Performs local engine OCR via your Next.js OCR endpoint.
 */
export async function runOcr(imageBase64: string, userId: string) {
  try {
    const headers = await getAuthHeaders();
    const response = await fetch(`${BASE_URL}/api/ocr`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        image: imageBase64,
        userId,
      }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || 'Failed to process image');
    }

    return await response.json();
  } catch (error) {
    console.error('[API] OCR failed:', error);
    throw error;
  }
}

/**
 * Retreives current daily remaining quotas for a given user.
 */
export async function fetchQuota(userId: string): Promise<QuotaData> {
  try {
    const headers = await getAuthHeaders();
    delete headers['Content-Type']; // GET request doesn't need content-type
    const response = await fetch(`${BASE_URL}/api/quota?userId=${userId}`, {
      headers,
    });
    if (!response.ok) {
      throw new Error('Failed to retrieve quota data.');
    }
    return await response.json();
  } catch (error) {
    console.error('[API] Quota fetch failed:', error);
    throw error;
  }
}
