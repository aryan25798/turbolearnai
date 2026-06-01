import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { verifyUser, verifyAuthToken } from '@/lib/server/security';
import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';

export const runtime = 'nodejs';

// Zod validation schema for secure writes
const ChatSaveSchema = z.object({
  sessionId: z.string().min(1),
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(100000),
  provider: z.enum(['google', 'groq', 'deepseek']),
  userId: z.string().min(1),
  image: z.string().nullable().optional(),
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    console.log("📥 Chats Request Body:", JSON.stringify(body, null, 2));
    const parseResult = ChatSaveSchema.safeParse(body);
    
    if (!parseResult.success) {
      console.warn("🚨 Chats Zod Parse Failed:", JSON.stringify(parseResult.error.format(), null, 2));
      return NextResponse.json({ error: "Invalid request payload", details: parseResult.error }, { status: 400 });
    }

    const { sessionId, role, content, provider, userId: bodyUserId, image } = parseResult.data;

    let userId: string;
    try {
      userId = await verifyAuthToken(req, bodyUserId);
    } catch (authError: any) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 🔒 SECURITY CHECK: Ensure requesting student is approved & active
    try {
      await verifyUser(userId);
    } catch (authError: any) {
      const status = authError.message.includes('Access Denied') ? 403 : 500;
      return NextResponse.json({ error: status === 403 ? "Access Denied" : "Authentication Failed" }, { status });
    }

    let activeSessionId = sessionId;

    // 🧠 Dynamic session creation on first message
    if (sessionId === 'new' || !sessionId) {
      const sessionTitle = content.substring(0, 30) + (content.length > 30 ? '...' : '');
      const sessionRef = await adminDb.collection('sessions').add({
        userId,
        title: sessionTitle || 'Study Session',
        createdAt: FieldValue.serverTimestamp(),
        deletedByUser: false,
      });
      activeSessionId = sessionRef.id;
    }

    // Save chat message via Firebase Admin Firestore
    const docRef = await adminDb.collection('chats').add({
      sessionId: activeSessionId,
      role,
      content,
      provider,
      createdAt: FieldValue.serverTimestamp(),
      ...(image ? { image } : {}),
    });

    return NextResponse.json({ 
      success: true, 
      messageId: docRef.id,
      sessionId: activeSessionId 
    });

  } catch (error: any) {
    console.error('🔥 Save Chat API Error:', error);
    return NextResponse.json({ error: 'Failed to save chat message' }, { status: 500 });
  }
}
