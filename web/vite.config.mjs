import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
export default defineConfig({
  plugins: [tailwindcss()],
  oxc: { jsx: { runtime: "automatic" } },
  server: { proxy: { "/api": "http://127.0.0.1:3781" } },
});
