import fs from "fs";

export const ABSOLUTE_GS_PATH = process.env.GHOSTSCRIPT_PATH || "C:\\Program Files\\gs\\gs10.07.1\\bin\\gswin64c.exe";
export const ABSOLUTE_LIBREOFFICE_PATH = process.env.LIBREOFFICE_PATH || "C:\\Program Files\\LibreOffice\\program\\soffice.exe";
export const DEFAULT_PORT = process.env.PORT || 5000;
export const DEFAULT_TARGET_SIZE_MB = 2;

export function getGhostscriptExecutable(): string | null {
  if (fs.existsSync(ABSOLUTE_GS_PATH)) {
    return ABSOLUTE_GS_PATH;
  }
  return null;
}

export function getLibreOfficeExecutable(): string | null {
  if (fs.existsSync(ABSOLUTE_LIBREOFFICE_PATH)) {
    return ABSOLUTE_LIBREOFFICE_PATH;
  }
  return null;
}

export function isLibreOfficeAvailable(): boolean {
  return getLibreOfficeExecutable() !== null;
}
