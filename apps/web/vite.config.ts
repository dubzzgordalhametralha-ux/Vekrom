import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: { dedupe: ["react", "react-dom"] },
  server: { port: 5173, host: true },
  build: {
    outDir: "dist",
    sourcemap: false, // produção não publica o código-fonte
    target: "es2020",
    rollupOptions: {
      output: {
        // vendor estável em chunk próprio: cache longo sobrevive aos deploys do app
        manualChunks: { react: ["react", "react-dom", "react-router-dom", "@tanstack/react-query", "@tanstack/react-virtual", "zustand"], radix: ["@radix-ui/react-dialog", "@radix-ui/react-dropdown-menu", "@radix-ui/react-tooltip"] },
      },
    },
  },
});
