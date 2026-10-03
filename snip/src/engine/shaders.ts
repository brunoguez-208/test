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
 * Clip → lienzo. Mapea cada píxel del lienzo al original:
 * lienzo → (zoom/paneo) → rectángulo encajado → volteo → rotación → recorte → video.
 * Después aplica los ajustes de color (en el mismo orden que el filtro de FFmpeg).
 */
export const CLIP_FRAG = `${COMMON}
uniform sampler2D uTex;
uniform vec4 uRect;          // x, y, w, h del contenido encajado (píxeles del lienzo)
uniform vec4 uCrop;          // recorte normalizado del original (x, y, w, h)
uniform int uRotate;         // 0, 1, 2, 3 (× 90° horario)
uniform vec2 uFlip;          // 1 = volteado
uniform vec3 uZoom;          // zoom, centro x, centro y (normalizado)
uniform vec4 uColor;         // brillo, contraste, saturación, temperatura (FFmpeg)
uniform float uExposure;
uniform float uGamma;
uniform mat3 uLook;          // matriz de color del look (identidad si no hay)
uniform float uLookMix;
uniform vec2 uTexel;         // 1 / tamaño de la textura (nitidez)
uniform float uSharpen;

vec3 applyColor(vec3 c) {
  // exposure (FFmpeg: exposure=EV) → multiplica por 2^EV
  c = c * exp2(uExposure);
  // eq: contraste, brillo, saturación y gamma (como vf_eq en RGB equivalente)
  c = (c - 0.5) * uColor.y + 0.5 + uColor.x;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uColor.z);
  c = pow(max(c, 0.0), vec3(1.0 / uGamma));
  // temperatura: balance azul/rojo
  c.r *= 1.0 + uColor.w * 0.18;
  c.b *= 1.0 - uColor.w * 0.18;
  vec3 looked = clamp(uLook * c, 0.0, 1.0);
  return clamp(mix(c, looked, uLookMix), 0.0, 1.0);
}

void main() {
  vec2 p = pixel() + 0.5;
  // Zoom / paneo sobre el lienzo.
  vec2 center = uZoom.yz * uSize;
  vec2 q = (p - center) / uZoom.x + center;
  vec2 uv = (q - uRect.xy) / uRect.zw;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) { outColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  if (uFlip.x > 0.5) uv.x = 1.0 - uv.x;
  if (uFlip.y > 0.5) uv.y = 1.0 - uv.y;
  // Deshacer la rotación (horaria) del contenido.
  vec2 r = uv;
  if (uRotate == 1) r = vec2(uv.y, 1.0 - uv.x);
  else if (uRotate == 2) r = vec2(1.0 - uv.x, 1.0 - uv.y);
  else if (uRotate == 3) r = vec2(1.0 - uv.y, uv.x);
  vec2 src = uCrop.xy + r * uCrop.zw;
  vec3 c = texture(uTex, src).rgb;
  if (uSharpen > 0.0) {
    vec3 blur = (texture(uTex, src + vec2(uTexel.x, 0.0)).rgb + texture(uTex, src - vec2(uTexel.x, 0.0)).rgb +
                 texture(uTex, src + vec2(0.0, uTexel.y)).rgb + texture(uTex, src - vec2(0.0, uTexel.y)).rgb) * 0.25;
    c = c + (c - blur) * uSharpen;
  }
  outColor = vec4(applyColor(c), 1.0);
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
