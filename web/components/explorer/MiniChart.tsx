"use client";

// Dependency-free SVG line chart (no charting lib → no SSR/build risk).
export function MiniChart({
  values,
  floor,
  yMin,
  yMax,
  color,
  floorColor = "#f87171",
  height = 140,
  label,
  format = (v: number) => v.toFixed(0),
}: {
  values: number[];
  floor?: number;
  yMin: number;
  yMax: number;
  color: string;
  floorColor?: string;
  height?: number;
  label?: string;
  format?: (v: number) => string;
}) {
  const W = 320;
  const H = height;
  const pad = 8;
  const span = Math.max(1, yMax - yMin);
  const n = values.length;
  const x = (i: number) => (n <= 1 ? pad : pad + (i * (W - 2 * pad)) / (n - 1));
  const y = (v: number) => H - pad - ((v - yMin) / span) * (H - 2 * pad);

  const path = values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const floorY = floor !== undefined ? y(floor) : undefined;

  return (
    <div>
      {label && <div className="mb-1 text-[11px] uppercase tracking-wide text-white/40">{label}</div>}
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="rounded-lg bg-black/30">
        {floorY !== undefined && (
          <>
            <line x1={pad} y1={floorY} x2={W - pad} y2={floorY} stroke={floorColor} strokeDasharray="4 4" strokeWidth={1} opacity={0.8} />
            <text x={W - pad} y={floorY - 3} textAnchor="end" fontSize="9" fill={floorColor}>
              floor {format(floor!)}
            </text>
          </>
        )}
        {n > 1 && <path d={path} fill="none" stroke={color} strokeWidth={2} />}
        {values.map((v, i) => {
          const breach = floor !== undefined && v < floor;
          return <circle key={i} cx={x(i)} cy={y(v)} r={breach ? 4 : 2.5} fill={breach ? floorColor : color} />;
        })}
        {floor !== undefined &&
          (() => {
            const bi = values.findIndex((v) => v < floor);
            if (bi < 0) return null;
            return (
              <text x={x(bi)} y={y(values[bi]) + 14} textAnchor="middle" fontSize="9" fontWeight="bold" fill={floorColor}>
                BREACH
              </text>
            );
          })()}
      </svg>
    </div>
  );
}
