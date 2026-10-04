import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(dirname, "./src"),
      // Shared runtime validation is authored as ESM; the backend consumes its
      // CommonJS build, while Vite should transform the source for the browser.
      "@snapland/shared": path.resolve(dirname, "../../packages/shared/src/index.ts"),
    },
  },
  server: {
    port: Number(process.env.FRONTEND_PORT) || 5173,
    strictPort: true,
  },
});
