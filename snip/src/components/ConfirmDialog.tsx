import { useEditor } from "../store/editor";
import { Dialog } from "./ui/Dialog";

/** Diálogo de confirmación genérico (agrandar, subir fps, cerrar con cambios, descartar). */
export function ConfirmDialog() {
  const c = useEditor((s) => s.confirm);
  return (
    <Dialog
      open={!!c}
      title={c?.title ?? ""}
      primary={c?.primary ?? "Aceptar"}
      secondary={c?.secondary ?? "Cancelar"}
      tertiary={c?.tertiary}
      danger={c?.danger}
      onPrimary={() => c?.resolve("primary")}
      onSecondary={c?.secondary ? () => c.resolve("secondary") : undefined}
      onTertiary={c?.tertiary ? () => c.resolve("tertiary") : undefined}
      onClose={() => c?.resolve("cancel")}
    >
      {c && <p>{c.body}</p>}
    </Dialog>
  );
}
