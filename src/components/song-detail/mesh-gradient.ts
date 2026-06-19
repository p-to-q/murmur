type RGB = { r: number; g: number; b: number };

export function parseHex(hex: string): RGB {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

export function rgba(c: RGB, a: number): string {
  return `rgba(${c.r},${c.g},${c.b},${a})`;
}

function darken(c: RGB, amount: number): RGB {
  const f = 1 - amount;
  return {
    r: Math.round(c.r * f),
    g: Math.round(c.g * f),
    b: Math.round(c.b * f),
  };
}

export function buildMeshGradient(
  gradient: string,
  palette?: string[],
): React.CSSProperties {
  const hexes =
    palette && palette.length >= 2
      ? palette
      : gradient.match(/#[0-9A-Fa-f]{6}/g) ?? ["#4A9B8E", "#2D6B5F"];
  const c1 = parseHex(hexes[0] ?? "#4A9B8E");
  const c2 = parseHex(hexes[1] ?? hexes[0] ?? "#2D6B5F");
  const c3 = hexes[2] ? parseHex(hexes[2]) : darken(c1, 0.3);
  const c4 = hexes[3] ? parseHex(hexes[3]) : darken(c2, 0.2);

  return {
    background: [
      `radial-gradient(ellipse 130% 90% at 15% 75%, ${rgba(c1, 0.8)} 0%, transparent 55%)`,
      `radial-gradient(ellipse 110% 110% at 85% 15%, ${rgba(c2, 0.53)} 0%, transparent 50%)`,
      `radial-gradient(ellipse 90% 130% at 45% 50%, ${rgba(c3, 0.33)} 0%, transparent 55%)`,
      `radial-gradient(ellipse 150% 70% at 75% 85%, ${rgba(c4, 0.27)} 0%, transparent 45%)`,
      `linear-gradient(160deg, ${rgba(darken(c1, 0.2), 1)} 0%, ${rgba(darken(c2, 0.35), 1)} 100%)`,
    ].join(", "),
  };
}
