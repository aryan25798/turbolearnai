import { adminDb } from '@/lib/firebaseAdmin';
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthToken } from '@/lib/server/security';

export const runtime = 'nodejs';

const BATCH_LIMIT = 500;

async function commitOrChunk(refs: any[]) {
  for (let i = 0; i < refs.length; i += BATCH_LIMIT) {
    const chunk = refs.slice(i, i + BATCH_LIMIT);
    const batch = adminDb.batch();
    chunk.forEach((ref: any) => batch.delete(ref));
    await batch.commit();
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { sessionId, adminUid: bodyAdminUid } = body;

    if (!sessionId) {
      return NextResponse.json({ error: "Missing Target Session ID" }, { status: 400 });
    }

    let adminUid: string;
    try {
      adminUid = await verifyAuthToken(req, bodyAdminUid || undefined);
    } catch (authError: any) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 1. Verify Requestor is Admin
    const adminSnap = await adminDb.collection('users').doc(adminUid).get();
    if (!adminSnap.exists || adminSnap.data()?.role !== 'admin') {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    // 2. Collect all document references to delete
    const toDelete: any[] = [];

    // A. Chats messages belonging to sessionId
    const chatsQuery = await adminDb.collection('chats').where('sessionId', '==', sessionId).get();
    chatsQuery.docs.forEach(chatDoc => toDelete.push(chatDoc.ref));

    // B. Session document itself
    const sessionRef = adminDb.collection('sessions').doc(sessionId);
    toDelete.push(sessionRef);

    // 3. Delete in chunked batches (Firestore limit: 500 ops per batch)
    await commitOrChunk(toDelete);

    console.log(`✅ Permanently purged session ${sessionId} and ${chatsQuery.docs.length} chat message records.`);
    return NextResponse.json({ success: true, purgedMessagesCount: chatsQuery.docs.length });

  } catch (error: any) {
    console.error("Purge Chat Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
