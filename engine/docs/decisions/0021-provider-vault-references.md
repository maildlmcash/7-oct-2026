# 0021 — Provider vault references

Status: accepted for secret-manager references on the provider registry.

## Context

TASK 06.A.02 asks the registry to store secret-manager references and permission scopes. Read-only market-data configuration must stay separate from order-capable credentials. Serialization, UI, logs, and audit exports must not reveal secret values.

Decision 0020 stores versioned provider records and does not store a secret value. Design section 3 names a secret vault reference, a credential scope, and withdrawals that stay closed. Design page 15 forbids password, OTP, API secret, private key, seed phrase, and access token in logs. The source names no secret-manager product and no vault URL scheme. The shell has no provider screen.

## Decision

`services/provider-registry.mjs` accepts two credential objects. `marketData` stores a vault reference and the scope `read-only`. `orders` stores a different vault reference and the scope `order-capable`. Any other scope is rejected. The same reference cannot be used for both. `withdrawals` stays false. A secret-named field is not copied. A vault reference, stored text, reason, or audit row that contains a secret value, a bearer token, a private key, or a seed phrase is rejected and writes no audit.

`authorizeProviderUse` allows `market-data` only through the read-only credential. It rejects orders against a market-data-only record. It rejects withdrawals. `providerExports` returns the serialization, the display text, the log, and the audit JSON. Those four surfaces include the vault reference and exclude secret values. `data/migrations/0009_provider_vault_references.sql` stores the same columns and checks. The service does not open a connection and does not read live trading flags. Decision 0022 adds Test Connection, Fetch Once, and Auto Start on this registry.

## Evidence

`pnpm test:provider-registry` covers a rejected order scope on market data, a shared reference, closed withdrawals, a secret field that is not stored, separate read-only and order use, and export text that contains the vault reference and not the secret value.
