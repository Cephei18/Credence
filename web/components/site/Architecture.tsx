"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Boxes } from "lucide-react";
import { Reveal } from "./Reveal";
import type { Narrative } from "@/lib/narrative";

const PIECES = [
  {
    name: "AgentPassport",
    desc: "ERC-style identity + the rights chokepoint. Every value-bearing action checks credential-derived authority here before it can execute.",
  },
  {
    name: "CredentialEngine",
    desc: "Stores typed attestations and violations, and derives credential state and treasury tier from a threshold of an agent's own verified outcomes.",
  },
  {
    name: "CREReceiver",
    desc: "The only address allowed to write verdicts. It accepts results from the Chainlink CRE workflow sender and updates the engine.",
  },
  {
    name: "Chainlink CRE workflow",
    desc: "Off-chain, decentralized verification. Replays the agent's on-chain trajectory against the committed policy and returns a tamper-proof PASS/FAIL.",
  },
];

function Addr({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="flex items-center justify-between gap-3 border-t border-[var(--border)] py-2 text-xs">
      <span className="text-faint">{label}</span>
      <code className="mono">{value}</code>
    </div>
  );
}

export function Architecture({ narrative }: { narrative: Narrative }) {
  const [open, setOpen] = useState(false);
  const c = narrative.demo?.contracts;

  return (
    <section id="architecture" className="mx-auto max-w-narrative px-6 pb-28 pt-4">
      <Reveal>
        <button
          onClick={() => setOpen((v) => !v)}
          className="surface flex w-full items-center justify-between gap-4 p-5 text-left transition-colors hover:bg-white/[0.03]"
        >
          <span className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--surface-2)] text-muted">
              <Boxes size={17} />
            </span>
            <span>
              <span className="block text-sm font-semibold">Protocol architecture</span>
              <span className="block text-xs text-faint">For technical judges — contracts, the CRE flow, and the chokepoint design.</span>
            </span>
          </span>
          <motion.span animate={{ rotate: open ? 180 : 0 }} className="text-faint">
            <ChevronDown size={18} />
          </motion.span>
        </button>
      </Reveal>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {PIECES.map((p) => (
                <div key={p.name} className="surface p-5">
                  <div className="mono text-sm font-semibold text-accent">{p.name}</div>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{p.desc}</p>
                </div>
              ))}
            </div>

            {c && (
              <div className="surface mt-4 p-5">
                <div className="eyebrow mb-1">Deployed contracts</div>
                <Addr label="AgentPassport" value={c.passport} />
                <Addr label="CredentialEngine" value={c.engine} />
                <Addr label="CREReceiver" value={c.creReceiver} />
                <Addr label="Registry" value={c.registry} />
                <Addr label="Price feed" value={c.feed} />
              </div>
            )}

            <div className="surface mt-4 p-5 text-sm leading-relaxed text-muted">
              <span className="font-semibold text-white">Why it&apos;s safe by default:</span> authority
              is never granted by holding a wallet. An agent can only move value if the engine derives
              a sufficient treasury tier from its verified credentials — and credentials only advance
              on independent Chainlink verdicts written through the single CREReceiver chokepoint.
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <Reveal>
        <footer className="mt-20 flex flex-col items-center gap-2 border-t border-[var(--border)] pt-10 text-center">
          <div className="text-sm font-semibold">Credence</div>
          <p className="max-w-md text-sm text-faint">
            Identity shouldn&apos;t grant authority. Behavior earns it. Verified by Chainlink CRE,
            secured by Privy.
          </p>
        </footer>
      </Reveal>
    </section>
  );
}
