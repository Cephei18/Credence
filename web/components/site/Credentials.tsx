"use client";

import { FlaskConical, ShieldCheck, Landmark, Check, X, Minus } from "lucide-react";
import { Section, Reveal } from "./Reveal";
import { CREDENTIAL_DEFS, stateName, type AgentNarrative } from "@/lib/narrative";

const ICONS = { research: FlaskConical, risk: ShieldCheck, treasury: Landmark } as const;

function StatusDot({ state }: { state: "earned" | "denied" | "pending" | "none" }) {
  if (state === "earned")
    return (
      <span className="pill pill-pass">
        <Check size={12} /> earned
      </span>
    );
  if (state === "denied")
    return (
      <span className="pill pill-fail">
        <X size={12} /> denied
      </span>
    );
  return (
    <span className="pill text-faint">
      <Minus size={12} /> {state === "pending" ? "pending" : "not earned"}
    </span>
  );
}

export function Credentials({ alpha, beta }: { alpha: AgentNarrative; beta: AgentNarrative }) {
  return (
    <Section
      id="credentials"
      index="04"
      eyebrow="Credentials"
      title="Verified behavior becomes a credential."
      lede="Each passing verdict earns the agent a credential. Three of them, each meaning something a person can actually understand."
    >
      <div className="space-y-3">
        {CREDENTIAL_DEFS.map((c, i) => {
          const Icon = ICONS[c.key];
          const aState = stateName(alpha.snap.states[c.idx]);
          const bState = stateName(beta.snap.states[c.idx]);
          return (
            <Reveal key={c.key} delay={i * 0.07}>
              <div className="surface flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
                <div className="flex flex-1 items-start gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--surface-2)] text-accent">
                    <Icon size={18} />
                  </span>
                  <div>
                    <div className="text-base font-semibold">{c.label}</div>
                    <div className="mt-0.5 text-sm leading-relaxed text-muted">{c.line}</div>
                  </div>
                </div>
                <div className="flex items-center gap-6 sm:gap-8">
                  <div className="flex flex-col items-start gap-1.5">
                    <span className="text-xs text-faint">Alpha</span>
                    <StatusDot state={aState} />
                  </div>
                  <div className="flex flex-col items-start gap-1.5">
                    <span className="text-xs text-faint">Beta</span>
                    <StatusDot state={bState} />
                  </div>
                </div>
              </div>
            </Reveal>
          );
        })}
      </div>
    </Section>
  );
}
