# Shopify Forms exporter

## Audit-proposed safeguards — pending review

- Preserve one installable runtime and its read-only, same-origin boundary. Do not add telemetry, remote storage, writes or broad token scope.
- The internal GraphQL endpoint and Shopify DOM are not validated by public API schemas. Report fixture proof separately from live compatibility.
- A submission-page failure must not download a partial CSV. Preserve unresolved file IDs and warnings.
- Verify the actual iframe source/origin and cancel stale requests on form/store changes. Keep formula safety and CSV escaping.
- Run syntax and actual-script jsdom tests on final source. State if dependencies or live acceptance are unavailable.
- Keep changes scoped and reviewed. Do not include customer data or session headers in test artifacts, commits or reports.
