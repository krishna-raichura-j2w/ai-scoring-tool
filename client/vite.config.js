import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/j2w-ai-scoring-agent/",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // The client prefixes API calls with the app base (for the prod reverse
      // proxy), so in dev we proxy the prefixed path and strip the base before
      // forwarding to the backend, which serves routes under /api.
      "/j2w-ai-scoring-agent/api": {
        // Explicit 127.0.0.1 (not "localhost") and a dedicated port avoid a clash
        // with other tools (e.g. VS Code) that may grab 3001 on the loopback.
        target: "http://127.0.0.1:5050",
        rewrite: (p) => p.replace(/^\/j2w-ai-scoring-agent/, ""),
      },
    },
  },
});
