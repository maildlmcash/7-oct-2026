export const DEPLOYMENT: {
  mode: "PAPER";
  liveTrading: "OFF";
  liveOrdersLocked: true;
  secretWrite: "not enabled";
  material: "not retrievable";
};

export const AUDIT_FIELDS: readonly ["actor", "action", "target", "decision", "reason"];

export type ScopeRow = { scope: string; state: string };
export type CheckRow = { id: string; text: string; state: string };

export const PERMISSION_SCOPES: readonly ScopeRow[];
export const KEY_PERMISSION_CHECKS: readonly CheckRow[];

export type ReferenceRecord = {
  id: string;
  tenantId: string;
  purpose: string;
  manager: string;
  kmsKey: string;
  reference: string;
  material: "masked";
  stored: false;
  rotation: string;
  revocation: string;
  liveTrading: "OFF";
  liveOrdersLocked: true;
};

export function listReferences(): ReferenceRecord[];
export function readReference(id: string): { ok: boolean; error: string | null; reference: ReferenceRecord | null };
export function retrieveMaterial(): { ok: false; error: "secret material is not retrievable"; material: null };
export function describeSecretPath(): {
  mode: "PAPER";
  manager: string;
  kmsKey: string;
  referenceShape: string;
  write: string;
  read: string;
  rotation: string;
  revocation: string;
  audit: readonly string[];
  scopes: readonly ScopeRow[];
};
export function submitSecretMaterial(input: {
  actor?: { role?: string; tenantId?: string };
  referenceId?: string;
  material?: string;
  log?: unknown[];
  telemetry?: unknown[];
}): { ok: false; error: string; reference: ReferenceRecord | null };
export function rotateReference(input: {
  actor?: { role?: string; tenantId?: string };
  referenceId?: string;
  material?: string;
  log?: unknown[];
  telemetry?: unknown[];
}): { ok: false; error: string; reference: null };
export function revokeReference(input: {
  actor?: { role?: string; tenantId?: string };
  referenceId?: string;
  material?: string;
  log?: unknown[];
  telemetry?: unknown[];
}): { ok: boolean; error: string | null; reference: ReferenceRecord | null };
export function materialKeys(): string[];
