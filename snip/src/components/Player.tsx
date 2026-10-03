import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef } from "react";
import { Info16Regular, Play24Filled } from "@fluentui/react-icons";
import { useSnip } from "../store/snip";
import { fallbackToProxy } from "../store/controller";
import { applyVolume, attachVideo, seekToTime, togglePlay } from "../lib/playback";
import { ProgressRing } from "./ui/Progress";
import { Tooltip } from "./ui/Tooltip";
import { Button } from "./ui/Button";

/** Preview grande. Detecta si WebView2 no puede reproducir (HEVC) y pide un proxy. */
export function Player() {
  const ref = useRef<HTMLVideoElement>(null);
  const src = useSnip((s) => s.videoSrc);
  const session = useSnip((s) => s.session);
  const usingProxy = useSnip((s) => s.usingProxy);
  const proxy = useSnip((s) => s.proxy);
  const ready = useSnip((s) => s.videoReady);
  const playing = useSnip((s) => s.playing);
  const volume = useSnip((s) => s.volume);
  const muted = useSnip((s) => s.muted);
  const media = useSnip((s) => s.media);

  useEffect(() => {
    attachVideo(ref.current);
    return () => attachVideo(null);
  }, [session, src]);

  useEffect(() => applyVolume(volume, muted), [volume, muted, src]);

  const onLoaded = () => {
    const v = ref.current;
    if (!v) return;
    // HEVC sin soporte: a veces carga pero sin imagen (videoWidth === 0).
    if (v.videoWidth === 0 && !usingProxy) {
      void fallbackToProxy();
      return;
    }
    useSnip.setState({ videoReady: true });
    seekToTime(useSnip.getState().current);
  };

  const onError = () => {
    if (!usingProxy) void fallbackToProxy();
    else useSnip.setState({ proxy: { status: "error", error: { kind: "corrupt", message: "No se pudo reproducir la vista previa." } } });
  };

  const creating = proxy.status === "creating";

  return (
    <div className="video-well group relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-[8px]" data-testid="player">
      {src && (
        <video
          key={`${session}-${src}`}
          ref={ref}
          src={src}
          preload="auto"
          playsInline
          disablePictureInPicture
          onLoadedData={onLoaded}
          onError={onError}
          onClick={() => togglePlay()}
          className="h-full w-full object-contain"
          data-testid="video"
        />
      )}

      {/* Cargando: skeleton suave */}
      <AnimatePresence>
        {!ready && !creating && proxy.status !== "error" && (
          <motion.div
            key="loading"
            className="skeleton absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.25 } }}
          />
        )}
      </AnimatePresence>

      {/* Generando proxy */}
      <AnimatePresence>
        {creating && (
          <motion.div
            key="proxy"
            className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[var(--video-well)]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            data-testid="proxy-progress"
          >
            <ProgressRing size={36} stroke={3} />
            <div className="text-center">
              <p className="t-body-strong text-white">Preparando la vista previa… {Math.round(proxy.percent)}%</p>
              <p className="t-caption mt-1 max-w-[340px] text-white/60">
                Este equipo no puede mostrar este video directo (probablemente HEVC). Generamos una copia liviana solo para mirar; la exportación usa el original.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {proxy.status === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="t-body-strong text-white">No se puede mostrar la vista previa</p>
          <p className="t-caption max-w-[360px] text-white/60">
            {proxy.error.message} Igual podés recortar con los timecodes y exportar.
          </p>
          <Button onClick={() => void fallbackToProxy()}>Reintentar</Button>
        </div>
      )}

      {/* Aviso discreto del proxy */}
      <AnimatePresence>
        {usingProxy && ready && (
          <motion.div
            key="chip"
            className="absolute left-3 top-3"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            <Tooltip
              content="Tu equipo no reproduce este códec en la app, así que mostramos una copia 720p. La exportación siempre usa el archivo original, con su calidad completa."
              placement="bottom"
            >
              <span className="proxy-chip t-caption inline-flex items-center gap-1.5 rounded-full px-2.5 py-1" data-testid="proxy-chip" tabIndex={0}>
                <Info16Regular /> Vista previa optimizada
              </span>
            </Tooltip>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Botón grande de play: aparece al pasar el mouse por el video en pausa */}
      {ready && !playing && media && (
        <motion.button
          type="button"
          aria-label="Reproducir"
          onClick={() => togglePlay()}
          className="big-play absolute flex h-16 w-16 items-center justify-center rounded-full opacity-0 transition-opacity duration-200 group-hover:opacity-100 focus-visible:opacity-100"
          whileHover={{ scale: 1.06 }}
          whileTap={{ scale: 0.95 }}
          transition={{ type: "spring", stiffness: 500, damping: 30 }}
          data-testid="big-play"
        >
          <Play24Filled className="ml-0.5 text-[28px]" />
        </motion.button>
      )}
    </div>
  );
}
