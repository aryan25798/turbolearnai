import { streamText } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createGroq } from '@ai-sdk/groq';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createOpenAI } from '@ai-sdk/openai';
import { adminDb } from '@/lib/firebaseAdmin'; 
import { z } from 'zod'; 
import { verifyUser, verifyAuthToken } from '@/lib/server/security'; 
import { after } from 'next/server'; 
import { redis } from '@/lib/redis'; 

async function getKeyIndex(providerKey: string): Promise<number> {
  try {
    const val = await redis.get(`key_index:${providerKey}`);
    return val ? parseInt(val, 10) : 0;
  } catch {
    return 0;
  }
}

async function advanceKeyIndex(providerKey: string, current: number, max: number): Promise<number> {
  const next = (current + 1) % max;
  try {
    await redis.set(`key_index:${providerKey}`, next, 'EX', 86400);
  } catch {
    // best effort
  }
  return next;
}

// ⚠️ SECURITY: Must be 'nodejs' to use Firebase Admin
export const runtime = 'nodejs';

type MessageContent = string | { type: string; text?: string; image?: string }[];

interface ChatMessage {
  role: string;
  content: MessageContent;
}

// 📝 CONFIGURATION: System Prompts
const PROMPTS = {
  ACADEMIC: `
You are TurboLearn AI, an elite academic engine.
RULES:
1. **Direct Answer**: Output the final answer immediately. No filler words.
2. **Concise**: Use bullet points. Keep it punchy.
3. **Format**: Use Markdown. **Bold** key terms. LaTeX for math ($x^2$).
4. **Context**: You have a massive context window. Use the full history to provide continuity.
`,
  REASONING: "You are a helpful academic assistant. Answer directly and concisely using Markdown."
};

// Initialize OpenRouter client (OpenAI-compatible)
const openrouter = createOpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY || '',
  headers: {
    'HTTP-Referer': 'https://turbolearn.ai',
    'X-Title': 'TurboLearn AI',
  }
});

// Helper function to query Hugging Face Serverless Inference endpoint
async function queryHuggingFace(modelId: string, prompt: string): Promise<string> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout

    const response = await fetch(`https://api-inference.huggingface.co/models/${modelId}`, {
      headers: { 
        Authorization: `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
        'Content-Type': 'application/json' 
      },
      method: 'POST',
      body: JSON.stringify({ inputs: prompt }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Hugging Face API returned status ${response.status}: ${errText}`);
    }
    
    const result = await response.json();
    if (Array.isArray(result) && result[0]) {
      return result[0].generated_text || JSON.stringify(result[0]);
    }
    return typeof result === 'string' ? result : JSON.stringify(result);
  } catch (error: unknown) {
    console.error(`Hugging Face Inference failed for model ${modelId}:`, error);
    const msg = error instanceof Error ? error.message : String(error);
    return `Error querying Hugging Face Serverless Inference endpoint: ${msg}`;
  }
}

// Parse Gemini API keys
const geminiKeys = process.env.GEMINI_API_KEYS 
  ? process.env.GEMINI_API_KEYS.split(',').map(k => k.trim()).filter(Boolean)
  : (process.env.GEMINI_API_KEY ? [process.env.GEMINI_API_KEY] : []);
console.log(`🔑 Gemini keys loaded: ${geminiKeys.length} (via ${process.env.GEMINI_API_KEYS ? 'GEMINI_API_KEYS' : 'GEMINI_API_KEY'})`);

// Parse Groq API keys
const groqKeys = process.env.GROQ_API_KEYS
  ? process.env.GROQ_API_KEYS.split(',').map(k => k.trim()).filter(Boolean)
  : [process.env.GROQ_API_KEY].filter(Boolean);

// Parse OpenRouter API keys
const openrouterKeys = process.env.OPENROUTER_API_KEYS
  ? process.env.OPENROUTER_API_KEYS.split(',').map(k => k.trim()).filter(Boolean)
  : [process.env.OPENROUTER_API_KEY].filter(Boolean);

// Parse DeepSeek API keys
const deepseekKeys = process.env.DEEPSEEK_API_KEYS
  ? process.env.DEEPSEEK_API_KEYS.split(',').map(k => k.trim()).filter(Boolean)
  : [process.env.DEEPSEEK_API_KEY].filter(Boolean);

// Vision-supported models list
const VISION_MODELS = [
  'gemini-3.5-flash',
  'gemini-2.5-flash', 
  'gemini-1.5-flash', 
  'llama-3.2-11b-vision-preview', 
  'llama-3.2-11b-vision', 
  'gpt-4o-mini',
  'nvidia/nemotron-nano-12b-v2-vl:free'
];

// ✅ Validation Schema
const AskSchema = z.object({
  messages: z.array(z.object({
    role: z.string(),
    content: z.union([
        z.string().max(100000, "Message too long."), 
        z.array(z.any())
    ]), 
  })),
  provider: z.enum(['google', 'groq', 'deepseek']), 
  model: z.string().optional(), 
  image: z.string().nullable().optional(),
  userId: z.string().min(1, "User ID is required"),
  stream: z.boolean().optional().default(true),
});

export async function POST(req: Request) {
  try {
    // 1. Extract & Validate Data
    const body = await req.json();
    const parseResult = AskSchema.safeParse(body);
    
    if (!parseResult.success) {
      return new Response(JSON.stringify({ error: "Invalid Request Data" }), { status: 400 });
    }
    
    const { messages, provider, model: modelParam, image, userId: bodyUserId, stream } = parseResult.data;

    // 2. SECURITY, TIER CHECK & RATE LIMITING
    let userId: string;
    try {
      userId = await verifyAuthToken(req, bodyUserId);
    } catch {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { 
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    try {
      const today = new Date().toISOString().split('T')[0]; // Format: YYYY-MM-DD
      const dailyUsageKey = `usage:${userId}:${today}`;

      // 🔒 SEQUENTIAL EXECUTION
      const userData = await verifyUser(userId); 
      
      // ✅ TIER LOGIC (runs regardless of Redis health)
      const userTier = userData.tier || 'free';
      const dailyLimit = userData.customQuota ?? 50; 

      // ✅ RATE LIMIT CHECK: Try Redis first, fall back to Firestore if Redis is down
      let currentUsage = 0;
      try {
        const requestCount = await redis.incr(dailyUsageKey);
        currentUsage = requestCount as number;

        // ⚡️ EXPIRY MANAGEMENT (only on first request of the day)
        if (currentUsage === 1) {
          after(async () => {
            try { await redis.expire(dailyUsageKey, 86400); } catch (e) {
              console.error("Failed to set Redis expiry:", e);
            }
          });
        }
      } catch (redisError) {
        // Redis is down — fall back to Firestore-based counting to keep the app online
        console.warn("Redis unavailable, using Firestore fallback for rate limit:", redisError);
        const fallbackKey = `usage_fallback:${userId}:${today}`;
        const fallbackRef = adminDb.collection('_counters').doc(fallbackKey);
        currentUsage = await adminDb.runTransaction(async (tx) => {
          const snap = await tx.get(fallbackRef);
          const count = (snap.data()?.count ?? 0) + 1;
          tx.set(fallbackRef, { count, updatedAt: new Date() }, { merge: true });
          return count;
        });
        // Clean up old fallback counters after 48h (run in background)
        after(async () => {
          try {
            const twoDaysAgo = new Date(Date.now() - 172800000).toISOString().split('T')[0];
            const oldKey = `usage_fallback:${userId}:${twoDaysAgo}`;
            await adminDb.collection('_counters').doc(oldKey).delete();
          } catch { /* best effort */ }
        });
      }

      // 🛑 BLOCKING CHECK
      if (userTier !== 'pro' && currentUsage >= dailyLimit) {
         return new Response(JSON.stringify({ 
             error: "Daily limit exhausted. Upgrade to Pro for unlimited access.",
             code: "QUOTA_EXCEEDED"
         }), { status: 429 });
      }

    } catch (error: unknown) {
      console.error("🔥 Security Check Failed:", error);
      const errMsg = error instanceof Error ? error.message : '';
      const status = errMsg.includes("Access Denied") ? 403 : 500;
      return new Response(JSON.stringify({ error: status === 403 ? "Access Denied" : "Security verification failed" }), { status });
    }

    // 3. Resolve Model Selection & Attributes
    let systemPrompt = PROMPTS.ACADEMIC;
    let maxTokens = 1024; // Default limit
    let temperature = 0.1; // Default low temperature for reasoning consistency

    let resolvedModelName = modelParam || '';
    if (!resolvedModelName) {
      // Backward-compatibility fallback defaults
      if (provider === 'google') resolvedModelName = 'gemini-2.5-flash';
      else if (provider === 'groq') resolvedModelName = 'llama-3.3-70b-versatile';
      else resolvedModelName = 'huggingface/deepseek-ai/DeepSeek-R1-Distill-Qwen-32B';
    }

    // Configure model specific tokens and prompts
    if (resolvedModelName.includes('gemini')) {
      maxTokens = 8192;
    } else if (resolvedModelName.includes('llama') || resolvedModelName.toLowerCase().includes('deepseek-r1-distill')) {
      maxTokens = 1024;
    } else if (resolvedModelName.startsWith('deepseek-')) {
      maxTokens = 4096;
      if (resolvedModelName === 'deepseek-reasoner') {
        systemPrompt = PROMPTS.REASONING;
        temperature = undefined as any;
      } else {
        temperature = 0.7;
      }
    }

    // Check vision support
    const supportsVision = VISION_MODELS.some(vm => resolvedModelName.toLowerCase().includes(vm));

    // Safeguard: If model doesn't support photos but photo is attached, return immediately
    if (image && !supportsVision) {
      return new Response("This model doesn't take photos as input. Please choose a model that supports vision (like Gemini or Llama 3.2 Vision).", { status: 200 });
    }

    // 5. Context Window Management
    const recentMessages = messages; 

    // 7. Stream Response with Robust Key Rotation & Failover
    let attempts = 0;

    // Helper to read key start index for the current model
    async function getStartIndexForModel(model: string): Promise<number> {
      if (model.startsWith('huggingface/')) return 0;
      const keyType = model.includes('gemini') ? 'gemini' :
                      model.includes(':free') || model.includes('openrouter') ? 'openrouter' :
                      model.includes('llama') || model.toLowerCase().includes('deepseek-r1-distill') ? 'groq' :
                      model.startsWith('deepseek-') ? 'deepseek' : '';
      return keyType ? getKeyIndex(keyType) : 0;
    }

    // Helper to compute maxAttempts for the current model
    function getMaxAttemptsForModel(model: string): number {
      if (model.startsWith('huggingface/')) return 1;
      if (model.includes('gemini')) return Math.max(1, geminiKeys.length);
      if (model.includes(':free') || model.includes('openrouter')) return Math.max(1, openrouterKeys.length);
      if (model.includes('llama') || model.toLowerCase().includes('deepseek-r1-distill')) return Math.max(1, groqKeys.length);
      if (model.startsWith('deepseek-')) return Math.max(1, deepseekKeys.length);
      return 1;
    }

    let startIndex = await getStartIndexForModel(resolvedModelName);
    let maxAttempts = getMaxAttemptsForModel(resolvedModelName);

    let result = null;
    let lastError = null;

    while (attempts < maxAttempts) {
      try {
        // Re-evaluate vision support dynamically for the CURRENT resolved fallback model tier
        const currentSupportsVision = VISION_MODELS.some(vm => resolvedModelName.toLowerCase().includes(vm));

        // MESSAGE SANITIZATION & FILTERING (Dynamically rebuilt for vision vs text-only transition)
        const coreMessages = recentMessages
          .map((m: ChatMessage, index: number) => {
            let finalContent: MessageContent = m.content;

            if (currentSupportsVision) {
              if (index === recentMessages.length - 1 && m.role === 'user' && image) {
                const userText = Array.isArray(m.content) 
                  ? m.content.map((c: { text?: string }) => c.text || '').join('') 
                  : m.content;
                  
                return {
                  role: 'user',
                  content: [
                    { type: 'text', text: userText || ' ' }, 
                    { type: 'image', image: image } 
                  ]
                };
              }
            } 
            
            if (Array.isArray(m.content)) {
              finalContent = m.content
                .filter((c: { type: string }) => c.type === 'text')
                .map((c: { text?: string }) => c.text || '')
                .join('\n');
            }

            return {
              role: m.role,
              content: finalContent
            };
          })
          .filter((m: ChatMessage) => {
            if (!m.content) return false;
            if (typeof m.content === 'string' && m.content.trim() === '') return false;
            if (Array.isArray(m.content) && m.content.length === 0) return false;
            return true;
          });

        let modelInstance: ReturnType<ReturnType<typeof createGoogleGenerativeAI>> | ReturnType<ReturnType<typeof createGroq>> | ReturnType<ReturnType<typeof createDeepSeek>> | ReturnType<ReturnType<typeof createOpenAI>> | null = null;

        if (resolvedModelName.includes('gemini')) {
          const currentKeyIndex = (startIndex + attempts) % geminiKeys.length;
          const key = geminiKeys[currentKeyIndex];
          if (!key) throw new Error("No Gemini API key available.");
          const customGoogle = createGoogleGenerativeAI({ apiKey: key });
          modelInstance = customGoogle(resolvedModelName);
        } else if (resolvedModelName.startsWith('huggingface/')) {
          const hfModelId = resolvedModelName.replace('huggingface/', '');
          const userPrompt = coreMessages.map((m: ChatMessage) => {
            const text = typeof m.content === 'string'
              ? m.content
              : Array.isArray(m.content)
                ? m.content.map((c: { text?: string }) => c.text || '').join(' ')
                : '';
            return `${m.role === 'user' ? 'User' : 'Assistant'}: ${text}`;
          }).join('\n');
          
          const answer = await queryHuggingFace(hfModelId, userPrompt);
          if (answer.startsWith('Error querying Hugging Face')) {
            throw new Error(answer);
          }
          
          result = {
            text: Promise.resolve(answer),
            toTextStreamResponse: () => new Response(answer, { headers: { 'Content-Type': 'text/plain' } })
          };
        } else if (resolvedModelName.includes(':free') || resolvedModelName.includes('openrouter')) {
          const currentKeyIndex = (startIndex + attempts) % openrouterKeys.length;
          const key = openrouterKeys[currentKeyIndex];
          if (!key) throw new Error("No OpenRouter API key available.");
          const customOpenRouter = createOpenAI({
            baseURL: 'https://openrouter.ai/api/v1',
            apiKey: key,
            headers: {
              'HTTP-Referer': 'https://turbolearn.ai',
              'X-Title': 'TurboLearn AI',
            }
          });
          modelInstance = customOpenRouter.chat(resolvedModelName);
        } else if (resolvedModelName.includes('llama') || resolvedModelName.toLowerCase().includes('deepseek-r1-distill')) {
          const currentKeyIndex = (startIndex + attempts) % groqKeys.length;
          const key = groqKeys[currentKeyIndex];
          if (!key) throw new Error("No Groq API key available.");
          const customGroq = createGroq({ apiKey: key });
          modelInstance = customGroq(resolvedModelName);
        } else if (resolvedModelName.startsWith('deepseek-')) {
          const currentKeyIndex = (startIndex + attempts) % deepseekKeys.length;
          const key = deepseekKeys[currentKeyIndex];
          if (!key) throw new Error("No DeepSeek API key available.");
          const customDeepSeek = createDeepSeek({ apiKey: key });
          modelInstance = customDeepSeek(resolvedModelName);
        } else {
          throw new Error(`Unsupported model: ${resolvedModelName}`);
        }

        if (!result) {
          if (!modelInstance) throw new Error(`Failed to create model instance for ${resolvedModelName}`);
          const streamTextResult = await streamText({
            model: modelInstance,
            system: systemPrompt,
            messages: coreMessages as any, 
            temperature: temperature, 
            maxOutputTokens: maxTokens,
            maxRetries: 0,
          });

          // 🔍 Validate that the stream is non-empty by peeking at the first chunk.
          // Some providers (e.g. Gemini 503 "high demand") return a 200 Response with
          // an empty body instead of throwing — that skips our catch block and fallback.
          const textIterator = streamTextResult.textStream[Symbol.asyncIterator]();
          const first = await textIterator.next();
          if (first.done) {
            throw new Error(`AI model "${resolvedModelName}" returned empty response (likely overloaded)`);
          }

          // Consume remaining chunks
          const chunks = [first.value];
          for await (const chunk of { [Symbol.asyncIterator]: () => textIterator }) {
            chunks.push(chunk);
          }

          // Rebuild result with the validated, fully-buffered response
          const fullText = chunks.join('');
          const encoder = new TextEncoder();
          let chunkIndex = 0;
          result = {
            text: Promise.resolve(fullText),
            toTextStreamResponse: () => new Response(
              new ReadableStream({
                pull(controller) {
                  if (chunkIndex >= chunks.length) {
                    controller.close();
                    return;
                  }
                  controller.enqueue(encoder.encode(chunks[chunkIndex++]));
                }
              }),
              { headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
            )
          };
        }

        // Persist the successful key index to Redis for cross-instance rotation
        const currentKeyType = resolvedModelName.includes('gemini') ? 'gemini' :
                               resolvedModelName.includes(':free') || resolvedModelName.includes('openrouter') ? 'openrouter' :
                               resolvedModelName.includes('llama') || resolvedModelName.toLowerCase().includes('deepseek-r1-distill') ? 'groq' :
                               resolvedModelName.startsWith('deepseek-') ? 'deepseek' : '';
        const keysLen = resolvedModelName.includes('gemini') ? geminiKeys.length :
                        resolvedModelName.includes(':free') || resolvedModelName.includes('openrouter') ? openrouterKeys.length :
                        resolvedModelName.includes('llama') || resolvedModelName.toLowerCase().includes('deepseek-r1-distill') ? groqKeys.length :
                        resolvedModelName.startsWith('deepseek-') ? deepseekKeys.length : 0;
        if (currentKeyType && keysLen > 0) {
          const successfulIndex = (startIndex + attempts) % keysLen;
          await advanceKeyIndex(currentKeyType, successfulIndex, keysLen);
        }
        break;
      } catch (streamError: unknown) {
        lastError = streamError;
        const errMessage = streamError instanceof Error ? streamError.message : String(streamError);
        const errorMsg = errMessage.toLowerCase();
        const isQuotaExceeded = errorMsg.includes('quota') || 
                                errorMsg.includes('limit') || 
                                errorMsg.includes('429') || 
                                errorMsg.includes('resource_exhausted') ||
                                (streamError instanceof Object && 'statusCode' in streamError && (streamError as { statusCode: number }).statusCode === 429);
        
        let isRetryable = false;
        if (resolvedModelName.includes('gemini')) isRetryable = geminiKeys.length > 1;
        else if (resolvedModelName.includes(':free') || resolvedModelName.includes('openrouter')) isRetryable = openrouterKeys.length > 1;
        else if (resolvedModelName.includes('llama') || resolvedModelName.toLowerCase().includes('deepseek-r1-distill')) isRetryable = groqKeys.length > 1;
        else if (resolvedModelName.startsWith('deepseek-')) isRetryable = deepseekKeys.length > 1;

        // If more keys are available for this provider, rotate to the next one.
        // This handles both transient errors and quota-exceeded across multiple keys/projects.
        const isTransientError = !isQuotaExceeded;

        // For transient errors (503 high demand, 500 internal), skip key rotation immediately —
        // rotating keys won't help because ALL keys hit the same overloaded model.
        if (attempts + 1 < maxAttempts && isRetryable && !isTransientError) {
          const providerName = resolvedModelName.includes('gemini') ? 'Gemini' :
                               resolvedModelName.includes(':free') ? 'OpenRouter' :
                               resolvedModelName.startsWith('deepseek-') ? 'DeepSeek' : 'Groq';
          
          console.log(`[KEY_ROTATE] ${providerName} key ${(startIndex + attempts) % maxAttempts} failed (${errMessage.slice(0, 40)}). Rotating to key ${(startIndex + attempts + 1) % maxAttempts}...`);
          attempts++;
        } else {
          // 🚨 ULTRA-ROBUST 5-STAGE SELF-HEALING FALLBACK PIPELINE!
          // If we reach here, we have exhausted keys or hit quota limits. We failover dynamically:

          // Check if the current model is ANY Gemini variant, then fall back directly to Groq
          const isGeminiModel = resolvedModelName.includes('gemini');
          const isDeepSeekModel = resolvedModelName.startsWith('deepseek-');
          const isHuggingFaceModel = resolvedModelName.startsWith('huggingface/');

          if (isGeminiModel) {
            console.log(`[FALLBACK] Gemini "${resolvedModelName}" ${isQuotaExceeded ? 'quota' : 'error'} after ${attempts + 1}/${maxAttempts} keys. Switching to Groq Llama 3.3...`);
            resolvedModelName = 'llama-3.3-70b-versatile';
            attempts = 0;
            maxAttempts = getMaxAttemptsForModel(resolvedModelName);
            startIndex = await getStartIndexForModel(resolvedModelName);
            result = null;
          } else if (isDeepSeekModel || isHuggingFaceModel) {
            // DeepSeek / HuggingFace → fall back to Gemini → then Groq if needed
            console.log(`[FALLBACK] ${isDeepSeekModel ? 'DeepSeek' : 'HuggingFace'} "${resolvedModelName}" failed. Switching to Gemini 2.5 Flash...`);
            resolvedModelName = 'gemini-2.5-flash';
            attempts = 0;
            maxAttempts = getMaxAttemptsForModel(resolvedModelName);
            startIndex = await getStartIndexForModel(resolvedModelName);
            result = null;
          } else if (resolvedModelName === 'llama-3.3-70b-versatile') {
            console.log("[FALLBACK] Groq Llama 3.3 failed. Switching to OpenRouter Llama 3.1 8B Free...");
            resolvedModelName = 'meta-llama/llama-3.1-8b-instruct:free';
            attempts = 0;
            maxAttempts = getMaxAttemptsForModel(resolvedModelName);
            startIndex = await getStartIndexForModel(resolvedModelName);
            result = null;
          } else if (resolvedModelName === 'meta-llama/llama-3.1-8b-instruct:free') {
            console.log("[FALLBACK] OpenRouter Llama 3.1 failed. Switching to OpenRouter Auto Free Router...");
            resolvedModelName = 'openrouter/free';
            attempts = 0;
            maxAttempts = getMaxAttemptsForModel(resolvedModelName);
            startIndex = await getStartIndexForModel(resolvedModelName);
            result = null;
          } else {
            // Already at the final fallback tier and failed. Throw to terminate gracefully.
            throw streamError;
          }
        }
      }
    }

    if (!result) {
      throw lastError || new Error("Failed to process request");
    }

    const fallbackApplied = resolvedModelName !== modelParam;

    // Non-streaming mode for mobile (Hermes ReadableStream workaround)
    if (stream === false) {
      const fullText = (await result.text).trim();
      return new Response(fullText || "The model returned an empty response.", {
        status: 200,
        headers: { 
          'Content-Type': 'text/plain',
          'X-Resolved-Model': resolvedModelName,
          'X-Fallback-Applied': fallbackApplied ? 'true' : 'false',
          'Access-Control-Expose-Headers': 'X-Resolved-Model, X-Fallback-Applied'
        },
      });
    }

    const response = result.toTextStreamResponse();
    response.headers.set('X-Resolved-Model', resolvedModelName);
    response.headers.set('X-Fallback-Applied', fallbackApplied ? 'true' : 'false');
    response.headers.set('Access-Control-Expose-Headers', 'X-Resolved-Model, X-Fallback-Applied');
    return response;

  } catch (error) {
    console.error("🔥 AI Error:", error);
    return new Response(JSON.stringify({ error: "Failed to process request" }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}