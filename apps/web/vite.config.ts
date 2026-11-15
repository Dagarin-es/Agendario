import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "Agendario (Beta)",
        short_name: "Agendario (Beta)",
        description: "Tu agenda de contactos, con su historia, en tu servidor",
        lang: "es",
        theme_color: "#4338ca",
        background_color: "#f8fafc",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // La API nunca se cachea en el service worker: los datos siempre vienen del servidor.
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  server: {
    // En desarrollo, la web (5173) reenvía /api al servidor (3002).
    proxy: { "/api": "http://localhost:3002" },
  },
});
