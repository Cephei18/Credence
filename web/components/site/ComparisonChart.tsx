"use client";

import { motion } from "framer-motion";
import type { TrajectoryPoint } from "@/lib/credence";

const ACCENT = "#34d399";
const FAIL = "#fb7185";

/** One chart, the whole story: the policy floor, Alpha holding above it, and Beta
 *  sinking below it into a breach. Stable allocation (% of treasury in safe
 *  assets) on the Y axis, time on the X axis. */
export function ComparisonChart({
  alpha,
  beta,
  floorBps,
}: {
  alpha: TrajectoryPoint[];
  beta: TrajectoryPoint[];
  floorBps: number;
}) {
  const W = 720;
  const H = 320;
  const padL = 44;
  const padR = 20;
  const padT = 24;
  const padB = 34;

  const yMin = 4000;
  const yMax = 10000;
  const span = yMax - yMin;

  const sx = (i: number, n: number) =>
    n <= 1 ? padL : padL + (i * (W - padL - padR)) / (n - 1);
  const sy = (v: number) => padT + (1 - (v - yMin) / span) * (H - padT - padB);

  const line = (pts: TrajectoryPoint[]) =>
    pts.map((p, i) => `${i === 0 ? "M" : "L"}${sx(i, pts.length).toFixed(1)},${sy(p.stableBps).toFixed(1)}`).join(" ");

  const floorY = sy(floorBps);
  const betaBreachIdx = beta.findIndex((p) => p.stableBps < floorBps);
  const gridVals = [10000, 8000, 6000, 4000];

  return (
    <div className="surface overflow-hidden p-4 sm:p-6">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Stable allocation over time for both agents">
        {/* gridlines + y labels */}
        {gridVals.map((v) => (
          <g key={v}>
            <line x1={padL} y1={sy(v)} x2={W - padR} y2={sy(v)} stroke="rgba(255,255,255,0.05)" strokeWidth={1} />
            <text x={padL - 10} y={sy(v) + 3} textAnchor="end" fontSize="10" fill="rgba(244,246,250,0.35)" className="mono">
              {v / 100}%
            </text>
          </g>
        ))}

        {/* breach zone below the floor */}
        <rect x={padL} y={floorY} width={W - padL - padR} height={H - padB - floorY} fill="rgba(251,113,133,0.05)" />

        {/* policy floor */}
        <line x1={padL} y1={floorY} x2={W - padR} y2={floorY} stroke={FAIL} strokeWidth={1.5} strokeDasharray="5 5" opacity={0.7} />
        <text x={W - padR} y={floorY - 7} textAnchor="end" fontSize="11" fill={FAIL} fontWeight="600">
          Policy floor · 80% stable
        </text>

        {/* Alpha */}
        <motion.path
          d={line(alpha)}
          fill="none"
          stroke={ACCENT}
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          whileInView={{ pathLength: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 1.1, ease: "easeInOut" }}
        />
        {/* Beta */}
        <motion.path
          d={line(beta)}
          fill="none"
          stroke={FAIL}
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          whileInView={{ pathLength: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 1.1, ease: "easeInOut", delay: 0.15 }}
        />

        {/* breach marker on Beta */}
        {betaBreachIdx >= 0 && (
          <motion.g
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 1.1 }}
          >
            <circle cx={sx(betaBreachIdx, beta.length)} cy={sy(beta[betaBreachIdx].stableBps)} r={5} fill={FAIL} />
            <circle cx={sx(betaBreachIdx, beta.length)} cy={sy(beta[betaBreachIdx].stableBps)} r={9} fill="none" stroke={FAIL} strokeWidth={1.5} opacity={0.5} />
            <text x={sx(betaBreachIdx, beta.length)} y={sy(beta[betaBreachIdx].stableBps) + 22} textAnchor="middle" fontSize="10" fontWeight="700" fill={FAIL}>
              BREACH
            </text>
          </motion.g>
        )}

        <text x={padL} y={H - 8} fontSize="10" fill="rgba(244,246,250,0.35)">start</text>
        <text x={W - padR} y={H - 8} textAnchor="end" fontSize="10" fill="rgba(244,246,250,0.35)">now</text>
      </svg>

      <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-2 px-1 text-sm">
        <span className="flex items-center gap-2">
          <span className="h-0.5 w-5 rounded" style={{ background: ACCENT }} /> Alpha — stayed disciplined
        </span>
        <span className="flex items-center gap-2">
          <span className="h-0.5 w-5 rounded" style={{ background: FAIL }} /> Beta — chased risk
        </span>
        <span className="flex items-center gap-2 text-faint">
          <span className="h-0.5 w-5 rounded border-t border-dashed" style={{ borderColor: FAIL }} /> The rule they agreed to
        </span>
      </div>
    </div>
  );
}
