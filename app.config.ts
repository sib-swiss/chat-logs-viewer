import {defineConfig} from "@solidjs/start/config";

export default defineConfig({
  server: {
    preset: "static",
    baseURL: process.env.BASE_PATH || "/",
    prerender: {
      crawlLinks: true,
    },
  },
});
