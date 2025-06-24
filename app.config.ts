import {defineConfig} from "@solidjs/start/config";

export default defineConfig({
  server: {
    preset: "static",
    prerender: {
      crawlLinks: true,
    },
  },
});
