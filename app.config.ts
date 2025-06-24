import {defineConfig} from "@solidjs/start/config";

export default defineConfig({
  server: {
    preset: "static",
    baseURL: "/chat-logs-viewer/",
    prerender: {
      crawlLinks: true,
    },
  },
});
