/** Ícono de la app en versión chica (para la barra de título). */
export function AppGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <defs>
        <linearGradient id="snip-g" x1="8" y1="6" x2="58" y2="60" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#4FB6FF" />
          <stop offset="0.55" stopColor="#2F6BFF" />
          <stop offset="1" stopColor="#6A3CF5" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="15" fill="url(#snip-g)" />
      <rect x="9" y="23" width="46" height="18" rx="3" fill="#fff" fillOpacity="0.25" />
      <rect x="16" y="15" width="7" height="34" rx="3.5" fill="#fff" />
      <rect x="41" y="15" width="7" height="34" rx="3.5" fill="#fff" />
      <path d="M29 26.5 L36 32 L29 37.5 Z" fill="#fff" />
    </svg>
  );
}
