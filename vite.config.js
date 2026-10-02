import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { pwaPlugin } from './scripts/pwa-build.js';
import { receiptOcrAssets } from './scripts/receipt-ocr-assets.js';

export default defineConfig({
  plugins: [react(), tailwindcss(), receiptOcrAssets(), pwaPlugin()],
  base: "/cboard/",
});
