import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { createRunnableDevEnvironment, defineConfig } from "vite";

/**
 * App-local Vite config. The root `vite.config.ts` handles lint / format /
 * test config for the whole monorepo (Vite+ orchestrates those). This file
 * is for `vite dev` and `vite build` — TanStack Start's plugin order
 * matters: tanstackStart() must come before viteReact().
 */
export default defineConfig({
  server: {
    port: 3000,
  },
  resolve: {
    tsconfigPaths: true,
  },
  environments: {
    ssr: {
      dev: {
        createEnvironment: (name, config) => createRunnableDevEnvironment(name, config),
      },
    },
  },
  plugins: [tailwindcss(), tanstackStart(), viteReact()],
});
