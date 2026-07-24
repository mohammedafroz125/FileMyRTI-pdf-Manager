import crypto from "crypto";

const MAX_CACHE_ENTRIES = 50;

interface CacheEntry {
  hash: string;
  pdfBuffer: Buffer;
  timestamp: number;
}

const conversionCache = new Map<string, CacheEntry>();

export function getFileSha256(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export function getCachedPdf(hash: string): Buffer | null {
  const entry = conversionCache.get(hash);
  if (entry) {
    entry.timestamp = Date.now();
    return entry.pdfBuffer;
  }
  return null;
}

export function cacheConvertedPdf(hash: string, pdfBuffer: Buffer): void {
  if (conversionCache.size >= MAX_CACHE_ENTRIES) {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of conversionCache.entries()) {
      if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      conversionCache.delete(oldestKey);
    }
  }

  conversionCache.set(hash, {
    hash,
    pdfBuffer,
    timestamp: Date.now(),
  });
}
