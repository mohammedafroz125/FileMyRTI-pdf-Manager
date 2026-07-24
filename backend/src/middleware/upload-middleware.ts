import multer from "multer";

export const uploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 250 * 1024 * 1024 }, // 250 MB max file size
});
