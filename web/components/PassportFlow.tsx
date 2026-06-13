"use client";

import { useEffect, useMemo, useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useReadContract, useWriteContract, useAccount, useChainId } from "wagmi";
import { keccak256, parseEther, stringToHex, toHex } from "viem";
import { motion, AnimatePresence } from "framer-motion";
import { ShieldCheck, LogIn, Sparkles, Lock, CheckCircle2, Ban, ArrowUpCircle } from "lucide-react";
import {
  PASSPORT_ABI,
  PASSPORT_ADDRESS,
  REGISTRY_ABI,
  REGISTRY_ADDRESS,
} from "@/lib/contracts";
import { PassportCard, type Credential, type Rights } from "@/components/PassportCard";
import { short } from "@/lib/utils";

const TASK_ID = keccak256(stringToHex("predict-eth-up-24h"));

export default function PassportFlow() {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const { wallets } = useWallets();
  const { address } = useAccount();
  const chainId = useChainId();
  const { writeContractAsync, isPending } = useWriteContract();

  const [agentId, setAgentId] = useState<bigint | undefined>(undefined);
  const [log, setLog] = useState<string[]>([]);
  const [lastActionResult, setLastActionResult] = useState<null | "ok" | "blocked">(null);

  const agentWallet = wallets[0]?.address ?? address;

  const note = (m: string) => setLog((l) => [m, ...l].slice(0, 8));

  const configured =
    PASSPORT_ADDRESS !== "0x0000000000000000000000000000000000000000";

  // ---- live reads -------------------------------------------------------
  const { data: principal, refetch: refetchPrincipal } = useReadContract({
    address: PASSPORT_ADDRESS,
    abi: PASSPORT_ABI,
    functionName: "principals",
    args: address ? [address] : undefined,
    query: { enabled: !!address && configured },
  });

  const { data: credRaw, refetch: refetchCred } = useReadContract({
    address: PASSPORT_ADDRESS,
    abi: PASSPORT_ABI,
    functionName: "getCredential",
    args: agentId !== undefined ? [agentId] : undefined,
    query: { enabled: agentId !== undefined && configured },
  });

  const { data: rightsRaw, refetch: refetchRights } = useReadContract({
    address: PASSPORT_ADDRESS,
    abi: PASSPORT_ABI,
    functionName: "getRights",
    args: agentId !== undefined ? [agentId] : undefined,
    query: { enabled: agentId !== undefined && configured },
  });

  const { data: passportName, refetch: refetchName } = useReadContract({
    address: REGISTRY_ADDRESS,
    abi: REGISTRY_ABI,
    functionName: "nameOf",
    args: agentId !== undefined ? [agentId] : undefined,
    query: { enabled: agentId !== undefined && configured },
  });

  const cred: Credential | undefined = useMemo(() => {
    if (!credRaw) return undefined;
    const [level, verifiedCount, violations, live, hasPassport, spentInEpoch, spendLimit] =
      credRaw as readonly [number, bigint, bigint, boolean, boolean, bigint, bigint];
    return { level, verifiedCount, violations, live, hasPassport, spentInEpoch, spendLimit };
  }, [credRaw]);

  const rights = rightsRaw as Rights | undefined;
  const isRegistered = !!(principal as any)?.[0];

  const refetchAll = () => {
    refetchPrincipal();
    refetchCred();
    refetchRights();
    refetchName();
  };

  useEffect(() => {
    if (agentId !== undefined) refetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  // ---- actions ----------------------------------------------------------
  async function call(fn: () => Promise<`0x${string}`>, ok: string) {
    try {
      const hash = await fn();
      note(`${ok}  (${short(hash)})`);
      setTimeout(refetchAll, 1500);
    } catch (e: any) {
      note(`✗ ${e?.shortMessage ?? e?.message ?? "reverted"}`);
      throw e;
    }
  }

  const registerPrincipal = () =>
    call(
      () =>
        writeContractAsync({
          address: PASSPORT_ADDRESS,
          abi: PASSPORT_ABI,
          functionName: "registerPrincipal",
          value: parseEther("0.2"),
        }),
      "Principal registered with 0.2 ETH stake"
    );

  const createAgent = async () => {
    if (!agentWallet) return;
    // Optimistically claim the next id by reading current; in practice we parse
    // the receipt. For the demo we assume sequential ids starting at 1.
    await call(
      () =>
        writeContractAsync({
          address: PASSPORT_ADDRESS,
          abi: PASSPORT_ABI,
          functionName: "registerAgent",
          args: [agentWallet as `0x${string}`],
        }),
      "Agent authorized at Level 0 (Unverified)"
    );
    setAgentId((id) => (id === undefined ? 1n : id + 1n));
  };

  const attempt = (amountEth: string) => async () => {
    if (agentId === undefined) return;
    try {
      await writeContractAsync({
        address: PASSPORT_ADDRESS,
        abi: PASSPORT_ABI,
        functionName: "attemptAction",
        args: [agentId, parseEther(amountEth)],
      });
      setLastActionResult("ok");
      note(`✓ Action for ${amountEth} ETH ALLOWED by passport`);
      setTimeout(refetchAll, 1500);
    } catch (e: any) {
      setLastActionResult("blocked");
      note(`⛔ Action for ${amountEth} ETH BLOCKED — outside delegation envelope`);
    }
  };

  const requestVerification = () =>
    call(
      () =>
        writeContractAsync({
          address: PASSPORT_ADDRESS,
          abi: PASSPORT_ABI,
          functionName: "requestVerification",
          args: [agentId!, TASK_ID, toHex(new Uint8Array())],
        }),
      "Verification requested → Chainlink resolves outcome"
    );

  const levelUp = () =>
    call(
      () =>
        writeContractAsync({
          address: PASSPORT_ADDRESS,
          abi: PASSPORT_ABI,
          functionName: "levelUp",
          args: [agentId!],
        }),
      "Agent leveled up — delegation envelope expanded"
    );

  const issuePassport = () =>
    call(
      () =>
        writeContractAsync({
          address: PASSPORT_ADDRESS,
          abi: PASSPORT_ABI,
          functionName: "issuePassport",
          args: [agentId!, "verified-research"],
        }),
      "ENS passport issued: verified-research.agentpassport.eth"
    );

  // ---- UI ----------------------------------------------------------------
  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-accent/20 text-accent">
            <ShieldCheck />
          </div>
          <div>
            <div className="text-lg font-semibold">Agent Passport</div>
            <div className="text-xs text-white/40">
              Earned authority for autonomous agents
            </div>
          </div>
        </div>
        {ready && authenticated ? (
          <div className="flex items-center gap-3 text-sm">
            <span className="pill border-edge text-white/60">
              {user?.email?.address ?? short(address)}
            </span>
            <button className="btn-ghost" onClick={logout}>
              Sign out
            </button>
          </div>
        ) : (
          <button className="btn-primary flex items-center gap-2" onClick={login} disabled={!ready}>
            <LogIn size={16} /> Founder login (Privy)
          </button>
        )}
      </header>

      {!configured && (
        <div className="mt-6 rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-warn">
          Contracts not configured. Deploy with{" "}
          <code>npm run deploy:local</code> and set <code>NEXT_PUBLIC_PASSPORT_ADDRESS</code> /{" "}
          <code>NEXT_PUBLIC_REGISTRY_ADDRESS</code> in <code>web/.env.local</code>.
        </div>
      )}

      <section className="mt-10 grid gap-8 lg:grid-cols-[1.1fr,0.9fr]">
        {/* LEFT: the flow */}
        <div className="space-y-4">
          <h2 className="text-sm uppercase tracking-widest text-white/40">
            The credential progression
          </h2>

          <Step
            n={1}
            title="Authenticate the founder"
            done={authenticated}
            desc="Privy answers the only question that matters for delegation: who authorized this agent? An embedded wallet is provisioned for the human principal."
          >
            {!authenticated && (
              <button className="btn-primary" onClick={login} disabled={!ready}>
                Login
              </button>
            )}
          </Step>

          <Step
            n={2}
            title="Stake as a principal"
            done={isRegistered}
            desc="Rights are anchored to a staked human/org, not the agent — this is the Sybil & liability anchor. Stake is slashable on violations."
            disabled={!authenticated}
          >
            {authenticated && !isRegistered && (
              <button className="btn-primary" onClick={registerPrincipal} disabled={isPending}>
                Stake 0.2 ETH & register
              </button>
            )}
          </Step>

          <Step
            n={3}
            title="Create an agent (Level 0)"
            done={agentId !== undefined}
            desc="The agent begins Unverified: a tiny 0.0005 ETH/epoch envelope, no delegation, no treasury. Authority is earned, not granted."
            disabled={!isRegistered}
          >
            {isRegistered && (
              <button className="btn-primary" onClick={createAgent} disabled={isPending}>
                Authorize new agent
              </button>
            )}
          </Step>

          <Step
            n={4}
            title="Attempt a restricted action → blocked"
            done={lastActionResult === "blocked"}
            desc="The passport is an enforcement chokepoint. A 0.05 ETH action exceeds the Level 0 envelope and reverts on-chain."
            disabled={agentId === undefined}
          >
            {agentId !== undefined && (
              <div className="flex items-center gap-3">
                <button className="btn-ghost" onClick={attempt("0.05")}>
                  Attempt 0.05 ETH action
                </button>
                <ResultPill r={lastActionResult} />
              </div>
            )}
          </Step>

          <Step
            n={5}
            title="Verify an outcome (Chainlink)"
            done={(cred?.verifiedCount ?? 0n) > 0n}
            desc="The agent cannot self-report. Chainlink resolves a claim (e.g. 'ETH up over 24h') against an independent price feed. In the local demo the mock verifier is resolved by the operator script."
            disabled={agentId === undefined}
          >
            {agentId !== undefined && (
              <div className="flex flex-col gap-2">
                <button className="btn-ghost" onClick={requestVerification} disabled={isPending}>
                  Request verification
                </button>
                <p className="text-xs text-white/40">
                  Then run <code>npm run resolve -- {agentId?.toString()} true</code> (local) or wait
                  for the DON callback (Base Sepolia).
                </p>
              </div>
            )}
          </Step>

          <Step
            n={6}
            title="Level up — rights expand"
            done={(cred?.level ?? 0) >= 1}
            desc="With a recent verified outcome and sufficient stake, the agent graduates. Credentials decay: a stale agent collapses back to the Level 0 envelope."
            disabled={(cred?.verifiedCount ?? 0n) === 0n}
          >
            {agentId !== undefined && (
              <button className="btn-primary" onClick={levelUp} disabled={isPending}>
                Level up
              </button>
            )}
          </Step>

          <Step
            n={7}
            title="Issue the ENS passport"
            done={!!cred?.hasPassport}
            desc="At Verified+, a soulbound, non-transferable ENS subname is minted — the portable credential layer. It cannot be sold or rented."
            disabled={(cred?.level ?? 0) < 1}
          >
            {agentId !== undefined && !cred?.hasPassport && (
              <button className="btn-primary" onClick={issuePassport} disabled={isPending}>
                Issue passport
              </button>
            )}
          </Step>

          <Step
            n={8}
            title="Retry the action → now allowed"
            done={lastActionResult === "ok" && (cred?.level ?? 0) >= 1}
            desc="The same action that was blocked at Level 0 now passes — authority expanded because behavior was verified."
            disabled={(cred?.level ?? 0) < 1}
          >
            {agentId !== undefined && (
              <div className="flex items-center gap-3">
                <button className="btn-primary" onClick={attempt("0.02")}>
                  Retry 0.02 ETH action
                </button>
                <ResultPill r={lastActionResult} />
              </div>
            )}
          </Step>
        </div>

        {/* RIGHT: live passport + log */}
        <div className="space-y-4 lg:sticky lg:top-10 self-start">
          <PassportCard
            agentId={agentId}
            wallet={agentWallet}
            passportName={(passportName as string) || undefined}
            cred={cred}
            rights={rights}
          />
          <div className="card">
            <div className="mb-2 flex items-center gap-2 text-sm text-white/50">
              <Sparkles size={14} /> Activity
            </div>
            <div className="space-y-1.5 text-xs">
              <AnimatePresence>
                {log.length === 0 && (
                  <div className="text-white/30">No actions yet — start the flow.</div>
                )}
                {log.map((l, i) => (
                  <motion.div
                    key={l + i}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="rounded-md bg-black/30 px-2 py-1 text-white/70"
                  >
                    {l}
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

function Step({
  n,
  title,
  desc,
  done,
  disabled,
  children,
}: {
  n: number;
  title: string;
  desc: string;
  done?: boolean;
  disabled?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <motion.div
      layout
      className={`card transition ${disabled ? "opacity-40" : ""}`}
      style={{ borderColor: done ? "#34d39955" : undefined }}
    >
      <div className="flex items-start gap-3">
        <div
          className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-semibold"
          style={{
            background: done ? "#34d39922" : "#ffffff0d",
            color: done ? "#34d399" : "#fff",
          }}
        >
          {done ? <CheckCircle2 size={16} /> : n}
        </div>
        <div className="flex-1">
          <div className="font-medium">{title}</div>
          <div className="mt-1 text-sm text-white/50">{desc}</div>
          {children && <div className="mt-3">{children}</div>}
        </div>
      </div>
    </motion.div>
  );
}

function ResultPill({ r }: { r: null | "ok" | "blocked" }) {
  if (!r) return null;
  return r === "ok" ? (
    <span className="pill border-good/50 bg-good/10 text-good">
      <CheckCircle2 size={14} /> allowed
    </span>
  ) : (
    <span className="pill border-bad/50 bg-bad/10 text-bad">
      <Ban size={14} /> blocked
    </span>
  );
}
