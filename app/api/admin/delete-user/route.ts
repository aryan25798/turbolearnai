import { adminDb, adminAuth } from '@/lib/firebaseAdmin';
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
    const { uid, adminUid: bodyAdminUid } = body;

    if (!uid) {
      return NextResponse.json({ error: "Missing Target UID" }, { status: 400 });
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

    // A. Sessions + their chats
    const sessionsQuery = await adminDb.collection('sessions').where('userId', '==', uid).get();
    for (const sessionDoc of sessionsQuery.docs) {
      const chatsQuery = await adminDb.collection('chats').where('sessionId', '==', sessionDoc.id).get();
      chatsQuery.docs.forEach(chatDoc => toDelete.push(chatDoc.ref));
      toDelete.push(sessionDoc.ref);
    }

    // B. Support chat messages + doc
    const supportRef = adminDb.collection('support_chats').doc(uid);
    const supportMsgsQuery = await supportRef.collection('messages').get();
    supportMsgsQuery.docs.forEach(msgDoc => toDelete.push(msgDoc.ref));
    toDelete.push(supportRef);

    // C. User document
    toDelete.push(adminDb.collection('users').doc(uid));

    // 3. Delete in chunked batches (Firestore limit: 500 ops per batch)
    await commitOrChunk(toDelete);

    // 3.5 Purge all uploaded binary images in Firebase Storage to ensure zero storage costs
    try {
      const bucketName = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
      if (bucketName) {
        const admin = await import('firebase-admin');
        const bucket = admin.default.storage().bucket(bucketName);
        await bucket.deleteFiles({
          prefix: `chat-images/${uid}/`
        });
        console.log(`✅ Cleaned up all Firebase Storage assets for user: ${uid}`);
      }
    } catch (storageError: any) {
      console.warn("⚠️ Firebase Storage asset cleanup skipped or failed:", storageError.message);
    }

    // 4. Delete Authentication Record (Firebase Auth)
    try {
        await adminAuth.deleteUser(uid);
    } catch (authError) {
        console.warn("Auth user not found or already deleted:", authError);
    }

    return NextResponse.json({ success: true });

  } catch (error: any) {
    console.error("Delete User Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}