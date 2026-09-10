import {defineConfig} from "@playwright/test";
export default defineConfig({
  testDir:"tests/browser",workers:1,
  use:{baseURL:"http://localhost:3000",channel:"chrome",headless:true},
  webServer:{command:"npm run dev -- --hostname localhost --port 3000",url:"http://localhost:3000",reuseExistingServer:true},
});
