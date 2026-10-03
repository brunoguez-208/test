import { Save16Regular, Save20Regular } from "@fluentui/react-icons";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowExport20Regular,
  Delete16Regular,
  DeveloperBoard16Regular,
  Flash16Regular,
  Folder16Regular,
  Cut16Regular,
} from "@fluentui/react-icons";
import type { ExportSettings, OutputFormat, Project } from "../../project/model";
import { FORMATS, canvasFps } from "../../project/model";
import { removeRange, updateRange } from "../../project/ops";
import { estimateBitrate, isFastEligible } from "../../project/exportPlan";
import { totalDuration } from "../../project/timeline";
import { FPS_VALUE, isFpsIncrease, planScale } from "../../lib/scale";
import { basename, dirname, middleEllipsis } from "../../lib/files";
import { formatDuration, formatFps, secondsToTimecode } from "../../lib/timecode";
import type { FpsChoice, ResolutionChoice, ResolutionKind } from "../../lib/types";
import { api, pickSavePath } from "../../lib/platform";
import { activeTab, ask, edit, patchProject, useEditor } from "../../store/editor";
import { addRangeFromMarks, buildJob, enqueueExport, exportRanges, saveSnipNow } from "../../store/controller";
import { Button } from "../ui/Button";
import { Segmented } from "../ui/Segmented";
import { Select, type SelectOption } from "../ui/Select";
import { Toggle } from "../ui/Toggle";
import { InfoBar } from "../ui/InfoBar";
import { Field, Section } from "./Field";

const RES_LABEL: Record<ResolutionKind, string> = {
  original: "Original",
  p2160: "4K (2160p)",
  p1440: "1440p",
  p1080: "1080p",
  p720: "720p",
  custom: "Personalizada",
};

type SizeChoice = "none" | "discord" | "whatsapp" | "custom";

function setExport(f: (s: ExportSettings) => ExportSettings) {
  patchProject((p) => ({ ...p, export: f(p.export) }));
}

function resLabel(r: ResolutionChoice, w: number, h: number) {
  return r.kind === "custom" ? `${w}×${h}` : RES_LABEL[r.kind];
}

export function ExportTab({ project }: { project: Project }) {
  const st = project.export;
  const encoder = useEditor((s) => s.encoder);
  const limits = useEditor((s) => s.limits);
  const tab = useEditor((s) => activeTab(s));
  const [output, setOutput] = useState<string | null>(null);
  const [defaultOut, setDefaultOut] = useState<string | null>(null);
  const fast = isFastEligible(project);
  const total = totalDuration(project);
  const canvas = { width: project.canvas.width, height: project.canvas.height };
  const plan = planScale(canvas, st.resolution);
  const outFps = FPS_VALUE[st.fps] ?? canvasFps(project.canvas);
  const isGif = st.format === "gif";
  const isMp3 = st.format === "mp3";
  const asSnip = useEditor((s) => s.exportAsSnip);

  // Nombre que va a tener el archivo (Rust decide; nunca sobrescribe).
  useEffect(() => {
    if (!project.clips.length) return;
    let alive = true;
    api
      .defaultOutputPath(buildJob(project))
      .then((p) => alive && setDefaultOut(p))
      .catch(() => alive && setDefaultOut(null));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.name, project.clips[0]?.mediaId, st.format, project.media.length]);

  const sizeChoice: SizeChoice = !st.sizeTarget ? "none" : st.sizeTarget.preset.startsWith("discord") ? "discord" : st.sizeTarget.preset === "whatsapp" ? "whatsapp" : "custom";
  const preset = (id: string) => limits?.presets.find((p) => p.id === id);
  const estimate = st.sizeTarget && !isGif ? estimateBitrate(project, st, st.sizeTarget.megabytes, limits?.targetRatio ?? 0.95) : null;

  const resOptions: SelectOption<ResolutionKind>[] = useMemo(
    () =>
      (["original", "p2160", "p1440", "p1080", "p720"] as ResolutionKind[]).map((k) => {
        if (k === "original") return { value: k, label: "Original", hint: `${canvas.width}×${canvas.height}` };
        const p = planScale(canvas, { kind: k } as ResolutionChoice);
        return { value: k, label: RES_LABEL[k], hint: p.upscale ? "agranda" : `${p.width}×${p.height}` };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canvas.width, canvas.height],
  );
  const fpsOptions: SelectOption<FpsChoice>[] = (["original", "fps120", "fps60", "fps30", "fps24"] as FpsChoice[]).map((f) => {
    const v = FPS_VALUE[f];
    if (v === null) return { value: f, label: "Original", hint: `${formatFps(canvasFps(project.canvas))} fps` };
    return { value: f, label: `${v} fps`, hint: isFpsIncrease(v, canvasFps(project.canvas)) ? "duplica cuadros" : undefined };
  });

  const chooseResolution = async (r: ResolutionChoice) => {
    const p = planScale(canvas, r);
    if (r.kind !== "original" && p.upscale) {
      const c = await ask({
        title: "¿Agrandar el video?",
        body: `${canvas.width}×${canvas.height} → ${p.width}×${p.height}. Agrandar no agrega detalle: se ve igual de nítido, pero el archivo pesa más.`,
        primary: "Agrandar igual",
      });
      if (c !== "primary") return;
      setExport((s) => ({ ...s, resolution: r, allowUpscale: true }));
      return;
    }
    setExport((s) => ({ ...s, resolution: r, allowUpscale: false }));
  };

  const chooseFps = async (f: FpsChoice) => {
    const v = FPS_VALUE[f];
    if (v !== null && isFpsIncrease(v, canvasFps(project.canvas))) {
      const c = await ask({
        title: "¿Subir los fps?",
        body: `${formatFps(canvasFps(project.canvas))} → ${v} fps. El video tiene menos cuadros por segundo: subirlos solo duplica cuadros y el archivo pesa más.`,
        primary: "Subir igual",
      });
      if (c !== "primary") return;
      setExport((s) => ({ ...s, fps: f, allowFpsIncrease: true }));
      return;
    }
    setExport((s) => ({ ...s, fps: f, allowFpsIncrease: false }));
  };

  const setSize = (c: SizeChoice) => {
    if (c === "none") setExport((s) => ({ ...s, sizeTarget: null }));
    else if (c === "discord") setExport((s) => ({ ...s, sizeTarget: { preset: "discord", megabytes: preset("discord")?.megabytes ?? 20 } }));
    else if (c === "whatsapp") setExport((s) => ({ ...s, sizeTarget: { preset: "whatsapp", megabytes: preset("whatsapp")?.megabytes ?? 16 } }));
    else setExport((s) => ({ ...s, sizeTarget: { preset: "custom", megabytes: s.sizeTarget?.megabytes ?? 25 } }));
  };

  const chooseOutput = async () => {
    const ext = st.format;
    const suggestion = output ?? defaultOut ?? `${project.name || "video"}_snip.${ext}`;
    const p = await pickSavePath("Guardar como", suggestion, [{ name: FORMATS.find((f) => f.id === ext)!.label, extensions: [ext] }]).catch(() => null);
    if (p) setOutput(p);
  };

  const shownOut = output ?? defaultOut;
  // Proyecto .snip: junto al video que se exportaría (mismo nombre) o el .snip de la pestaña.
  const snipOut = tab?.file ?? (shownOut ? shownOut.replace(/\.[^.\\/]+$/, ".snip") : null);
  const summaryCodec = isMp3 ? "MP3 · 320 kbps" : isGif ? `GIF · ${st.gif.fps} fps` : st.format === "webm" ? "VP9" : fast ? `${(project.media[0]?.videoCodec ?? "").toUpperCase()} sin recodificar` : `H.264 · ${encoder?.label ?? "detectando…"}`;

  return (
    <div className="flex h-full flex-col" data-testid="export-tab">
      <div className="flex flex-1 flex-col gap-6 pb-4">
        <Section title="Formato">
          <Segmented<OutputFormat | "snip">
            label="Formato"
            value={asSnip ? "snip" : st.format}
            onChange={(f) => {
              setOutput(null);
              if (f === "snip") return useEditor.setState({ exportAsSnip: true });
              useEditor.setState({ exportAsSnip: false });
              setExport((s) => ({ ...s, format: f, sizeTarget: f === "gif" ? null : s.sizeTarget }));
            }}
            options={[...FORMATS.map((f) => ({ value: f.id as OutputFormat | "snip", label: f.label, title: f.hint })), { value: "snip", label: "Proyecto", title: "Proyecto Snip (.snip): solo guarda el proyecto, al instante" }]}
            testId="format"
          />
          <AnimatePresence mode="wait" initial={false}>
            {asSnip ? (
              <motion.p key="snip" initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="t-caption flex items-center gap-1.5 text-[var(--text-secondary)]" data-testid="mode-caption">
                <Save16Regular /> Proyecto Snip (.snip): guarda solo el proyecto, al instante, para seguir editando después.
              </motion.p>
            ) : (
            <motion.div key={fast ? "fast" : st.format} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
              {fast ? (
                <p className="t-caption flex items-center gap-1.5 text-[var(--text-secondary)]" data-testid="mode-caption">
                  <Flash16Regular className="text-[var(--accent-text)]" /> Rápido · sin pérdida: copia el video sin recodificar.
                </p>
              ) : (
                <p className="t-caption flex items-center gap-1.5 text-[var(--text-secondary)]" data-testid="mode-caption">
                  <DeveloperBoard16Regular /> {isMp3 ? "Solo el audio, en MP3 de alta calidad." : isGif ? "GIF con paleta optimizada." : `Recodifica con ${st.format === "webm" ? "VP9" : encoder?.label ?? "el mejor codificador disponible"}.`}
                </p>
              )}
            </motion.div>
            )}
          </AnimatePresence>
          {!asSnip && ["mp4", "mov", "mkv"].includes(st.format) && (
            <Field inline label="Corte exacto al cuadro" hint="Siempre recodifica, aunque se pueda copiar.">
              <Toggle checked={st.mode === "precise"} onChange={(v) => setExport((s) => ({ ...s, mode: v ? "precise" : "auto" }))} label="Corte exacto al cuadro" testId="frame-exact" />
            </Field>
          )}
        </Section>

        {!asSnip && (
          <>
        {!isMp3 && (
          <Section title="Imagen">
            {isGif ? (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Cuadros por segundo">
                  <Select<string>
                    label="fps del GIF"
                    value={String(st.gif.fps)}
                    options={["10", "12", "15", "20", "25"].map((v) => ({ value: v, label: `${v} fps` }))}
                    onChange={(v) => setExport((s) => ({ ...s, gif: { ...s.gif, fps: Number(v) } }))}
                    testId="gif-fps"
                  />
                </Field>
                <Field label="Ancho">
                  <Select<string>
                    label="Ancho del GIF"
                    value={String(st.gif.width)}
                    options={["320", "480", "640", "800", "1080"].map((v) => ({ value: v, label: `${v} px`, disabled: Number(v) > canvas.width }))}
                    onChange={(v) => setExport((s) => ({ ...s, gif: { ...s.gif, width: Number(v) } }))}
                    testId="gif-width"
                  />
                </Field>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Resolución">
                  <Select<ResolutionKind>
                    label="Resolución"
                    testId="select-resolution"
                    value={st.resolution.kind}
                    options={st.resolution.kind === "custom" ? [...resOptions, { value: "custom", label: resLabel(st.resolution, plan.width, plan.height) }] : resOptions}
                    onChange={(k) => void chooseResolution({ kind: k } as ResolutionChoice)}
                  />
                </Field>
                <Field label="FPS">
                  <Select<FpsChoice> label="FPS" testId="select-fps" value={st.fps} options={fpsOptions} onChange={(f) => void chooseFps(f)} />
                </Field>
              </div>
            )}
          </Section>
        )}

        {!isGif && (
          <Section title="Tamaño máximo">
            <Select<SizeChoice>
              label="Tamaño máximo"
              testId="size-preset"
              value={sizeChoice}
              options={[
                { value: "none", label: "Sin límite", hint: "máxima calidad" },
                { value: "discord", label: "Discord", hint: "20–500 MB" },
                { value: "whatsapp", label: "WhatsApp", hint: `${preset("whatsapp")?.megabytes ?? 16} MB` },
                { value: "custom", label: "Tamaño personalizado (MB)" },
              ]}
              onChange={setSize}
            />
            <AnimatePresence initial={false}>
              {sizeChoice === "discord" && (
                <motion.div key="nitro" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
                  <Field label="¿Tenés Nitro?">
                    <Segmented<string>
                      label="Plan de Discord"
                      value={st.sizeTarget!.preset}
                      onChange={(id) => setExport((s) => ({ ...s, sizeTarget: { preset: id, megabytes: preset(id)?.megabytes ?? 20 } }))}
                      options={(limits?.presets.filter((p) => p.group === "discord") ?? [
                        { id: "discord", tier: "Gratis", megabytes: 20 },
                        { id: "discordBasic", tier: "Nitro Basic", megabytes: 50 },
                        { id: "discordNitro", tier: "Nitro", megabytes: 500 },
                      ]).map((p) => ({ value: p.id, label: <span className="flex flex-col leading-[14px]"><span>{p.tier ?? "Gratis"}</span><span className="text-[10px] opacity-70">{p.megabytes} MB</span></span> }))}
                      testId="discord-tier"
                    />
                  </Field>
                </motion.div>
              )}
              {sizeChoice === "custom" && (
                <motion.div key="custom" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
                  <label className="flex items-center gap-2">
                    <input
                      className="tc-input t-body tabular h-8 w-24 rounded-[4px] px-2.5 outline-none"
                      inputMode="decimal"
                      defaultValue={String(st.sizeTarget!.megabytes).replace(".", ",")}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      }}
                      onBlur={(e) => {
                        const v = Number(e.target.value.replace(",", "."));
                        if (Number.isFinite(v) && v > 0.1) setExport((s) => ({ ...s, sizeTarget: { preset: "custom", megabytes: Math.min(100000, v) } }));
                        else e.target.value = String(st.sizeTarget!.megabytes);
                      }}
                      data-testid="custom-mb"
                    />
                    <span className="t-body text-[var(--text-secondary)]">MB</span>
                  </label>
                </motion.div>
              )}
            </AnimatePresence>
            {estimate && (
              <AnimatePresence initial={false}>
                {estimate.tooLong ? (
                  <InfoBar key="long" severity="critical" title="No entra" message="El video es demasiado largo para ese tamaño. Recortalo o elegí un límite más grande." testId="size-too-long" />
                ) : estimate.lowQuality ? (
                  <InfoBar
                    key="low"
                    severity="caution"
                    title="Va a perder bastante calidad"
                    message={`Para entrar en ${st.sizeTarget!.megabytes} MB quedan ~${estimate.videoKbps} kbps de video.`}
                    testId="size-low-quality"
                    action={
                      estimate.suggestion && (
                        <Button
                          className="!h-7"
                          onClick={() => setExport((s) => ({ ...s, resolution: estimate.suggestion!, allowUpscale: false }))}
                          data-testid="apply-suggestion"
                        >
                          Bajar a {resLabel(estimate.suggestion, planScale(canvas, estimate.suggestion).width, planScale(canvas, estimate.suggestion).height)}
                        </Button>
                      )
                    }
                  />
                ) : (
                  <p key="ok" className="t-caption tabular text-[var(--text-secondary)]" data-testid="size-estimate">
                    Apunta a {Math.round(st.sizeTarget!.megabytes * (limits?.targetRatio ?? 0.95) * 10) / 10} MB · ~{estimate.videoKbps} kbps de video{estimate.audioKbps ? ` + ${estimate.audioKbps} kbps de audio` : ""}.
                  </p>
                )}
              </AnimatePresence>
            )}
          </Section>
        )}

        <Section title="Destino">
          <div className="setting-row flex items-center gap-3 rounded-[6px] px-3 py-2.5">
            <Folder16Regular className="shrink-0 text-[16px] text-[var(--text-secondary)]" />
            <div className="min-w-0 flex-1">
              <p className="t-body truncate" title={shownOut ?? undefined} data-testid="output-name">
                {shownOut ? basename(shownOut) : "…"}
              </p>
              <p className="t-caption truncate text-[var(--text-tertiary)]">{shownOut ? middleEllipsis(dirname(shownOut), 40) : ""}</p>
            </div>
            <Button className="shrink-0" onClick={() => void chooseOutput()} data-testid="save-as">
              Cambiar…
            </Button>
          </div>
          {output ? (
            <button type="button" className="t-caption self-start text-[var(--accent-text)] hover:underline" onClick={() => setOutput(null)}>
              Volver a guardar junto al original
            </button>
          ) : (
            <p className="t-caption text-[var(--text-tertiary)]">Junto al original, con el proyecto .snip al lado. Nunca sobrescribe.</p>
          )}
        </Section>

        <Section title="Fragmentos" testId="ranges">
          {project.ranges.length === 0 ? (
            <p className="t-caption text-[var(--text-secondary)]">Marcá inicio (I) y fin (O) en el timeline para exportar partes como archivos separados.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              <AnimatePresence initial={false}>
                {project.ranges.map((r) => (
                  <motion.li
                    key={r.id}
                    layout
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: 12 }}
                    className={`setting-row flex items-center gap-2 rounded-[6px] py-1.5 pl-2.5 pr-1 ${tab?.selection.includes(r.id) ? "is-selected" : ""}`}
                    data-testid="range-row"
                  >
                    <Cut16Regular className="shrink-0 text-[var(--text-tertiary)]" />
                    <input
                      className="range-name t-body min-w-0 flex-1 rounded-[4px] bg-transparent px-1 outline-none"
                      defaultValue={r.name}
                      aria-label="Nombre del fragmento"
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      }}
                      onBlur={(e) => e.target.value.trim() && e.target.value !== r.name && edit((p) => updateRange(p, r.id, { name: e.target.value.trim() }))}
                    />
                    <span className="t-caption tabular shrink-0 text-[var(--text-tertiary)]">{formatDuration(r.end - r.start)}</span>
                    <Button variant="subtle" className="!h-7 !w-7 !px-0" aria-label="Quitar fragmento" onClick={() => edit((p) => removeRange(p, r.id))} title={`${secondsToTimecode(r.start, canvasFps(project.canvas))} → ${secondsToTimecode(r.end, canvasFps(project.canvas))}`}>
                      <Delete16Regular />
                    </Button>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          )}
          <div className="flex gap-2">
            <Button className="flex-1" onClick={addRangeFromMarks} disabled={!tab || (tab.markIn === null && tab.markOut === null)} data-testid="add-range-inspector">
              Agregar fragmento (I/O)
            </Button>
            {project.ranges.length > 0 && (
              <Button className="flex-1" onClick={() => void exportRanges()} data-testid="export-ranges">
                Exportar {project.ranges.length === 1 ? "1 archivo" : `${project.ranges.length} archivos`}
              </Button>
            )}
          </div>
        </Section>
          </>
        )}
      </div>

      <div className="panel-footer sticky bottom-0 -mx-6 mt-auto flex flex-col gap-3 px-6 pb-6 pt-4">
        {asSnip ? (
          <div className="px-0.5" data-testid="export-summary">
            <div className="t-caption text-[var(--text-secondary)]">Vas a obtener</div>
            <p className="t-body-strong mt-0.5 truncate" title={snipOut ?? ""}>{snipOut ? basename(snipOut) : "Proyecto .snip"}</p>
          </div>
        ) : (
        <div className="px-0.5" data-testid="export-summary">
          <div className="t-caption flex items-center justify-between gap-2 text-[var(--text-secondary)]">
            <span>Vas a obtener</span>
            <span className="truncate">{summaryCodec}</span>
          </div>
          <p className="t-body-strong tabular mt-0.5">
            {formatDuration(total)}
            {!isMp3 && (isGif ? ` · ${Math.min(st.gif.width, canvas.width)} px de ancho` : ` · ${plan.width}×${plan.height} · ${formatFps(outFps)} fps`)}
            {st.sizeTarget && !isGif ? ` · hasta ${st.sizeTarget.megabytes} MB` : ""}
          </p>
        </div>
        )}
        <Button
          variant="accent"
          size="lg"
          className="w-full"
          icon={asSnip ? <Save20Regular /> : <ArrowExport20Regular />}
          onClick={() => void (asSnip ? saveSnipNow(snipOut) : enqueueExport({ output }))}
          disabled={!project.clips.length}
          data-testid="export-btn"
        >
          {asSnip ? "Guardar proyecto" : "Exportar"}
          <kbd className="kbd ml-1">Ctrl+E</kbd>
        </Button>
      </div>
    </div>
  );
}
