// Tipos del mock expuesto en window (ver src/mocks/tauriMock.ts).
import type { MockState } from "../src/mocks/tauriMock";
import type { TestApi } from "../src/mocks/testApi";
import type { ParityApi } from "../src/mocks/parity";

declare global {
  interface Window {
    __snipMock: MockState;
    __snipTest: TestApi;
    __snipParity: ParityApi;
  }
}

export {};
