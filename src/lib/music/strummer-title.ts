// Title generator helper (used by legacy strummer shim)
const ADJS = ["Soft","Warm","Late","Quiet","Small","Still","Light","Deep","Slow","Golden","Pale","Faint","Wild","Clear","Brief","Simple"];
const NOUNS = ["Evening","Room","Sky","Distance","Window","Rain","Shore","Ember","Hour","Garden","Shadow","Voice","Memory","Blue"];
export function generateTitle(): string {
  const a = ADJS[Math.floor(Math.random() * ADJS.length)] ?? "Soft";
  const n = NOUNS[Math.floor(Math.random() * NOUNS.length)] ?? "Room";
  return `${a} ${n}`;
}
