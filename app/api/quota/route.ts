import { NextResponse } from 'next/server';
import { verifyUser, verifyAuthToken } from '@/lib/server/security';
import { redis } from '@/lib/redis';

// ⚡️ PERFORMANCE: Force dynamic to ensure real-time quota data.
// We explicitly disable caching because quota changes seconds-by-second.
export const dynamic = 'force-dynamic';

interface QuotaResponse {
  tier: 'free' | 'pro' | 'admin';
  limit: number | 'Unlimited';
  usage: number;
  remaining: number | 'Unlimited';
  resetAt: string;
  isPro: boolean;
}

export async function GET(req: Request) {
  try {
    // 1. Extract User ID
    const { searchParams } = new URL(req.url);
    const searchUserId = searchParams.get('userId');

    let userId: string;
    try {
      userId = await verifyAuthToken(req, searchUserId || undefined);
    } catch (authError: any) {
      return NextResponse.json({ error: authError.message }, { status: 401 });
    }

    // 2. Prepare Keys
    // Matches logic in api/ask: usage resets when the UTC date string changes.
    const today = new Date().toISOString().split('T')[0];
    const usageKey = `usage:${userId}:${today}`;

    // 3. Sequential Data Fetching
    // Redis is fetched first (best-effort), then userData from verifyUser.
    // We avoid Promise.all because redis.get can throw when Redis is down,
    // which would cause the entire chain to fail unnecessarily.
    let currentUsageRaw = null;
    try {
      currentUsageRaw = await redis.get(usageKey);
    } catch {
      // Redis unavailable — usage tracking is best-effort for read-only quota
    }
    
    const userData = await verifyUser(userId);

    // 4. Data Normalization
    // Redis returns null if key doesn't exist (0 usage), or a string number.
    const usage = currentUsageRaw ? parseInt(currentUsageRaw, 10) : 0;
    
    // Default Fallbacks (Matches Security Logic)
    const tier = userData.tier || 'free';
    const customQuota = userData.customQuota; // Can be undefined

    // 5. Calculate Limits
    let limit: number | 'Unlimited' = 50; // Default Free Limit

    if (tier === 'pro' || tier === 'admin') {
      limit = 'Unlimited';
    } else if (typeof customQuota === 'number') {
      // Allow per-user overrides for special free users
      limit = customQuota;
    }

    // 6. Calculate Remaining
    let remaining: number | 'Unlimited' = 'Unlimited';
    
    if (limit !== 'Unlimited') {
      // Ensure we never return negative numbers if they went slightly over via race conditions
      remaining = Math.max(0, limit - usage);
    }

    // 7. Return Typed Response
    const response: QuotaResponse = {
      tier,
      limit,
      usage,
      remaining,
      resetAt: "00:00 UTC", // Key rotation happens automatically at UTC midnight
      isPro: tier === 'pro' || tier === 'admin'
    };

    return NextResponse.json(response, {
      status: 200,
      headers: {
        // 🛡️ SECURITY: Prevent browser/CDN from caching this sensitive volatile data
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      }
    });

  } catch (error: any) {
    console.error("🔥 Quota Fetch Error:", error);
    
    // Differentiate known auth errors from system crashes
    if (error.message.includes("Access Denied") || error.message.includes("Unauthorized")) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }

    return NextResponse.json({ error: "Failed to fetch quota data" }, { status: 500 });
  }
}