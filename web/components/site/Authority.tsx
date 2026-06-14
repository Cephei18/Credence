"use client";

import { motion } from "framer-motion";
import { Check, Lock, ArrowRight } from "lucide-react";
import { Section, Reveal } from "./Reveal";
import { fmtUsd, TREASURY_TIER_LABEL } from "@/lib/credence";
import type { AgentNarrative } from "@/lib/narrative";

function AuthorityCard({ data, delay }: { data: AgentNarrative; delay: number }) {
  const granted = data.snap.tier > 0;
  const color = granted ? "var(--accent)" : "var(--fail)";
  const cap = data.snap.tierCap;
  const headline = granted
    ? cap > 0n
      ? `Can move up to ${fmtUsd(cap)}`
      : "Cleared to operate"
    : "Cannot move any value";

  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.55, delay, ease: [0.22, 1, 0.36, 1] }}
      className="surface relative overflow-hidden p-6"
      style={{ borderColor: granted ? "rgba(52,211,153,0.28)" : "rgba(251,113,133,0.28)" }}
    >
      <div className="absolute -right-14 -top-14 h-36 w-36 rounded-full opacity-[0.16] blur-2xl" style={{ background: color }} />
      <div className="flex items-center justify-between">
        <div>
          <div className="text-lg font-semibold tracking-tight">{data.agent.name}</div>
          <div className="mt-0.5 text-sm" style={{ color }}>
            {granted ? "Authority granted" : "Authority denied"}
          </div>
        </div>
        <span className="grid h-9 w-9 place-items-center rounded-full" style={{ background: granted ? "var(--accent-dim)" : "var(--fail-dim)", color }}>
          {granted ? <Check size={18} /> : <Lock size={16} />}
        </span>
      </div>

      <div className="mt-6 text-2xl font-semibold tracking-tight" style={{ color }}>
        {headline}
      </div>
      <div className="mt-1 text-sm text-faint">
        Tier {data.snap.tier} · {TREASURY_TIER_LABEL[data.snap.tier]}
      </div>

      {/* tier ladder */}
      <div className="mt-5 flex items-center gap-1.5">
        {[0, 1, 2, 3].map((t) => (
          <div
            key={t}
            className="h-1.5 flex-1 rounded-full"
            style={{ background: t <= data.snap.tier && granted ? color : "rgba(255,255,255,0.08)" }}
          />
        ))}
      </div>

      <p className="mt-5 text-sm leading-relaxed text-muted">
        {granted
          ? "Because its behavior passed independent verification, Alpha earned the credentials that unlock real treasury execution."
          : "Beta broke the rule it agreed to. Verification failed, the credential was denied, and the protocol blocks it from touching value — by default."}
      </p>
    </motion.div>
  );
}

export function Authority({ alpha, beta }: { alpha: AgentNarrative; beta: AgentNarrative }) {
  return (
    <Section
      id="authority"
      index="05"
      eyebrow="Authority"
      title="Authority is the outcome — never the assumption."
      lede="Same treasury, same rules, same opportunity. The only difference was behavior, and behavior is the only thing Credence rewards."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <AuthorityCard data={alpha} delay={0} />
        <AuthorityCard data={beta} delay={0.12} />
      </div>

      <Reveal delay={0.2}>
        <div className="surface mt-6 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 p-5 text-center text-sm">
          {["Behavior", "Verification", "Credential", "Authority"].map((s, i, arr) => (
            <span key={s} className="flex items-center gap-3">
              <span className={i === arr.length - 1 ? "font-semibold text-accent" : "text-muted"}>{s}</span>
              {i < arr.length - 1 && <ArrowRight size={14} className="text-faint" />}
            </span>
          ))}
        </div>
      </Reveal>
    </Section>
  );
}
