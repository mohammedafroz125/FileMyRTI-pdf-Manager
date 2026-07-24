import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import os from "os";
import { getLibreOfficeExecutable, isLibreOfficeAvailable, ABSOLUTE_LIBREOFFICE_PATH } from "../config";
import { getFileSha256, getCachedPdf, cacheConvertedPdf } from "./conversion-cache";
import type { ConversionResult } from "../types";

const execAsync = promisify(exec);

export async function convertDocToPdf(
  inputBuffer: Buffer,
  originalFileName: string
): Promise<ConversionResult> {
  const executable = getLibreOfficeExecutable();
  if (!executable || !isLibreOfficeAvailable()) {
    throw new Error(
      `LibreOffice is not installed on the server. Please install LibreOffice (soffice.exe) at ${ABSOLUTE_LIBREOFFICE_PATH} to enable .doc and .docx conversion.`
    );
  }

  const startTime = Date.now();
  const fileHash = getFileSha256(inputBuffer);
  const cachedPdf = getCachedPdf(fileHash);

  if (cachedPdf) {
    return {
      pdfBuffer: cachedPdf,
      loTimeMs: Date.now() - startTime,
      isCacheHit: true,
    };
  }

  const tempDir = os.tmpdir();
  const fileId = Date.now() + "-" + Math.random().toString(36).substring(2, 8);
  const ext = path.extname(originalFileName) || ".docx";
  const tempInputPath = path.join(tempDir, `doc-input-${fileId}${ext}`);

  await fs.promises.writeFile(tempInputPath, inputBuffer);

  try {
    const cmd = `"${executable}" --headless --nologo --nofirststartwizard --norestore --nodefault --convert-to pdf --outdir "${tempDir}" "${tempInputPath}"`;
    await execAsync(cmd);

    const baseName = path.basename(tempInputPath, ext);
    const tempOutputPath = path.join(tempDir, `${baseName}.pdf`);

    if (!fs.existsSync(tempOutputPath)) {
      throw new Error(`LibreOffice conversion failed. Expected output file "${tempOutputPath}" was not created.`);
    }

    const pdfBuffer = await fs.promises.readFile(tempOutputPath);
    const loTimeMs = Date.now() - startTime;

    cacheConvertedPdf(fileHash, pdfBuffer);

    setImmediate(() => {
      fs.promises.unlink(tempInputPath).catch(() => {});
      fs.promises.unlink(tempOutputPath).catch(() => {});
    });

    return {
      pdfBuffer,
      loTimeMs,
      isCacheHit: false,
    };
  } catch (err) {
    setImmediate(() => {
      fs.promises.unlink(tempInputPath).catch(() => {});
    });
    throw err;
  }
}
