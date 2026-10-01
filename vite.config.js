import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { pwaPlugin } from './scripts/pwa-build.js';

export default defineConfig({
  plugins: [react(), tailwindcss(), pwaPlugin()],
  base: "/cboard/",
});
