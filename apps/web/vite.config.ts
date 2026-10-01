/// <reference types="vitest/config" />
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5180,
    // Pre-transform the entry graph on start so the first page view does not
    // pay for it request by request.
    warmup: { clientFiles: ["./src/main.tsx"] },
  },
  // Every dependency the shell imports, listed up front: Vite then bundles them
  // all in the first optimisation pass instead of discovering some mid-session
  // ("new dependencies optimized") and reloading the page. Dependencies of the
  // linked workspace packages use Vite's "linked > dep" form.
  optimizeDeps: {
    include: [
      "@base-ui/react/button",
      "@base-ui/react/drawer",
      "@base-ui/react/merge-props",
      "@base-ui/react/toolbar",
      "@base-ui/react/tooltip",
      "@base-ui/react/use-render",
      "@dnd-kit/core",
      "@dnd-kit/sortable",
      "@dnd-kit/utilities",
      "class-variance-authority",
      "clsx",
      "lucide-react",
      "tailwind-merge",
      "@genui-canvas/renderer > @a2ui/react/v0_9",
      "@genui-canvas/renderer > @a2ui/web_core/v0_9",
      "@genui-canvas/renderer > zod",
      "@genui-canvas/contracts > @mcp-gen-ui/schema",
      "@genui-canvas/contracts > zod",
    ],
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
  },
});
