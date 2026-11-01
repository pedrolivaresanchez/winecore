import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const port = Number(env.VITE_APP_PORT || 5173);

  return {
    plugins: [react(), tailwindcss()],
    server: {
      host: true,
      port,
      allowedHosts: true,
      proxy: {
        // The assistant is a Timbal agent, not part of the API: in production the gateway serves
        // /api/workforce/<member>/..., and here it goes to that member's own server (`timbal start`).
        "/api/workforce": {
          target: env.VITE_WORKFORCE_PROXY_TARGET || "http://localhost:4455",
          changeOrigin: true,
          rewrite: (requestPath) => requestPath.replace(/^\/api\/workforce\/[^/]+/, "") || "/",
        },
        "/api": {
          target: env.VITE_API_PROXY_TARGET || "http://localhost:3000",
          changeOrigin: true,
          rewrite: (requestPath) => requestPath.replace(/^\/api/, "") || "/",
        },
        // Same paths the API serves under /auth, so a local redirect_uri without the
        // /api prefix still reaches the process that accepts POST.
        "/auth": {
          target: env.VITE_API_PROXY_TARGET || "http://localhost:3000",
          changeOrigin: true,
        },
      },
    },
    preview: {
      host: true,
      port,
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
