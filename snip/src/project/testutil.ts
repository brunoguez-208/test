import type { MediaRef, Project } from "./model";
import { insertMedia, newProject } from "./ops";

export function media(id: string, duration = 20, w = 1920, h = 1080, fps = 30, audio = true): MediaRef {
  return {
    id,
    path: `C:\\v\\${id}.mp4`,
    kind: "video",
    duration,
    width: w,
    height: h,
    fps,
    fpsNum: fps,
    fpsDen: 1,
    hasAudio: audio,
    videoCodec: "h264",
    audioCodec: audio ? "aac" : null,
    rotation: 0,
  };
}

/** Proyecto con un clip por medio (cada uno del largo dado). */
export function projectWith(...durations: number[]): Project {
  return insertMedia(newProject(1), durations.map((d, i) => media(`m${i + 1}`, d)));
}
