import express from "express";
import cors from "cors";
import apiRoutes from "./routes";
import { DEFAULT_PORT, getGhostscriptExecutable, ABSOLUTE_GS_PATH, getLibreOfficeExecutable, isLibreOfficeAvailable, ABSOLUTE_LIBREOFFICE_PATH } from "./config";

const app = express();
const PORT = DEFAULT_PORT;

app.use(cors());
app.use(express.json());

// Mount API routes at /api
app.use("/api", apiRoutes);

app.listen(PORT, () => {
  console.log(`🚀 High-Performance PDF & Document Microservice running on http://localhost:${PORT}`);

  const gsExec = getGhostscriptExecutable();
  if (gsExec) {
    console.log(`✓ Ghostscript detected`);
    console.log(`Executable: ${gsExec}`);
  } else {
    console.log(`⚠ Ghostscript not found. Falling back to Native Optimizer.`);
    console.log(`Expected path: ${ABSOLUTE_GS_PATH}`);
  }

  const loExec = getLibreOfficeExecutable();
  const loAvailable = isLibreOfficeAvailable();
  if (loAvailable && loExec) {
    console.log(`✓ LibreOffice detected`);
    console.log(`Executable: ${loExec}`);
  } else {
    console.log(`⚠ LibreOffice not found. DOC/DOCX conversion unavailable.`);
    console.log(`Expected path: ${ABSOLUTE_LIBREOFFICE_PATH}`);
  }

  console.log(`   Health Endpoint:      http://localhost:${PORT}/api/health`);
  console.log(`   Optimize Endpoint:    http://localhost:${PORT}/api/optimize`);
  console.log(`   Doc Convert Endpoint: http://localhost:${PORT}/api/convert-doc`);
});
