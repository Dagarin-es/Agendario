import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  clean: true,
  // El paquete compartido se incluye en el bundle; el resto de dependencias se instalan en la imagen.
  noExternal: ["@agendario/shared"],
});
