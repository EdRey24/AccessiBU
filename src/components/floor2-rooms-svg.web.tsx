import { FLOOR2_ASPECT, floor2OutlineShape, floor2RoomShapes } from '@/services/floor-geo';

/**
 * Vector floor plan for CDS Floor 2, drawn from the room GeoJSON instead of the
 * blurry PNG. Pure SVG, rendered into a 0–1000 x 0–H viewBox so it stretches to
 * fill its container. Non-interactive background layer — the parent handles pin
 * placement in the same normalized (0–1) space, so coordinates line up exactly.
 */
// viewBox width is fixed; height derives from the plan's true aspect so rooms
// aren't distorted and label sizing (in viewBox units) matches room geometry.
const W = 1000;

export function Floor2RoomsSvg() {
  const shapes = floor2RoomShapes();
  const outline = floor2OutlineShape();
  const H = Math.round(W / FLOOR2_ASPECT);

  const toPts = (pts: { x: number; y: number }[]) =>
    pts.map((p) => `${(p.x * W).toFixed(1)},${(p.y * H).toFixed(1)}`).join(' ');

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      width="100%"
      height="100%"
      style={{ position: 'absolute', inset: 0, display: 'block', background: '#fff' }}>
      {/* Building outline fill */}
      <polygon points={toPts(outline)} fill="#faf8f3" stroke="#111" strokeWidth={2.5} />

      {/* Rooms */}
      {shapes.map((s) => (
        <polygon key={s.id} points={toPts(s.points)} fill={s.fill} stroke="#333" strokeWidth={1} />
      ))}

      {/* Labels — fitted to each room's box so text never spills out of bounds */}
      {shapes.map((s) => (
        <RoomLabel key={`${s.id}-label`} shape={s} vbH={H} />
      ))}
    </svg>
  );
}

/**
 * A room label constrained to its room's bounding box. We compute the room's
 * pixel width/height in the viewBox, pick a font size that fits, wrap the name
 * onto up to two lines, and hide the label entirely if the room is too small to
 * hold even one readable line. This is what stops names going out of bounds.
 */
function RoomLabel({ shape, vbH }: { shape: ReturnType<typeof floor2RoomShapes>[number]; vbH: number }) {
  const H = vbH;
  const xs = shape.points.map((p) => p.x * W);
  const ys = shape.points.map((p) => p.y * H);
  const boxW = Math.max(...xs) - Math.min(...xs);
  const boxH = Math.max(...ys) - Math.min(...ys);

  // Hide labels for rooms too small to show text cleanly.
  if (boxW < 14 || boxH < 10) return null;

  const cx = shape.label.x * W;
  const cy = shape.label.y * H;

  // Display name without the trailing "(… ft²)" area annotation — rooms like
  // "Study Space (388 ft²)" should just read "Study Space" on the map.
  const displayName = stripArea(shape.name);

  // Wrap the name to fit the room width, max 2 lines; drop parenthetical detail
  // first if it's still too long.
  const lines = fitLines(displayName, boxW);
  // Font size: fits the widest line within the box width, capped by height.
  const longest = Math.max(...lines.map((l) => l.length), 1);
  const CHAR_W = 0.52; // approx glyph width / font size
  let fontSize = Math.min((boxW * 0.92) / (longest * CHAR_W), boxH / (lines.length + 0.5), 11);
  fontSize = Math.max(fontSize, 4.5);
  if (fontSize < 5.5 && lines.length > 1) {
    // Too cramped for two lines — fall back to a single truncated line.
    return (
      <text {...labelProps(cx, cy, Math.min((boxW * 0.92) / (CHAR_W * 12), boxH * 0.8, 9))}>
        {truncate(displayName, Math.max(4, Math.floor(boxW / (CHAR_W * 6))))}
      </text>
    );
  }

  const lineH = fontSize * 1.05;
  const startY = cy - ((lines.length - 1) * lineH) / 2;

  return (
    <text {...labelProps(cx, startY, fontSize)}>
      {lines.map((ln, i) => (
        <tspan key={i} x={cx} y={startY + i * lineH}>
          {ln}
        </tspan>
      ))}
    </text>
  );
}

function labelProps(x: number, y: number, fontSize: number) {
  return {
    x,
    y,
    fontSize,
    fill: '#222',
    textAnchor: 'middle' as const,
    dominantBaseline: 'middle' as const,
    style: { pointerEvents: 'none' as const, userSelect: 'none' as const },
  };
}

/**
 * Break a room name into at most two lines that each fit `boxW`. Splits on
 * spaces; if a single word is still too wide, it will be truncated by the
 * caller via font sizing. Strips a trailing parenthetical if that lets it fit.
 */
function fitLines(name: string, boxW: number): string[] {
  const CHAR_W = 0.52;
  // Rough max chars per line at a comfortable ~8px font.
  const maxChars = Math.max(6, Math.floor(boxW / (CHAR_W * 8)));

  if (name.length <= maxChars) return [name];

  // Drop a parenthetical suffix first (e.g. "Study Space (388 ft²)").
  const noParen = name.replace(/\s*\([^)]*\)\s*$/, '').trim();
  if (noParen && noParen.length <= maxChars) return [noParen];

  // Greedy wrap into two lines.
  const words = (noParen || name).split(/\s+/);
  const l1: string[] = [];
  let i = 0;
  while (i < words.length && (l1.join(' ') + ' ' + words[i]).trim().length <= maxChars) {
    l1.push(words[i]);
    i++;
  }
  const line1 = l1.join(' ') || words[0];
  const line2 = words.slice(Math.max(1, i)).join(' ');
  if (!line2) return [truncate(line1, maxChars)];
  return [truncate(line1, maxChars), truncate(line2, maxChars)];
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, Math.max(1, max - 1)) + '…' : s;
}

/** Remove a trailing area annotation like "(388 ft²)" or "(18.2 m²)". */
function stripArea(name: string): string {
  return name.replace(/\s*\(\s*[\d.]+\s*(ft²|ft2|m²|m2|sq ?ft)\s*\)\s*$/i, '').trim();
}
