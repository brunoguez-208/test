// Shaders del compositor. Convención: coordenadas de píxel con origen arriba a
// la izquierda (como FFmpeg). Los FBO guardan la imagen "al revés" de GL, así
// que se muestrean con `fbo(p)`.

export const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const COMMON = `#version 300 es
precision highp float;
uniform vec2 uSize;           // tamaño del destino en píxeles
out vec4 outColor;
// Píxel actual (entero, origen arriba a la izquierda), como el x/y de FFmpeg.
vec2 pixel() { return vec2(floor(gl_FragCoord.x), uSize.y - 1.0 - floor(gl_FragCoord.y)); }
vec4 fboAt(sampler2D s, vec2 p) { return texture(s, vec2((p.x + 0.5) / uSize.x, 1.0 - (p.y + 0.5) / uSize.y)); }
float smoothstepF(float e0, float e1, float x) { float t = clamp((x - e0) / (e1 - e0), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
// mix de FFmpeg: a * m + b * (1 - m)
vec4 mixF(vec4 a, vec4 b, float m) { return a * m + b * (1.0 - m); }
`;

/**
 * Clip → lienzo, en el mismo orden que la cadena de FFmpeg (filters.rs):
 * rotar → voltear → recortar → nitidez (luma) → color → encajar en el lienzo → zoom/paneo.
 * Acá se recorre al revés: píxel del lienzo → ventana del zoom → rectángulo
 * encajado → recorte → volteo → rotación → textura del video.
 */
export const CLIP_FRAG = `${COMMON}
uniform sampler2D uTex;
uniform sampler2D uCurves;   // 256×1: curvas r, g, b del look (como lutrgb)
uniform vec4 uRect;          // x, y, w, h del contenido encajado (píxeles del lienzo)
uniform vec4 uCrop;          // recorte normalizado del cuadro ya rotado y volteado
uniform int uRotate;         // 0, 1, 2, 3 (× 90° horario)
uniform vec2 uFlip;          // 1 = volteado
uniform vec3 uZoom;          // zoom, centro x, centro y de la ventana visible (normalizado)
uniform int uColor;          // 0 = sin color, 1 = afines, 2 = afines + curvas
uniform mat3 uAdjM;          // ajustes (por filas: se usa c * M)
uniform vec3 uAdjO;
uniform mat3 uLookM;
uniform vec3 uLookO;
uniform vec2 uTexel;         // 1 / tamaño de la textura
uniform float uSharpen;      // 4·a/64 (laplaciano de luma de convolution)

float luma601(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
float curve(float v, int ch) { return texelFetch(uCurves, ivec2(int(floor(v * 255.0 + 0.5)), 0), 0)[ch]; }

void main() {
  vec2 p = pixel() + 0.5;
  // Ventana del zoom (perspective de FFmpeg): centro × tamaño + desplazamiento / zoom.
  vec2 q = uZoom.yz * uSize + (p - 0.5 * uSize) / uZoom.x;
  vec2 uv = (q - uRect.xy) / uRect.zw;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) { outColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  vec2 r = uCrop.xy + uv * uCrop.zw;
  if (uFlip.x > 0.5) r.x = 1.0 - r.x;
  if (uFlip.y > 0.5) r.y = 1.0 - r.y;
  vec2 src = r;
  if (uRotate == 1) src = vec2(r.y, 1.0 - r.x);
  else if (uRotate == 2) src = vec2(1.0 - r.x, 1.0 - r.y);
  else if (uRotate == 3) src = vec2(1.0 - r.y, r.x);
  vec3 c = texture(uTex, src).rgb;
  if (uSharpen > 0.0) {
    float avg = (luma601(texture(uTex, src + vec2(uTexel.x, 0.0)).rgb) + luma601(texture(uTex, src - vec2(uTexel.x, 0.0)).rgb) +
                 luma601(texture(uTex, src + vec2(0.0, uTexel.y)).rgb) + luma601(texture(uTex, src - vec2(0.0, uTexel.y)).rgb)) * 0.25;
    c = clamp(c + vec3(uSharpen * (luma601(c) - avg)), 0.0, 1.0);
  }
  if (uColor > 0) {
    c = clamp(c * uAdjM + uAdjO, 0.0, 1.0);
    c = clamp(c * uLookM + uLookO, 0.0, 1.0);
    if (uColor > 1) c = vec3(curve(c.r, 0), curve(c.g, 1), curve(c.b, 2));
  }
  outColor = vec4(c, 1.0);
}
`;

/** Transiciones con las mismas fórmulas que el filtro xfade de FFmpeg. */
export const TRANSITION_FRAG = `${COMMON}
uniform sampler2D uA;
uniform sampler2D uB;
uniform float uP;            // progreso de xfade: 1 al empezar → 0 al terminar
uniform int uKind;

vec4 A(vec2 p) { return fboAt(uA, p); }
vec4 B(vec2 p) { return fboAt(uB, p); }

void main() {
  vec2 p = pixel();
  float w = uSize.x, h = uSize.y, P = uP;
  vec4 black = vec4(0.0, 0.0, 0.0, 1.0);
  vec4 white = vec4(1.0);
  if (uKind == 0) { outColor = mixF(A(p), B(p), P); return; }
  if (uKind == 1 || uKind == 2) {
    vec4 bg = uKind == 1 ? black : white;
    float ph = 0.2;
    outColor = mixF(mixF(A(p), bg, smoothstepF(1.0 - ph, 1.0, P)), mixF(bg, B(p), smoothstepF(ph, 1.0, P)), P);
    return;
  }
  if (uKind == 3 || uKind == 4) { // slideleft / slideright
    float z = trunc((uKind == 3 ? -P : P) * w);
    float zx = z + p.x;
    if (zx >= 0.0 && zx < w) outColor = B(vec2(zx, p.y));
    else outColor = A(vec2(zx < 0.0 ? zx + w : zx - w, p.y));
    return;
  }
  if (uKind == 5 || uKind == 6) { // slideup / slidedown
    float z = trunc((uKind == 5 ? -P : P) * h);
    float zy = z + p.y;
    if (zy >= 0.0 && zy < h) outColor = B(vec2(p.x, zy));
    else outColor = A(vec2(p.x, zy < 0.0 ? zy + h : zy - h));
    return;
  }
  if (uKind == 7) { float z = trunc(w * P); outColor = p.x > z ? B(p) : A(p); return; }
  if (uKind == 8) { float z = trunc(w * (1.0 - P)); outColor = p.x > z ? A(p) : B(p); return; }
  if (uKind == 9) { // circleopen
    float hw = floor(w / 2.0), hh = floor(h / 2.0);
    float zc = length(vec2(hw, hh));
    float pp = (P - 0.5) * 3.0;
    float sm = length(vec2(p.x - hw, p.y - hh)) / zc + pp;
    outColor = mixF(A(p), B(p), smoothstepF(0.0, 1.0, sm));
    return;
  }
  if (uKind == 10) { // zoomin
    float zf = smoothstepF(0.5, 1.0, P);
    float u = 0.5 + (p.x / w - 0.5) * zf;
    float v = 0.5 + (p.y / h - 0.5) * zf;
    vec2 i = vec2(ceil(u * (w - 1.0)), ceil(v * (h - 1.0)));
    outColor = mixF(A(i), B(p), smoothstepF(0.0, 0.5, P));
    return;
  }
  outColor = A(p);
}
`;

/** Copia final al canvas con el fundido global (fade de FFmpeg: lineal hacia negro). */
export const BLIT_FRAG = `${COMMON}
uniform sampler2D uSrc;
uniform vec2 uSrcSize;
uniform float uFade;
void main() {
  vec2 uv = vec2(gl_FragCoord.x / uSize.x, gl_FragCoord.y / uSize.y);
  vec3 c = texture(uSrc, uv).rgb;
  outColor = vec4(c * uFade, 1.0);
}
`;

/** Superpone una textura RGBA premultiplicada (capa de texto/subtítulos) sobre el FBO. */
export const OVERLAY_FRAG = `${COMMON}
uniform sampler2D uBase;
uniform sampler2D uLayer;
uniform float uOpacity;
void main() {
  vec2 p = pixel();
  vec4 base = fboAt(uBase, p);
  vec4 l = texture(uLayer, vec2((p.x + 0.5) / uSize.x, (p.y + 0.5) / uSize.y));
  outColor = vec4(l.rgb * uOpacity + base.rgb * (1.0 - l.a * uOpacity), 1.0);
}
`;

/** Desenfoque de zona, pasada horizontal (solo cerca de la zona; el resto sale vacío). */
export const BLUR_H_FRAG = `${COMMON}
uniform sampler2D uSrc;
uniform vec4 uZone;          // x0, y0, x1, y1 en píxeles (x1/y1 excluidos)
uniform int uR;
void main() {
  vec2 p = pixel();
  if (p.x < uZone.x || p.x >= uZone.z || p.y < uZone.y - float(uR) || p.y >= uZone.w + float(uR)) { outColor = vec4(0.0); return; }
  vec4 acc = vec4(0.0);
  for (int k = -128; k <= 128; k++) {
    if (k < -uR || k > uR) continue;
    acc += fboAt(uSrc, vec2(clamp(p.x + float(k), 0.0, uSize.x - 1.0), p.y));
  }
  outColor = acc / float(2 * uR + 1);
}
`;

/** Desenfoque de zona, pasada vertical: dentro de la zona el desenfoque, afuera la imagen original. */
export const BLUR_V_FRAG = `${COMMON}
uniform sampler2D uBase;
uniform sampler2D uH;
uniform vec4 uZone;
uniform int uR;
void main() {
  vec2 p = pixel();
  if (p.x < uZone.x || p.x >= uZone.z || p.y < uZone.y || p.y >= uZone.w) { outColor = fboAt(uBase, p); return; }
  vec4 acc = vec4(0.0);
  for (int k = -128; k <= 128; k++) {
    if (k < -uR || k > uR) continue;
    acc += fboAt(uH, vec2(p.x, clamp(p.y + float(k), 0.0, uSize.y - 1.0)));
  }
  outColor = vec4((acc / float(2 * uR + 1)).rgb, 1.0);
}
`;

/** Pixelado de zona: bloques de N×N alineados al origen del cuadro (como pixelize de FFmpeg). */
export const PIXELATE_FRAG = `${COMMON}
uniform sampler2D uBase;
uniform vec4 uZone;
uniform float uN;
void main() {
  vec2 p = pixel();
  if (p.x < uZone.x || p.x >= uZone.z || p.y < uZone.y || p.y >= uZone.w) { outColor = fboAt(uBase, p); return; }
  vec2 o = floor(p / uN) * uN;
  vec2 size = min(vec2(uN), uSize - o);
  // Promedio del bloque (hasta 8×8 muestras repartidas).
  vec2 n = min(size, vec2(8.0));
  vec4 acc = vec4(0.0);
  for (int j = 0; j < 8; j++) {
    if (float(j) >= n.y) break;
    for (int i = 0; i < 8; i++) {
      if (float(i) >= n.x) break;
      acc += fboAt(uBase, o + floor((vec2(float(i), float(j)) + 0.5) * size / n));
    }
  }
  outColor = vec4((acc / (n.x * n.y)).rgb, 1.0);
}
`;

/** Picture-in-picture: el video dentro de un rectángulo con esquinas redondeadas (premultiplicado). */
export const PIP_FRAG = `${COMMON}
uniform sampler2D uTex;
uniform vec4 uRect;          // x, y, w, h en píxeles
uniform float uRadius;
// Chroma key (como chromakey + despill de FFmpeg): uKey = (U, V) del color en 0..255,
// uKeyOn, uSim, uBlend; uDespill (0 = no) y uSpill (0 verde, 1 azul).
uniform vec2 uKey;
uniform float uKeyOn;
uniform float uSim;
uniform float uBlend;
uniform float uDespill;
uniform float uSpill;
// Máscara de forma (engine/mask.ts): 0 rect, 1 redondeado, 2 círculo; rect en px locales.
uniform float uMaskOn;
uniform float uMaskShape;
uniform vec4 uMaskRect;
uniform float uMaskR;
uniform float uMaskF;
uniform float uMaskInv;
float shapeAlpha(vec2 l) {
  vec2 h = max(uMaskRect.zw * 0.5, vec2(1e-3));
  vec2 c = uMaskRect.xy + h;
  float d;
  if (uMaskShape > 1.5) {
    d = (length((l - c) / h) - 1.0) * min(h.x, h.y);
  } else {
    float r = uMaskShape > 0.5 ? min(uMaskR, min(h.x, h.y)) : 0.0;
    vec2 q = abs(l - c) - (h - vec2(r));
    d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  }
  float a = clamp(0.5 - d / uMaskF, 0.0, 1.0);
  return uMaskInv > 0.5 ? 1.0 - a : a;
}
vec2 uvOf(vec3 c) {
  vec3 r = c * 255.0;
  float u = (-0.16874 * r.r - 0.33126 * r.g + 0.5 * r.b) * 224.0 / 255.0 + 128.0;
  float v = (0.5 * r.r - 0.41869 * r.g - 0.08131 * r.b) * 224.0 / 255.0 + 128.0;
  return vec2(u, v);
}
void main() {
  vec2 p = pixel() + 0.5;
  vec2 local = p - uRect.xy;
  if (local.x < 0.0 || local.y < 0.0 || local.x > uRect.z || local.y > uRect.w) discard;
  vec2 half_ = uRect.zw * 0.5;
  vec2 q = abs(local - half_) - (half_ - vec2(uRadius));
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - uRadius;
  float a = clamp(0.5 - d, 0.0, 1.0);
  if (uMaskOn > 0.5) a *= shapeAlpha(local);
  if (a <= 0.0) discard;
  vec3 c = texture(uTex, local / uRect.zw).rgb;
  if (uKeyOn > 0.5) {
    // Distancia UV promediada en 3×3 (vecinos del plano de croma 4:2:0 = 2 px).
    float diff = 0.0;
    for (int dy = -1; dy <= 1; dy++) {
      for (int dx = -1; dx <= 1; dx++) {
        vec2 o = clamp(local + vec2(float(dx), float(dy)) * 2.0, vec2(0.5), uRect.zw - 0.5);
        vec2 kv = uvOf(texture(uTex, o / uRect.zw).rgb) - uKey;
        diff += sqrt(dot(kv, kv) / (255.0 * 255.0 * 2.0));
      }
    }
    diff /= 9.0;
    float k = uBlend > 0.0001 ? clamp((diff - uSim) / uBlend, 0.0, 1.0) : (diff > uSim ? 1.0 : 0.0);
    a *= k;
    if (a <= 0.0) discard;
    if (uDespill > 0.0 && uSpill > -0.5) {
      if (uSpill < 0.5) {
        float s = max(c.g - (c.r * 0.5 + c.b * 0.5), 0.0);
        c.g = max(c.g - s * uDespill, 0.0);
      } else {
        float s = max(c.b - (c.r * 0.5 + c.g * 0.5), 0.0);
        c.b = max(c.b - s * uDespill, 0.0);
      }
    }
  }
  outColor = vec4(c * a, a);
}
`;

/**
 * Efectos de un clic sobre el cuadro ya compuesto (como filters.rs, paso 2b):
 * 0 = ventana (temblor/zoom punch, perspective), 1 = glitch (geq en enteros),
 * 2 = tinte (flash blanco o viñeta negra, overlay con alfa).
 */
export const EFFECT_FRAG = `${COMMON}
uniform sampler2D uSrc;
uniform int uMode;
uniform vec3 uWin;           // zoom, centro x, centro y
uniform vec2 uCanvas;        // tamaño del lienzo (px de la exportación)
uniform float uK;            // paso del glitch
uniform float uI;            // intensidad
uniform vec3 uTint;
uniform float uAlpha;
uniform float uVignette;
float rnd(float v) { return floor(v + 0.5); }
void main() {
  vec2 p = pixel();
  if (uMode == 0) {
    vec2 q = uWin.yz * uSize + (p + 0.5 - 0.5 * uSize) / uWin.x;
    outColor = vec4(fboAt(uSrc, q - 0.5).rgb, 1.0);
    return;
  }
  if (uMode == 1) {
    vec2 s = uCanvas / uSize;
    vec2 pc = floor((p + 0.5) * s);
    float b = floor(pc.y * 18.0 / uCanvas.y);
    float h = mod(b * 37.0 + uK * 101.0 + 7.0, 23.0) / 23.0;
    float shift = h > 0.62 ? rnd(uI * uCanvas.x * 0.06 * (h - 0.62) / 0.38) * (2.0 * mod(b + uK, 2.0) - 1.0) : 0.0;
    float split = rnd(uI * uCanvas.x * 0.006 * (1.0 + mod(uK * 7.0, 3.0)));
    float xr = clamp(pc.x + shift + split, 0.0, uCanvas.x - 1.0);
    float xg = clamp(pc.x + shift, 0.0, uCanvas.x - 1.0);
    float xb = clamp(pc.x + shift - split, 0.0, uCanvas.x - 1.0);
    float r = fboAt(uSrc, vec2((xr + 0.5) / s.x - 0.5, p.y)).r;
    float g = fboAt(uSrc, vec2((xg + 0.5) / s.x - 0.5, p.y)).g;
    float bl = fboAt(uSrc, vec2((xb + 0.5) / s.x - 0.5, p.y)).b;
    outColor = vec4(r, g, bl, 1.0);
    return;
  }
  vec3 c = fboAt(uSrc, p).rgb;
  float a = uAlpha;
  if (uVignette > 0.5) {
    vec2 n = (p + 0.5) / uSize;
    float d = length(2.0 * n - 1.0) / sqrt(2.0);
    float t = clamp((d - 0.3) / 0.7, 0.0, 1.0);
    a *= t * t * (3.0 - 2.0 * t);
  }
  outColor = vec4(c * (1.0 - a) + uTint * a, 1.0);
}
`;

/** Capa RGBA premultiplicada sobre el destino (con blending). */
export const LAYER_FRAG = `${COMMON}
uniform sampler2D uLayer;
void main() {
  vec2 p = pixel();
  outColor = texture(uLayer, vec2((p.x + 0.5) / uSize.x, (p.y + 0.5) / uSize.y));
}
`;

export const TRANSITION_INDEX: Record<string, number> = {
  fade: 0,
  fadeBlack: 1,
  fadeWhite: 2,
  slideLeft: 3,
  slideRight: 4,
  slideUp: 5,
  slideDown: 6,
  wipeLeft: 7,
  wipeRight: 8,
  circleOpen: 9,
  zoomIn: 10,
};
