# Roadmap

## Phase 1 — Protocol design ✅
- Thesis, rights model, threat model — [WHITEPAPER.md](WHITEPAPER.md)
- Architecture + layer diagram — [ARCHITECTURE.md](ARCHITECTURE.md)
- Contract interfaces + spec — [SMART_CONTRACT_SPEC.md](SMART_CONTRACT_SPEC.md)

## Phase 2 — MVP contracts ✅
- `AgentPassport.sol`: principal stake, level/rights model, soulbound credential, decay, slashing, pause/revoke
- `PassportNameRegistry.sol`: soulbound ENS-style subnames
- `IOutcomeVerifier` + `MockOutcomeVerifier`
- 12 passing tests covering progression **and** attack cases

## Phase 3 — Privy integration ✅ (frontend)
- Founder auth (email / wallet / Google) + embedded wallets
- Principal registration & agent authorization flows
- Reactive passport UI

## Phase 4 — Chainlink verification ✅ (prod path) / 🔄 (live)
- `ChainlinkFunctionsVerifier` against the Functions DON
- 🔄 Deploy verifier on Base Sepolia, fund a subscription, ship the audited JS source for the demo task ("ETH up over 24h" via price feed)

## Phase 5 — ENS passport issuance 🔄
- Demo registry issues soulbound subnames today
- 🔄 Front with an ENS L2 resolver (Durin) on Base, or a mainnet NameWrapper-controlled `agentpassport.eth`, so passports resolve in any ENS-aware client

## Phase 6 — Demo UX ✅ / 🔄 polish
- 8-step guided flow with live credential card + activity log
- 🔄 Passport explorer (browse any agent's credential), level-up animations, multi-agent view

## Beyond the hackathon
- **Multi-verifier quorum + dispute window** — remove the single-verifier trust root
- **Outcome taxonomy** — a schema of verifiable outcome types beyond price prediction
- **Safe module / session-key enforcement** — make the chokepoint physically unavoidable for agent funds
- **ZK selective disclosure** — prove "level ≥ N" without revealing full history
- **Cross-protocol credential standard** — let other protocols read & trust Agent Passport directly
- **Insurance / underwriting** — price agent risk off the on-chain credential
- **Audit** before any mainnet/value deployment

Legend: ✅ done in this build · 🔄 in progress / next
