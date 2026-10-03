// Tipos del mock expuesto en window (ver src/mocks/tauriMock.ts).
interface SnipMockRequest {
  input: string;
  output?: string | null;
  start: number;
  end: number;
  mode: "fast" | "precise";
  resolution: { kind: string; width?: number };
  fps: string;
  frameExact: boolean;
  allowUpscale: boolean;
  allowFpsIncrease: boolean;
}

interface Window {
  __snipMock: {
    emit: (event: string, payload: unknown) => Promise<void>;
    dragEnter: (paths: string[]) => Promise<void>;
    drop: (paths: string[]) => Promise<void>;
    dragLeave: () => Promise<void>;
    calls: { cmd: string; args: unknown }[];
    lastExport: SnipMockRequest | null;
    nextExportError: { kind: string; message: string; detail?: string } | null;
    dialogOpenPath: string | null;
  };
}
