import { NextResponse } from 'next/server';
import { verifyUser, verifyAuthToken } from '@/lib/server/security';
import { redis } from '@/lib/redis';
import { z } from 'zod';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import Tesseract from 'tesseract.js';

const OcrSchema = z.object({
  image: z.string().min(1, "Image data is required").max(5_000_000, "Image data too large"),
  userId: z.string().min(1, "User ID is required"),
});

export const runtime = 'nodejs';

// Get image dimensions from base64 data URI
function getBase64Dimensions(dataUri: string): { width: number; height: number } | null {
  try {
    const raw = dataUri.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(raw, 'base64');
    // Parse PNG or JPEG headers for dimensions
    if (dataUri.includes('png')) {
      // PNG: IHDR chunk at byte 16 contains width (4 bytes) and height (4 bytes)
      if (buffer.length >= 24) {
        return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
      }
    } else if (dataUri.includes('jpeg') || dataUri.includes('jpg')) {
      // JPEG: scan for SOF marker (0xFF 0xC0)
      let i = 0;
      while (i < buffer.length - 1) {
        if (buffer[i] === 0xFF && buffer[i + 1] === 0xC0) {
          const height = buffer.readUInt16BE(i + 5);
          const width = buffer.readUInt16BE(i + 7);
          return { width, height };
        }
        i++;
      }
    }
  } catch { /* ignore */ }
  return null;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parseResult = OcrSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const { image, userId: bodyUserId } = parseResult.data;

    let userId: string;
    try {
      userId = await verifyAuthToken(req, bodyUserId);
    } catch (authError: any) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // --- 1. CENTRALIZED SECURITY CHECK ---
    try {
      await verifyUser(userId);
    } catch (authError: any) {
      const status = authError.message.includes('Access Denied') ? 403 : 401;
      return NextResponse.json({ error: status === 403 ? "Access Denied" : "Authentication Failed" }, { status });
    }

    // --- 2. VALIDATION ---
    if (!image) {
      return NextResponse.json({ error: 'No image provided' }, { status: 400 });
    }

    // --- 3. CACHE LAYER (De-duplication) ---
    let cacheKey = '';
    try {
      const hash = crypto.createHash('md5').update(image).digest('hex');
      cacheKey = `ocr:${hash}`;
      const cachedResult = await redis.get(cacheKey);
      if (cachedResult) {
        console.log('OCR Cache Hit');
        return NextResponse.json(JSON.parse(cachedResult));
      }
    } catch (cacheError) {
      console.warn('OCR Cache Read Failed (Proceeding to Tesseract):', cacheError);
    }

    // --- 4. RUN TESSERACT.JS (FREE, NO API KEY NEEDED) ---
    const tessPath = path.join(process.cwd(), 'public', 'tessdata', 'eng.traineddata.gz');
    const langPath = fs.existsSync(tessPath)
      ? path.join(process.cwd(), 'public', 'tessdata')
      : undefined;
    const { data } = await Tesseract.recognize(image, 'eng', {
      langPath,
      logger: (info) => {
        if (info.status === 'recognizing text') {
          console.log(`Tesseract: ${Math.round(info.progress * 100)}%`);
        }
      },
    });

    const blocks = data.blocks || [];
    const imgDimensions = getBase64Dimensions(image);

    let imgWidth = imgDimensions?.width || 0;
    let imgHeight = imgDimensions?.height || 0;

    // Fallback: estimate dimensions from page data
    if (!imgWidth || !imgHeight) {
      const page = (data as any).pages?.[0];
      if (page) {
        imgWidth = page.width;
        imgHeight = page.height;
      }
    }

    if (!imgWidth || !imgHeight || blocks.length === 0) {
      return NextResponse.json({ items: [] });
    }

    // --- 5. MAP TO LENS FORMAT (Percentages) ---
    const items = blocks
      .flatMap((block: any) => block.words || [])
      .map((word: any) => {
        const { x0, y0, x1, y1 } = word.bbox || {};
        if (x0 == null) return null;
        return {
          text: word.text,
          box: [
            (x0 / imgWidth) * 100,
            (y0 / imgHeight) * 100,
            ((x1 - x0) / imgWidth) * 100,
            ((y1 - y0) / imgHeight) * 100,
          ],
        };
      })
      .filter(Boolean);

    const result = { items };

    // --- 6. SAVE TO CACHE ---
    try {
      if (cacheKey) {
        await redis.set(cacheKey, JSON.stringify(result), 'EX', 86400);
      }
    } catch (writeError) {
      console.error('OCR Cache Write Failed:', writeError);
    }

    return NextResponse.json(result);

  } catch (error: any) {
    console.error('OCR API Error:', error);
    return NextResponse.json({ error: 'Failed to process image' }, { status: 500 });
  }
}