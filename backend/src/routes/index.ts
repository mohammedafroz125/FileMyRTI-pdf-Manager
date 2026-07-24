import { Router } from "express";
import { getHealthStatus } from "../controllers/health-controller";
import { handleOptimizationRequest } from "../controllers/optimization-controller";
import { uploadMiddleware } from "../middleware/upload-middleware";

const router = Router();

// GET /api/health -> Health Check
router.get("/health", getHealthStatus);

// POST /api/optimize -> PDF / Document Optimization
router.post("/optimize", uploadMiddleware.single("pdf"), handleOptimizationRequest);

// POST /api/convert-doc -> DOC / DOCX Conversion & Optimization
router.post("/convert-doc", uploadMiddleware.single("file"), handleOptimizationRequest);
router.post("/convert-doc", uploadMiddleware.single("doc"), handleOptimizationRequest);

export default router;
