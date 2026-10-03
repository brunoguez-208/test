// Renderer WebGL2 del preview: dibuja cada clip activo en un FBO del tamaño del
// lienzo, resuelve la transición y copia al canvas con el fundido global.

import { BLIT_FRAG, BLUR_H_FRAG, BLUR_V_FRAG, CLIP_FRAG, LAYER_FRAG, OVERLAY_FRAG, PIP_FRAG, PIXELATE_FRAG, TRANSITION_FRAG, TRANSITION_INDEX, VERT } from "./shaders";
import type { ColorPipeline } from "./color";
import type { ChromaUniforms } from "./chroma";

export interface ClipDraw {
  source: TexImageSource;
  /** Tamaño de la textura (para el paso de la nitidez). */
  texW: number;
  texH: number;
  /** Recorte normalizado del cuadro ya rotado (redondeado como en la exportación). */
  crop: { x: number; y: number; w: number; h: number };
  /** Tamaño visible del clip (después de rotar y recortar): define el encaje en el lienzo. */
  dispW: number;
  dispH: number;
  rotate: number;
  flipH: boolean;
  flipV: boolean;
  zoom: { zoom: number; cx: number; cy: number };
  color: ColorPipeline | null;
  /** Peso de la nitidez en 1/64 (0 = sin nitidez). */
  sharpen: number;
}

/** Zona desenfocada o pixelada (píxeles del render, x1/y1 excluidos). */
export interface BlurDraw {
  zone: [number, number, number, number];
  mode: "blur" | "pixelate";
  /** Radio del desenfoque o lado del bloque, en píxeles del render. */
  size: number;
}

/** Picture-in-picture: video en un rectángulo con esquinas redondeadas y sombra opcional. */
export interface PipDraw {
  source: TexImageSource;
  rect: { x: number; y: number; w: number; h: number };
  radius: number;
  shadow: { source: TexImageSource; key: string } | null;
  chroma?: ChromaUniforms | null;
}

export interface FrameDraw {
  a: ClipDraw | null;
  b: ClipDraw | null;
  transition: { kind: string; progress: number } | null;
  fade: number;
  /** Zonas desenfocadas y PiP (en ese orden, antes de las capas). */
  blurs?: BlurDraw[];
  pips?: PipDraw[];
  /** Capas RGBA del tamaño del lienzo, en orden. `key` cambia cuando cambia el contenido. */
  layers: { source: TexImageSource; key: string }[];
}

interface Program {
  prog: WebGLProgram;
  loc: Record<string, WebGLUniformLocation | null>;
}

interface Target {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
}

/** Redondea al par más cercano (como force_divisible_by=2 de FFmpeg). */
function even(x: number): number {
  return Math.max(2, Math.round(x / 2) * 2);
}

/** Rectángulo del contenido encajado (scale decrease + pad centrado), en píxeles. */
export function fitRect(srcW: number, srcH: number, W: number, H: number) {
  const s = Math.min(W / srcW, H / srcH);
  const w = Math.min(W, even(srcW * s));
  const h = Math.min(H, even(srcH * s));
  const x = Math.floor((W - w) / 2 / 2) * 2;
  const y = Math.floor((H - h) / 2 / 2) * 2;
  return { x, y, w, h };
}

export class Renderer {
  readonly gl: WebGL2RenderingContext;
  private clipProg: Program;
  private transProg: Program;
  private blitProg: Program;
  private overlayProg: Program;
  private blurHProg: Program;
  private blurVProg: Program;
  private pixProg: Program;
  private pipProg: Program;
  private layerProg: Program;
  private pipTex: WebGLTexture[] = [];
  private shadowTex: WebGLTexture[] = [];
  private shadowKeys: string[] = [];
  private vao: WebGLVertexArrayObject;
  private targets: Target[] = [];
  private tw = 0;
  private th = 0;
  private videoTex: WebGLTexture[] = [];
  private layerTex: WebGLTexture;
  private curveTex: WebGLTexture[] = [];
  private curveKey: (string | null)[] = [null, null];
  private layerKey = "";
  lost = false;

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, preserveDrawingBuffer: true, premultipliedAlpha: false });
    if (!gl) throw new Error("WebGL2 no disponible");
    this.gl = gl;
    canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      this.lost = true;
    });
    this.clipProg = this.program(CLIP_FRAG, [
      "uSize", "uTex", "uCurves", "uRect", "uCrop", "uRotate", "uFlip", "uZoom", "uColor", "uAdjM", "uAdjO", "uLookM", "uLookO", "uTexel", "uSharpen",
    ]);
    this.transProg = this.program(TRANSITION_FRAG, ["uSize", "uA", "uB", "uP", "uKind"]);
    this.blitProg = this.program(BLIT_FRAG, ["uSize", "uSrc", "uSrcSize", "uFade"]);
    this.overlayProg = this.program(OVERLAY_FRAG, ["uSize", "uBase", "uLayer", "uOpacity"]);
    this.blurHProg = this.program(BLUR_H_FRAG, ["uSize", "uSrc", "uZone", "uR"]);
    this.blurVProg = this.program(BLUR_V_FRAG, ["uSize", "uBase", "uH", "uZone", "uR"]);
    this.pixProg = this.program(PIXELATE_FRAG, ["uSize", "uBase", "uZone", "uN"]);
    this.pipProg = this.program(PIP_FRAG, ["uSize", "uTex", "uRect", "uRadius", "uKey", "uKeyOn", "uSim", "uBlend", "uDespill", "uSpill"]);
    this.layerProg = this.program(LAYER_FRAG, ["uSize", "uLayer"]);
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    for (const p of [this.clipProg, this.transProg, this.blitProg, this.overlayProg, this.blurHProg, this.blurVProg, this.pixProg, this.pipProg, this.layerProg]) {
      const loc = gl.getAttribLocation(p.prog, "aPos");
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    }
    this.vao = vao;
    this.videoTex = [this.texture(true), this.texture(true)];
    this.layerTex = this.texture(false);
    this.curveTex = [0, 1].map(() => {
      const t = this.texture(false);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      return t;
    });
  }

  private program(frag: string, uniforms: string[]): Program {
    const gl = this.gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || "shader");
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, frag));
    gl.bindAttribLocation(prog, 0, "aPos");
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || "link");
    const loc: Record<string, WebGLUniformLocation | null> = {};
    for (const u of uniforms) loc[u] = gl.getUniformLocation(prog, u);
    return { prog, loc };
  }

  private texture(mip: boolean): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  /** FBOs del tamaño del lienzo de render. */
  private ensureTargets(w: number, h: number) {
    if (this.tw === w && this.th === h && this.targets.length) return;
    const gl = this.gl;
    for (const t of this.targets) {
      gl.deleteFramebuffer(t.fbo);
      gl.deleteTexture(t.tex);
    }
    this.targets = [];
    for (let i = 0; i < 3; i++) {
      const tex = this.texture(false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      const fbo = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      this.targets.push({ fbo, tex });
    }
    this.tw = w;
    this.th = h;
  }

  private drawClip(c: ClipDraw, slot: number, target: Target, w: number, h: number, downscale: boolean) {
    const gl = this.gl;
    const P = this.clipProg;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.viewport(0, 0, w, h);
    gl.useProgram(P.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.videoTex[slot]);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c.source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, downscale ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    if (downscale) gl.generateMipmap(gl.TEXTURE_2D);
    const rot = (((Math.round(c.rotate / 90) % 4) + 4) % 4) as 0 | 1 | 2 | 3;
    const r = fitRect(c.dispW, c.dispH, w, h);
    gl.uniform2f(P.loc.uSize, w, h);
    gl.uniform1i(P.loc.uTex, 0);
    gl.uniform4f(P.loc.uRect, r.x, r.y, r.w, r.h);
    gl.uniform4f(P.loc.uCrop, c.crop.x, c.crop.y, c.crop.w, c.crop.h);
    gl.uniform1i(P.loc.uRotate, rot);
    gl.uniform2f(P.loc.uFlip, c.flipH ? 1 : 0, c.flipV ? 1 : 0);
    gl.uniform3f(P.loc.uZoom, Math.max(1, c.zoom.zoom), c.zoom.cx, c.zoom.cy);
    const col = c.color;
    gl.uniform1i(P.loc.uColor, col ? (col.hasCurves ? 2 : 1) : 0);
    if (col) {
      // Filas de Rust → columnas de GL: en el shader se usa c * M.
      gl.uniformMatrix3fv(P.loc.uAdjM, false, col.adjust.m);
      gl.uniform3fv(P.loc.uAdjO, col.adjust.o);
      gl.uniformMatrix3fv(P.loc.uLookM, false, col.look.m);
      gl.uniform3fv(P.loc.uLookO, col.look.o);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.curveTex[slot]);
      if (this.curveKey[slot] !== col.key) {
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1, gl.RGBA, gl.UNSIGNED_BYTE, col.curves);
        this.curveKey[slot] = col.key;
      }
      gl.uniform1i(P.loc.uCurves, 2);
      gl.activeTexture(gl.TEXTURE0);
    }
    gl.uniform2f(P.loc.uTexel, 1 / Math.max(1, c.texW), 1 / Math.max(1, c.texH));
    gl.uniform1f(P.loc.uSharpen, (4 * c.sharpen) / 64);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /**
   * Dibuja un cuadro. `renderW/H` es la resolución interna (el lienzo del
   * proyecto o menos, para el preview); el canvas se estira con CSS.
   */
  render(f: FrameDraw, renderW: number, renderH: number) {
    if (this.lost) return;
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    this.ensureTargets(renderW, renderH);
    const [ta, tb, tc] = this.targets;
    const clear = (t: Target) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
      gl.viewport(0, 0, renderW, renderH);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    };
    const down = (c: ClipDraw) => c.sharpen === 0 && (c.texW > renderW * 1.5 || c.texH > renderH * 1.5);
    if (f.a) this.drawClip(f.a, 0, ta, renderW, renderH, down(f.a));
    else clear(ta);
    let result = ta;
    if (f.b && f.transition) {
      this.drawClip(f.b, 1, tb, renderW, renderH, down(f.b));
      const P = this.transProg;
      gl.bindFramebuffer(gl.FRAMEBUFFER, tc.fbo);
      gl.viewport(0, 0, renderW, renderH);
      gl.useProgram(P.prog);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, ta.tex);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, tb.tex);
      gl.uniform2f(P.loc.uSize, renderW, renderH);
      gl.uniform1i(P.loc.uA, 0);
      gl.uniform1i(P.loc.uB, 1);
      gl.uniform1f(P.loc.uP, Math.min(1, Math.max(0, f.transition.progress)));
      gl.uniform1i(P.loc.uKind, TRANSITION_INDEX[f.transition.kind] ?? 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      result = tc;
    }
    // Zonas desenfocadas / pixeladas: siempre a otro FBO (no se lee y escribe el mismo).
    for (const z of f.blurs ?? []) {
      const others = this.targets.filter((t) => t !== result);
      const [tmp, out] = others;
      if (z.mode === "blur") {
        const R = Math.max(1, Math.min(128, Math.round(z.size)));
        let P = this.blurHProg;
        gl.bindFramebuffer(gl.FRAMEBUFFER, tmp.fbo);
        gl.viewport(0, 0, renderW, renderH);
        gl.useProgram(P.prog);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, result.tex);
        gl.uniform2f(P.loc.uSize, renderW, renderH);
        gl.uniform1i(P.loc.uSrc, 0);
        gl.uniform4f(P.loc.uZone, ...z.zone);
        gl.uniform1i(P.loc.uR, R);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        P = this.blurVProg;
        gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo);
        gl.useProgram(P.prog);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, result.tex);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, tmp.tex);
        gl.uniform2f(P.loc.uSize, renderW, renderH);
        gl.uniform1i(P.loc.uBase, 0);
        gl.uniform1i(P.loc.uH, 1);
        gl.uniform4f(P.loc.uZone, ...z.zone);
        gl.uniform1i(P.loc.uR, R);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      } else {
        const P = this.pixProg;
        gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo);
        gl.viewport(0, 0, renderW, renderH);
        gl.useProgram(P.prog);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, result.tex);
        gl.uniform2f(P.loc.uSize, renderW, renderH);
        gl.uniform1i(P.loc.uBase, 0);
        gl.uniform4f(P.loc.uZone, ...z.zone);
        gl.uniform1f(P.loc.uN, Math.max(1, z.size));
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
      result = out;
    }
    // Picture-in-picture: sombra y video se dibujan encima, con blending.
    (f.pips ?? []).forEach((pip, i) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, result.fbo);
      gl.viewport(0, 0, renderW, renderH);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      if (pip.shadow) {
        while (this.shadowTex.length <= i) {
          this.shadowTex.push(this.texture(false));
          this.shadowKeys.push("");
        }
        const P = this.layerProg;
        gl.useProgram(P.prog);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.shadowTex[i]);
        if (this.shadowKeys[i] !== pip.shadow.key) {
          gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, pip.shadow.source);
          gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
          this.shadowKeys[i] = pip.shadow.key;
        }
        gl.uniform2f(P.loc.uSize, renderW, renderH);
        gl.uniform1i(P.loc.uLayer, 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
      while (this.pipTex.length <= i) this.pipTex.push(this.texture(true));
      const P = this.pipProg;
      gl.useProgram(P.prog);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.pipTex[i]);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, pip.source);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.uniform2f(P.loc.uSize, renderW, renderH);
      gl.uniform1i(P.loc.uTex, 0);
      gl.uniform4f(P.loc.uRect, pip.rect.x, pip.rect.y, pip.rect.w, pip.rect.h);
      gl.uniform1f(P.loc.uRadius, pip.radius);
      const k = pip.chroma;
      gl.uniform1f(P.loc.uKeyOn, k ? 1 : 0);
      gl.uniform2f(P.loc.uKey, k?.uv[0] ?? 0, k?.uv[1] ?? 0);
      gl.uniform1f(P.loc.uSim, k?.similarity ?? 0);
      gl.uniform1f(P.loc.uBlend, k?.smoothness ?? 0);
      gl.uniform1f(P.loc.uDespill, k?.despill ?? 0);
      gl.uniform1f(P.loc.uSpill, k?.spill ?? -1);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.disable(gl.BLEND);
    });
    // Capas (texto, subtítulos, logos): alternando entre dos FBO.
    for (const layer of f.layers) {
      const dst = this.targets.find((t) => t !== result && t !== ta) ?? (result === tc ? tb : tc);
      const P = this.overlayProg;
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
      gl.viewport(0, 0, renderW, renderH);
      gl.useProgram(P.prog);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, result.tex);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.layerTex);
      // Solo se sube la textura si la capa cambió (texto quieto = sin costo por cuadro).
      if (layer.key !== this.layerKey || f.layers.length > 1) {
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, layer.source);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        this.layerKey = f.layers.length > 1 ? "" : layer.key;
      }
      gl.uniform2f(P.loc.uSize, renderW, renderH);
      gl.uniform1i(P.loc.uBase, 0);
      gl.uniform1i(P.loc.uLayer, 1);
      gl.uniform1f(P.loc.uOpacity, 1);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      result = dst;
    }
    // Al canvas.
    const P = this.blitProg;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(P.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, result.tex);
    gl.uniform2f(P.loc.uSize, this.canvas.width, this.canvas.height);
    gl.uniform2f(P.loc.uSrcSize, renderW, renderH);
    gl.uniform1i(P.loc.uSrc, 0);
    gl.uniform1f(P.loc.uFade, Math.min(1, Math.max(0, f.fade)));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  dispose() {
    const gl = this.gl;
    for (const t of this.targets) {
      gl.deleteFramebuffer(t.fbo);
      gl.deleteTexture(t.tex);
    }
    this.targets = [];
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}
