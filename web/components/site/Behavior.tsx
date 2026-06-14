"use client";

import { Section, Reveal } from "./Reveal";
import { ComparisonChart } from "./ComparisonChart";
import { worstStableBps, type AgentNarrative } from "@/lib/narrative";

export function Behavior({ alpha, beta }: { alpha: AgentNarrative; beta: AgentNarrative }) {
  const floorBps = alpha.policy.minStableBps || 8000;
  const betaWorst = worstStableBps(beta.points);

  return (
    <Section
      id="behavior"
      index="02"
      eyebrow="What actually happened"
      title="One stayed inside the line. One didn't."
      lede="Both agents agreed to keep at least 80% of the treasury in stable assets. Here is every move they made, against that one promise."
    >
      <Reveal>
        <ComparisonChart alpha={alpha.points} beta={beta.points} floorBps={floorBps} />
      </Reveal>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Reveal delay={0.05}>
          <div className="surface h-full p-5" style={{ borderColor: "rgba(52,211,153,0.22)" }}>
            <div className="text-sm font-semibold text-accent">Agent Alpha</div>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              Held the line on every single move. The treasury stayed safe — and the promise stayed
              kept.
            </p>
          </div>
        </Reveal>
        <Reveal delay={0.12}>
          <div className="surface h-full p-5" style={{ borderColor: "rgba(251,113,133,0.22)" }}>
            <div className="text-sm font-semibold text-fail">Agent Beta</div>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              Drifted past the line, dropping to{" "}
              <span className="text-fail">{(betaWorst / 100).toFixed(0)}% stable</span> — well below
              the floor. The promise was broken.
            </p>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}
