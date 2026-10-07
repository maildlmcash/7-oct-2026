export {
  AUDIT_FIELDS,
  DEPLOYMENT,
  KEY_PERMISSION_CHECKS,
  PERMISSION_SCOPES,
  describeSecretPath,
  listReferences,
  materialKeys,
  readReference,
  retrieveMaterial,
  revokeReference,
  rotateReference,
  submitSecretMaterial,
} from "./secret-reference.mjs";
export type { CheckRow, ReferenceRecord, ScopeRow } from "./secret-reference.mjs";
