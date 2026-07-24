import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start server entry to src/server.ts
    server: { entry: "server" },
  },
});
