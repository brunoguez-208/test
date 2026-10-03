// Tipos del mock expuesto en window (ver src/mocks/tauriMock.ts).
import type { MockState } from "../src/mocks/tauriMock";
import type { TestApi } from "../src/mocks/testApi";

declare global {
  interface Window {
    __snipMock: MockState;
    __snipTest: TestApi;
  }
}

export {};
