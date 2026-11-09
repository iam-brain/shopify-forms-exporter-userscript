# ADR-001 — read-only Forms export userscript

Status: proposed retrospective. Existing source uses a browser userscript and current Shopify Admin session to query an internal endpoint; README openly documents that unsupported dependency. Historical alternative-selection rationale is otherwise unknown.

Benefits: no server, secrets distribution or persistent submission store; quick staff-controlled export. Costs: private API and DOM compatibility, browser memory for full export and manual installation/update. Alternatives: supported native export or documented API path if available for required fields; a hosted exporter only if recurring business requirements justify credentials and operations. No claim that an equivalent supported public endpoint currently exists.

Retain the simple utility with fail-visible response checks and a dated live compatibility record. Do not add unattended retries or new write scope. Reversibility: disable or revert the script; source data is untouched. Verify full ID set, CSV safety, cancellation and warnings in synthetic tests and a scoped live read-only acceptance. This ADR does not authorize a live export or deployment change.
