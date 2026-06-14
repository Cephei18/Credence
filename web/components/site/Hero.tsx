"use client";

import { motion } from "framer-motion";
import { Check, X, ArrowDown } from "lucide-react";

function OutcomeCard({
  name,
  granted,
  delay,
}: {
  name: string;
  granted: boolean;
  delay: number;
}) {
  const color = granted ? "var(--accent)" : "var(--fail)";
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] }}
      className="surface relative flex-1 overflow-hidden p-6"
      style={{ borderColor: granted ? "rgba(52,211,153,0.28)" : "rgba(251,113,133,0.28)" }}
    >
      <div
        className="absolute -right-12 -top-12 h-32 w-32 rounded-full opacity-[0.18] blur-2xl"
        style={{ background: color }}
      />
      <div className="flex items-center justify-between">
        <span className="text-lg font-semibold tracking-tight">{name}</span>
        <span
          className="grid h-8 w-8 place-items-center rounded-full"
          style={{ background: granted ? "var(--accent-dim)" : "var(--fail-dim)", color }}
        >
          {granted ? <Check size={17} /> : <X size={17} />}
        </span>
      </div>
      <div className="mt-6 text-sm font-medium" style={{ color }}>
        {granted ? "Authority granted" : "Authority denied"}
      </div>
      <div className="mt-1 text-sm text-faint">
        {granted ? "Earned through verified behavior" : "Behavior breached the rules"}
      </div>
    </motion.div>
  );
}

export function Hero() {
  return (
    <section id="top" className="relative mx-auto max-w-narrative px-6 pb-8 pt-24 sm:pt-32">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      >
        <span className="pill pill-pass">The authority layer for AI agents</span>
        <h1 className="mt-6 max-w-3xl text-balance text-4xl font-semibold leading-[1.08] tracking-tight sm:text-6xl">
          AI agents shouldn&apos;t get treasury power
          <br className="hidden sm:block" /> because they have a wallet.
          <span className="text-accent"> They earn it through verified behavior.</span>
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted">
          Two agents. One treasury. The same rules. Watch how Credence decides which one is trusted
          to move real money — and why.
        </p>
      </motion.div>

      <div className="mt-12 flex flex-col gap-4 sm:flex-row">
        <OutcomeCard name="Agent Alpha" granted delay={0.18} />
        <OutcomeCard name="Agent Beta" granted={false} delay={0.3} />
      </div>

      <motion.a
        href="#experiment"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.7 }}
        className="mt-14 flex items-center justify-center gap-2 text-sm text-faint transition-colors hover:text-muted"
      >
        See how <ArrowDown size={14} className="animate-bounce" />
      </motion.a>
    </section>
  );
}
