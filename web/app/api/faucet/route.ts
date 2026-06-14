import { NextResponse } from "next/server";
import { parseEther, isAddress } from "viem";
import { serverClients } from "@/lib/serverChain";

// Demo faucet: drips a little native gas + stake to a freshly created Privy wallet
// so a judge can sponsor an agent without first hunting for testnet ETH. Capped,
// and a no-op once the wallet already holds enough. Funded from the operator
// wallet (rich Hardhat account locally; a pre-funded EOA on Base Sepolia).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DRIP = parseEther("0.03"); // covers 0.01 stake + level-up + gas headroom
const TOPUP_BELOW = parseEther("0.02");

export async function POST(req: Request) {
  try {
    const { address } = (await req.json()) as { address: string };
    if (!address || !isAddress(address)) {
      return NextResponse.json({ error: "invalid address" }, { status: 400 });
    }

    const { publicClient, wallet } = await serverClients();
    const account = wallet.account!;

    const balance = await publicClient.getBalance({ address: address as `0x${string}` });
    if (balance >= TOPUP_BELOW) {
      return NextResponse.json({ funded: false, reason: "already funded", balance: balance.toString() });
    }

    const opBalance = await publicClient.getBalance({ address: account.address });
    if (opBalance < DRIP) {
      return NextResponse.json(
        { error: "faucet empty — fund the operator wallet on this chain" },
        { status: 503 }
      );
    }

    const hash = await wallet.sendTransaction({
      account,
      chain: wallet.chain,
      to: address as `0x${string}`,
      value: DRIP,
    });
    await publicClient.waitForTransactionReceipt({ hash });
    return NextResponse.json({ funded: true, txHash: hash });
  } catch (e: any) {
    return NextResponse.json({ error: e?.shortMessage ?? e?.message ?? "faucet failed" }, { status: 500 });
  }
}
