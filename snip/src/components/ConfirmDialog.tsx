import { useSnip } from "../store/snip";
import { Dialog } from "./ui/Dialog";

/** Confirmación para agrandar el video o subir los fps (solo duplica cuadros). */
export function ConfirmDialog() {
  const c = useSnip((s) => s.confirmation);
  const resolve = useSnip((s) => s.resolveConfirmation);
  const upscale = c?.kind === "upscale";
  return (
    <Dialog
      open={!!c}
      title={upscale ? "¿Agrandar el video?" : "¿Subir los fps?"}
      primary={upscale ? "Agrandar igual" : "Subir igual"}
      onPrimary={() => resolve(true)}
      onClose={() => resolve(false)}
    >
      {c && (
        <>
          <p>
            <span className="tabular text-[var(--text-primary)]">{c.from}</span> →{" "}
            <span className="tabular text-[var(--text-primary)]">{c.to}</span>
          </p>
          <p className="mt-2">
            {upscale
              ? "Agrandar no agrega detalle: el video se ve igual de nítido, pero el archivo pesa más."
              : "El video original tiene menos cuadros por segundo. Subirlos solo duplica cuadros: no se ve más fluido y el archivo pesa más."}
          </p>
        </>
      )}
    </Dialog>
  );
}
