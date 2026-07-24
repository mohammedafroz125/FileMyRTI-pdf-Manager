import { GhostscriptOptimizer } from "./ghostscript-optimizer";
import { QpdfOptimizer } from "./qpdf-optimizer";
import { NativeOptimizer } from "./native-optimizer";
import type { IPdfOptimizer, OptimizationOptions, OptimizationResult } from "../types";

export class OptimizerManager {
  private optimizers: IPdfOptimizer[] = [
    new GhostscriptOptimizer(),
    new QpdfOptimizer(),
    new NativeOptimizer(),
  ];

  async getAvailableOptimizers(): Promise<string[]> {
    const available: string[] = [];
    for (const opt of this.optimizers) {
      if (await opt.isAvailable()) {
        available.push(opt.name);
      }
    }
    return available;
  }

  async optimize(inputBuffer: Buffer, options?: OptimizationOptions): Promise<OptimizationResult> {
    for (const opt of this.optimizers) {
      if (await opt.isAvailable()) {
        try {
          return await opt.optimize(inputBuffer, options);
        } catch (err) {
          console.warn(`⚠ ${opt.name} failed, attempting next available optimizer fallback...`, err);
        }
      }
    }
    throw new Error("No PDF optimizer is available on the server.");
  }
}
