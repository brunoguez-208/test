// Tipos del mock expuesto en window (ver src/mocks/tauriMock.ts).
import type { MockState } from "../src/mocks/tauriMock";

declare global {
  interface Window {
    __snipMock: MockState;
  }
}

export {};
