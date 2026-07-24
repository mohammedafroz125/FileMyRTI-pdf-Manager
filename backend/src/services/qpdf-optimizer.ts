import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import os from "os";
import type { IPdfOptimizer, OptimizationOptions, OptimizationResult } from "../types";

const execAsync = promisify(exec);

export class QpdfOptimizer implements IPdfOptimizer {
  name = "QPDF Binary Optimizer";

  async isAvailable(): Promise<boolean> {
    try {
      await execAsync("qpdf --version");
      return true;
    } catch {
      return false;
    }
  }

  async optimize(inputBuffer: Buffer, options?: OptimizationOptions): Promise<OptimizationResult> {
    const startTime = Date.now();
    const originalSize = inputBuffer.length;
    const targetSizeMB = options?.targetSizeMB || 2;
    const tempDir = os.tmpdir();
    const id = Date.now() + "-" + Math.random().toString(36).slice(2, 8);
    const inputPath = path.join(tempDir, `input-${id}.pdf`);
    const outputPath = path.join(tempDir, `output-${id}.pdf`);

    try {
      await fs.promises.writeFile(inputPath, inputBuffer);
      await execAsync(`qpdf --linearize --object-streams=generate --stream-data=compress "${inputPath}" "${outputPath}"`);

      const optimizedBuffer = await fs.promises.readFile(outputPath);
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
        profileUsed: options?.profile || "QPDF Linearization",
        processingTimeMs,
        compressionRatioPct,
        stepsCount: 1,
      };
    } finally {
      try {
        if (fs.existsSync(inputPath)) await fs.promises.unlink(inputPath);
        if (fs.existsSync(outputPath)) await fs.promises.unlink(outputPath);
      } catch {
        /* ignore */
      }
    }
  }
}
