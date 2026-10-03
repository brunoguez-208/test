import { defineConfig, devices } from "@playwright/test";

// Tests de UI en navegador con el IPC de Tauri mockeado (src/mocks/tauriMock.ts).
export default defineConfig({
  testDir: "e2e",
  timeout: 45_000,
  expect: { timeout: 7_000 },
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:4173",
    viewport: { width: 1280, height: 820 },
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      testIgnore: /(perf|parity)\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 820 },
        // Permite usar un Chromium ya instalado (CI / entornos sin descarga de navegadores).
        launchOptions: {
          ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
          // WebGL por software (el preview usa WebGL2) en entornos sin GPU.
          args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"],
        },
      },
    },
    {
      // Paridad preview ↔ exportación con FFmpeg real.
      name: "paridad",
      testMatch: /parity\.spec\.ts/,
      timeout: 600_000,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 820 },
        launchOptions: {
          ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
          args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"],
        },
      },
    },
    {
      // Rendimiento: después de todo lo demás, sin otros tests en paralelo.
      name: "rendimiento",
      testMatch: /perf\.spec\.ts/,
      dependencies: ["chromium", "paridad"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 820 },
        launchOptions: {
          ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
          args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"],
        },
      },
    },
  ],
  webServer: {
    command: "npm run build:mock && npm run preview:mock",
    url: "http://localhost:4173",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
