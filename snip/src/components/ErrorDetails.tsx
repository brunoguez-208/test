import { useState } from "react";
import { Copy16Regular, DocumentText16Regular } from "@fluentui/react-icons";
import { api } from "../lib/platform";
import { Button } from "./ui/Button";

/**
 * "Ver detalles" de un error: el texto real de FFmpeg, para copiar y mandar
 * en un reporte, y el log de la app.
 */
export function ErrorDetails({ detail, onOpen }: { detail: string; onOpen?: (open: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const toggle = () => {
    setOpen((v) => !v);
    onOpen?.(!open);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(detail);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div data-testid="error-details">
      <button type="button" className="t-caption flex items-center gap-1 text-[var(--accent-text)]" onClick={toggle} data-testid="error-details-toggle">
        {open ? "Ocultar detalles" : "Ver detalles"}
      </button>
      {open && (
        <>
          <pre className="t-caption mt-1.5 max-h-40 select-text overflow-auto whitespace-pre-wrap rounded-[4px] bg-black/20 p-2 font-mono text-[11px]" data-testid="error-details-text">
            {detail}
          </pre>
          <div className="mt-1.5 flex gap-2">
            <Button className="!h-7" icon={<Copy16Regular />} onClick={() => void copy()} data-testid="error-details-copy">
              {copied ? "Copiado" : "Copiar"}
            </Button>
            <Button className="!h-7" icon={<DocumentText16Regular />} onClick={() => void api.revealLog().catch(() => {})} data-testid="error-details-log">
              Abrir log
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
