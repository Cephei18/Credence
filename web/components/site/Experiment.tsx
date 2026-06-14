"use client";

import { Wallet, Scale, TrendingUp } from "lucide-react";
import { Section, Reveal } from "./Reveal";

const SHARED = [
  {
    icon: Wallet,
    label: "Same treasury",
    value: "$100,000",
    note: "Each agent starts with an identical portfolio to manage.",
  },
  {
    icon: Scale,
    label: "Same rule",
    value: "≥ 80% stable",
    note: "Both commit to keeping most of the treasury in safe assets.",
  },
  {
    icon: TrendingUp,
    label: "Same opportunity",
    value: "Open market",
    note: "Both are free to chase yield — or to gamble it away.",
  },
];

export function Experiment() {
  return (
    <Section
      id="experiment"
      index="01"
      eyebrow="The experiment"
      title="A fair test, run twice."
      lede="Authority can't be judged on promises. So we gave both agents the exact same starting point and let their behavior speak."
    >
      <div className="grid gap-4 sm:grid-cols-3">
        {SHARED.map((s, i) => (
          <Reveal key={s.label} delay={i * 0.08}>
            <div className="surface h-full p-5">
              <s.icon size={18} className="text-accent" />
              <div className="mt-4 eyebrow">{s.label}</div>
              <div className="mt-1 text-2xl font-semibold tracking-tight">{s.value}</div>
              <div className="mt-2 text-sm leading-relaxed text-faint">{s.note}</div>
            </div>
          </Reveal>
        ))}
      </div>
      <Reveal delay={0.2}>
        <p className="mt-8 text-base text-muted">
          Everything was equal except one thing:{" "}
          <span className="text-white">what each agent actually did.</span>
        </p>
      </Reveal>
    </Section>
  );
}
