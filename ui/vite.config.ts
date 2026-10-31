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
        "/api": {
          target: "http://localhost:3000",
          changeOrigin: true,
          rewrite: (requestPath) => requestPath.replace(/^\/api/, "") || "/",
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
