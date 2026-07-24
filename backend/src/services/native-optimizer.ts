import { PDFDocument } from "pdf-lib";
import type { IPdfOptimizer, OptimizationOptions, OptimizationResult } from "../types";

export class NativeOptimizer implements IPdfOptimizer {
  name = "Native JS Stream Optimizer";

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async optimize(inputBuffer: Buffer, options?: OptimizationOptions): Promise<OptimizationResult> {
    const startTime = Date.now();
    const originalSize = inputBuffer.length;
    const targetSizeMB = options?.targetSizeMB || 2;

    try {
      const pdfDoc = await PDFDocument.load(inputBuffer, { ignoreEncryption: true });
      const optimizedBytes = await pdfDoc.save({ useObjectStreams: true });
      const optimizedBuffer = Buffer.from(optimizedBytes);
      const optimizedSize = optimizedBuffer.length;
      const processingTimeMs = Date.now() - startTime;
      const reduction = originalSize > 0 ? ((originalSize - optimizedSize) / originalSize) * 100 : 0;
      const compressionRatioPct = Math.max(0, Math.round(reduction * 10) / 10);

      return {
        optimizedBuffer,
        engineUsed: this.name,
        originalSize,
        optimizedSize,
        targetSizeMB,
        docType: "digital",
        profileUsed: "Native Object Stream Compaction",
        processingTimeMs,
        compressionRatioPct,
        stepsCount: 1,
      };
    } catch {
      return {
        optimizedBuffer: inputBuffer,
        engineUsed: this.name,
        originalSize,
        optimizedSize: originalSize,
        targetSizeMB,
        docType: "digital",
        profileUsed: "Passthrough Fallback",
        processingTimeMs: Date.now() - startTime,
        compressionRatioPct: 0,
        stepsCount: 0,
      };
    }
  }
}
