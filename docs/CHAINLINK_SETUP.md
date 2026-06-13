# Chainlink Functions — Base Sepolia Setup (Commit 5)

Goes live with the DON-powered verification path. Local mock + offline simulator
remain as fallbacks — nothing is removed.

## Audited config (verify against docs.chain.link before mainnet-anything)

| Value | Setting | Notes |
|---|---|---|
| Functions router | `0xf9B8fc078197181C841c296C876945aaa425B278` | Base Sepolia |
| DON id | `fun-base-sepolia-1` | encoded to `bytes32` by the deploy script via `encodeBytes32String` |
| Callback gas limit | `300000` | **router max on Base Sepolia** — see "Gas note" below |
| LINK (funding) | `0xE4aB69C077896252FAFBD49EFD26B5D171A32410` | fund the subscription with this |
| Subscription id | _you create it_ | `FUNCTIONS_SUBSCRIPTION_ID` |

> Always confirm the router/DON/LINK values on the official
> [supported networks page](https://docs.chain.link/chainlink-functions/supported-networks) —
> they can change and must not be trusted from memory.

## Deployment sequence

```
# 0. env: DEPLOYER_PRIVATE_KEY funded on Base Sepolia; FUNCTIONS_* set
# 1. core contracts (also deploys MockOutcomeVerifier fallback)
npm --workspace contracts run deploy:baseSepolia
#    -> copy AgentPassport address into contracts/.env  PASSPORT_ADDRESS=0x...

# 2. create a Functions subscription (dashboard, step below) -> FUNCTIONS_SUBSCRIPTION_ID=...

# 3. deploy the verifier, set source.js, switch AgentPassport onto it
npm --workspace contracts run deploy:chainlink
#    -> note the printed ChainlinkFunctionsVerifier address

# 4. add that verifier as a CONSUMER + fund the subscription (dashboard)

# 5. one real verification end-to-end
npm --workspace contracts run smoke:chainlink
```

## Required dashboard actions (https://functions.chain.link, Base Sepolia)
1. **Create subscription** → record the numeric id → `FUNCTIONS_SUBSCRIPTION_ID`.
2. After `deploy:chainlink`, **Add consumer** = the printed `ChainlinkFunctionsVerifier` address.
3. **Fund** the subscription with LINK (see amounts below).

## Required wallet actions
- Deployer wallet (`DEPLOYER_PRIVATE_KEY`) must hold **Base Sepolia ETH** (gas for deploy + the `requestTypedVerification` tx). Faucet: a Base Sepolia ETH faucet.
- The same wallet is the AgentPassport **owner** (so `setVerifier` succeeds) and the subscription **admin**.

## Subscription funding requirements
- Fund with **testnet LINK** (Base Sepolia LINK faucet). A few LINK (e.g. **2–5 LINK**) comfortably covers many demo requests; each Functions request consumes a small amount of LINK for DON compute + the callback.
- Keep a buffer — an underfunded subscription causes requests to silently not fulfill.

## Gas note (important)
`fulfillVerification` runs `recordVerification` + `evaluateFromAttestation` (success) or `reportViolation`+revoke loop (failure). The **success path** (Research smoke test) is light and fits within the 300k cap. The **failure path** loops the 6 credential types and is heavier — if a real failing verification ever reverts on out-of-gas in the callback, trim the callback work; do **not** raise above the router max. The smoke test uses a trivially-true Research claim to exercise the success path first.

## Smoke test — what to capture
`smoke:chainlink` registers a principal + agent, sends a Research `requestTypedVerification`, prints the **request tx hash** and **Chainlink requestId**, then polls the CredentialRegistry until the DON callback records the attestation. Record:
- request tx hash
- Chainlink requestId
- fulfillment tx (from the Functions dashboard / Basescan on the verifier)
- callback gas used
- `verificationCount(agentId)` → 1 (attestation recorded ✓)

## Rollback / fallback
- To revert to the mock: `passport.setVerifier(<MockOutcomeVerifier>)` (owner tx) → the local `resolve` flow works again.
- The offline simulator (`npm run simulate`) is unaffected and always available for a no-network demo.
