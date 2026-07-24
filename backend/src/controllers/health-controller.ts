import { Request, Response } from "express";
import { getGhostscriptExecutable, getLibreOfficeExecutable, isLibreOfficeAvailable } from "../config";
import { OptimizerManager } from "../services/optimizer-manager";

const optimizerManager = new OptimizerManager();

export async function getHealthStatus(_req: Request, res: Response): Promise<void> {
  try {
    const gsExec = getGhostscriptExecutable();
    const gsAvailable = gsExec !== null;
    const loExec = getLibreOfficeExecutable();
    const loAvailable = isLibreOfficeAvailable();
    const availableOptimizers = await optimizerManager.getAvailableOptimizers();

    const healthPayload: Record<string, unknown> = {
      status: "ok",
      service: "pdf-optimizer-backend",
      mode: "adaptive-target-size",
      defaultTargetSizeMB: 2,
      libreoffice: loAvailable,
      ghostscript: gsAvailable,
      supportedInputFormats: [".pdf", ".doc", ".docx", ".png", ".jpg", ".webp"],
      optimizer: gsAvailable ? "Ghostscript + QPDF Adaptive Engine" : "Native JS Stream Optimizer",
      availableOptimizers,
      timestamp: new Date().toISOString(),
    };

    if (loAvailable) {
      healthPayload.executable = loExec;
    }

    if (gsAvailable) {
      healthPayload.ghostscriptExecutable = gsExec;
    }

    res.json(healthPayload);
  } catch (err) {
    res.status(500).json({ status: "error", error: (err as Error).message });
  }
}
