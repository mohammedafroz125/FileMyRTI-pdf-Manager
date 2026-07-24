# FileMyRTI PDF Manager & Document Microservice (Monorepo)

A production-grade monorepo containing a high-performance **React/Vite Frontend Application** and an optional **Express/Node.js PDF & Word Microservice Backend**.

---

## 📁 Monorepo Structure

```text
filemyrti-pdf-manager/
├── frontend/                   # React + Vite Client Application (Vercel-Ready)
│   ├── src/                    # Components, Routes, Storage Adapters & Abstraction Services
│   ├── public/                 # Static Assets & PDF.js Worker Files
│   ├── package.json            # Frontend Package Manifest
│   ├── vite.config.ts          # Vite Configuration
│   ├── tsconfig.json           # TypeScript Configuration
│   └── .env.example            # Environment Template
│
├── backend/                    # Express.js Microservice (Render / Railway / VPS Ready)
│   ├── src/
│   │   ├── config/             # Environment & Executable Configurations (GS & LibreOffice)
│   │   ├── controllers/        # Express Route Handlers (Health & Optimization)
│   │   ├── middleware/         # Multer File Upload Middleware
│   │   ├── routes/             # API Router Definitions (/api/health, /api/optimize, /api/convert-doc)
│   │   ├── services/           # Ghostscript, QPDF, LibreOffice & LRU Cache Services
│   │   ├── types/              # TypeScript Interfaces & Optimization Reports
│   │   └── server.ts           # Server Initialization
│   ├── package.json            # Backend Package Manifest
│   ├── tsconfig.json           # Backend TypeScript Configuration
│   └── .env.example            # Backend Environment Template
│
├── vercel.json                 # Vercel Root Deployment Config (Frontend Output)
├── .vercelignore               # Excludes backend from Vercel deployment bundle
├── .gitignore                  # Root Git Ignore Rules
├── package.json                # Monorepo Workspace Scripts
└── README.md                   # Monorepo Documentation
```

---

## ⚡ Quick Start

### 1. Run Frontend (Port 8080 / 5173)
```bash
cd frontend
npm install
npm run dev
```

### 2. Run Backend (Port 5000)
```bash
cd backend
npm install
npm run dev
```

### 3. Run Monorepo Commands from Root
```bash
# Launch Frontend
npm run dev:frontend

# Launch Backend
npm run dev:backend

# Build Frontend
npm run build:frontend

# Build Backend
npm run build:backend
```

---

## ⚙️ Architecture & Modes

### Mode 1: Frontend Only Mode (`VITE_BACKEND_URL=""`)
- **Deployment**: Deployed on Vercel.
- **Backend Dependency**: **0% (100% Client-Side)**.
- **Features Supported**: PDF Upload, Manual Edit, Admin Upload, Merge, Split, Rotate, Delete Pages, Reorder Pages, PDF Export, Download, IndexedDB Storage.
- **Graceful Word Handling**: Uploading Word docs (`.doc`/`.docx`) displays a friendly message without crashing:
  > *"Word document conversion requires the optional backend service. PDF files continue to work normally."*

### Mode 2: Backend Enhanced Mode (`VITE_BACKEND_URL="http://localhost:5000"`)
- **Deployment**: Hosted independently on Render, Railway, Hostinger VPS, or Docker.
- **Additional Features Unlocked**:
  - Headless LibreOffice `.doc` and `.docx` to PDF conversion.
  - Ghostscript 3-Pass Adaptive PDF Compression.
  - QPDF Object Stream Compaction & Linearization.

---

## 🌐 Live Deployment Instructions

### Deploy Frontend to Vercel
1. Connect repository to Vercel.
2. Root directory is automatically handled by `vercel.json` (`buildCommand: "npm run build --prefix frontend"`, `outputDirectory: "frontend/dist"`).
3. Optional environment variable:
   ```env
   VITE_BACKEND_URL=https://your-backend-service.onrender.com
   ```

### Deploy Backend to Render / Railway / Hostinger VPS
1. Set Root Directory to `backend/`.
2. Install Command: `npm install`.
3. Build Command: `npm run build`.
4. Start Command: `npm start`.
