import path from "node:path"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@shared": path.resolve(__dirname, "../shared"),
    },
  },
  server: {
    // shared/ lives outside the client root; the contract types are imported
    // from there rather than copied in.
    fs: { allow: [path.resolve(__dirname, "..")] },
    // One origin in production (Express serves client/dist), so the dev proxy
    // exists only to make development match it. No CORS config anywhere.
    proxy: { "/api": { target: "http://localhost:3000", changeOrigin: true } },
  },
})
