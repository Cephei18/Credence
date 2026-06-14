"use client";

import { CheckCircle2, XCircle, AlertTriangle, Award } from "lucide-react";
import { CREDENTIAL_TYPES, type Attestation, type Violation } from "@/lib/credence";

type Row =
  | { kind: "attestation"; ts: number; data: Attestation }
  | { kind: "violation"; ts: number; data: Violation };

function attestationConsequence(cat: string, outcome: boolean) {
  if (!outcome) return "Consequence: credential denied and a violation is recorded.";
  if (cat === "Research") return "Consequence: counts toward the Research credential.";
  if (cat === "Risk") return "Consequence: unlocks the Risk credential and simulation-tier treasury authority.";
  if (cat === "Treasury") return "Consequence: unlocks value-bearing treasury execution.";
  return "Consequence: strengthens the matching credential type.";
}

export function CredentialTimeline({ attestations, violations }: { attestations: Attestation[]; violations: Violation[] }) {
  const rows: Row[] = [
    ...attestations.map((a) => ({ kind: "attestation" as const, ts: Number(a.timestamp), data: a })),
    ...violations.map((v) => ({ kind: "violation" as const, ts: Number(v.timestamp), data: v })),
  ].sort((a, b) => a.ts - b.ts);

  return (
    <div className="card">
      <div className="mb-1 text-sm uppercase tracking-widest text-white/40">3 · Credentials — verification timeline</div>
      <p className="mb-3 text-xs text-white/40">Verified behavior -&gt; typed attestation -&gt; credential state -&gt; authority. Every credential traces to outcomes.</p>

      {rows.length === 0 && <div className="text-sm text-white/30">No verification activity yet.</div>}

      <div className="relative space-y-3 pl-4">
        <div className="absolute left-1 top-1 bottom-1 w-px bg-edge" />
        {rows.map((r, i) => {
          if (r.kind === "attestation") {
            const a = r.data;
            const cat = CREDENTIAL_TYPES[a.vType] ?? `type ${a.vType}`;
            const consequence = attestationConsequence(cat, a.outcome);
            return (
              <div key={i} className="relative">
                <div className="absolute -left-[13px] top-1.5 h-2.5 w-2.5 rounded-full" style={{ background: a.outcome ? "#34d399" : "#f87171" }} />
                <div className="flex items-center gap-2 text-sm">
                  {a.outcome ? <CheckCircle2 size={15} className="text-good" /> : <XCircle size={15} className="text-bad" />}
                  <span className="font-medium">{cat} attestation</span>
                  <span className={a.outcome ? "text-good" : "text-bad"}>{a.outcome ? "verified" : "failed"}</span>
                </div>
                <div className="text-xs text-white/40">
                  impact {a.credentialImpact > 0 ? "+" : ""}{a.credentialImpact} · source {a.verifierSource.slice(0, 8)}…
                </div>
                <div className="text-xs text-white/50">{consequence}</div>
              </div>
            );
          }
          const v = r.data;
          return (
            <div key={i} className="relative">
              <div className="absolute -left-[13px] top-1.5 h-2.5 w-2.5 rounded-full bg-bad" />
              <div className="flex items-center gap-2 text-sm text-bad">
                <AlertTriangle size={15} /> <span className="font-medium">Violation (sev {v.severity})</span>
              </div>
              <div className="text-xs text-white/40">
                {v.reason}. Consequence: active credentials suspended and treasury authority withheld.
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex items-center gap-2 rounded-lg border border-edge bg-black/20 px-3 py-2 text-xs text-white/50">
        <Award size={14} className="text-accent" /> Credentials are earned only from a threshold of their own typed attestations.
      </div>
    </div>
  );
}
