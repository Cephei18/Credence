// CRE workflow boundary types for Credence.
//
// We model the CRE capabilities behind a small interface so the SAME verification
// handler runs (a) locally in simulation against mocked/real reads today, and
// (b) on the CRE DON in production via the @chainlink/cre-sdk adapter. This is
// the seam that lets us validate the workflow without gated CRE access.

/// Decoded CREReceiver.WorkflowTrigger event (the EVM-log trigger).
export type WorkflowTrigger = {
  requestId: string;
  agentId: bigint;
  attType: number; // AttestationType
  taskId: string;
  args: string[]; // innerArgs (NO category prefix — category comes from attType)
};

/// Minimal CRE capabilities the handler needs. In production these map to CRE's
/// HTTP capability and EVM read capability (consensus-aggregated); in simulation
/// they are backed by mocks (offline) or a real RPC (Base Sepolia).
export interface CRECapabilities {
  httpGetJson(url: string): Promise<any>;
  ethCall(to: string, data: string): Promise<string>; // returns hex result
  ethGetLogs(
    address: string,
    topic0: string,
    fromBlock: string,
    toBlock: string
  ): Promise<{ data: string }[]>;
}

/// Must match CredentialRegistry.CredentialType / AgentPassport.AttestationType.
export enum AttestationType {
  Research = 0,
  Treasury = 1,
  Prediction = 2,
  Execution = 3,
  Governance = 4,
  Risk = 5,
}
