import type { Clip, ClipVideo } from "../../../project/model";
import { updateClip } from "../../../project/ops";
import { edit } from "../../../store/editor";

/** Cambia la imagen de un clip como un paso del historial. */
export function setVideo(clipId: string, f: (v: ClipVideo, c: Clip) => ClipVideo) {
  edit((p) => updateClip(p, clipId, (c) => ({ ...c, video: f(c.video, c) })));
}
