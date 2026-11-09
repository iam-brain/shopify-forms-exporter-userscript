# Shopify Forms Exporter userscript

A single userscript that adds **Export submissions** to Shopify Admin. The button sits in the page header alongside Shopify's existing actions and downloads all submissions for the chosen form as an Excel-friendly CSV.

Adapted from [ozhehkovski/shopify_forms_exporter](https://github.com/ozhehkovski/shopify_forms_exporter), with its MIT license and attribution preserved. This is an independent, unofficial project.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/) in your browser. Enable userscript execution if your browser requests it.
2. **[Install the userscript](https://raw.githubusercontent.com/iam-brain/shopify-forms-exporter-userscript/main/shopify-forms-exporter.user.js)** and accept your manager's installation prompt.
3. Reload Shopify Admin, open **Forms**, and choose **Export submissions**.

If the install link displays source instead of an installation prompt, create a new script in your userscript manager, replace its contents with that file, and save it. The script needs page-context execution; its metadata requests this automatically. Allow it to run in the embedded `forms.shopifyapps.com` frame as well as Shopify Admin.

## Where the button appears

| Page | Behavior |
| --- | --- |
| Forms overview (`/apps/shopify-forms`) | Choose a form from the loaded list, then export. If the list has not loaded, open the desired form first. |
| Form details (`/apps/shopify-forms/forms/<id>`) | Export that form directly. |
| Submission/results entries (`/content/metaobjects/read-only/entries/app--<appId>--shopify-forms<formId>`) | Export that form directly. The equivalent route without `read-only` also works. |
| Other Admin pages | No button. |

The script follows Shopify's navigation without requiring a refresh and restores its button when Shopify rerenders a page. It uses Shopify's registered native button component when available, with a plain HTML button styled to match Polaris as a fallback. The embedded app uses the parent Admin header, so there is one export button per page.

Progress, errors, warnings, and completion messages appear inside the button. It stays disabled until the export finishes, then shows **N submissions exported** (with the actual count) and becomes clickable again. Repeating a successful export of the same form requires confirmation; Cancel keeps the completed state. This completion history stays in memory for the current page session and resets on reload.

**The export includes every submission for the chosen form.** Table filters, selected rows, date ranges, and the currently visible results page do not limit it. On the overview, the chooser contains form links currently rendered by the Forms app; open a form directly if it is not listed.

## CSV behavior

- Follows every pagination cursor; duplicate record IDs across pages are included once.
- Includes submission IDs, display names, timestamps, and every field encountered across all pages.
- Resolves uploaded file/image references to URLs, in batches of up to 250. If resolution fails, the original IDs remain and the button displays a warning. Files themselves are not downloaded.
- Preserves commas, quotation marks, line breaks, and Unicode, using UTF-8 with a byte-order mark for Excel.
- Prefixes spreadsheet-formula-like cells with an apostrophe. This includes values beginning with `=`, `+`, `-`, or `@`, such as international phone numbers. The apostrophe is present in the raw CSV.
- Reports API/session errors and stops if pagination fails to advance. It does not download a partial CSV when a submissions page fails.
- Cancels the export when navigation changes the active form/store. Failed requests can be retried by clicking the button again.

## Privacy and compatibility

The script makes read-only requests to Shopify using your existing signed-in Admin session. It needs no Admin API access token, server, build step, or extension-specific background process. Session tokens stay in memory. There is no telemetry, external collection service, or persistent submission storage; the downloaded CSV remains on your computer.

The script matches all `admin.shopify.com/store/*` routes so it can notice navigation into Forms from another Admin page and capture the session header early. Its second match permits a small helper inside `forms.shopifyapps.com` to relay form IDs and names to its actual Admin parent for the overview chooser. The helper does not export submissions or make Admin API calls. Normal script updates are fetched by your userscript manager from this GitHub repository.

Like the original extension, the exporter relies on Shopify's **undocumented internal Admin GraphQL endpoint**, including `allMetaobjects`. Shopify can change that endpoint or its page structure. Public Admin API schema validation cannot validate that internal submissions query. The separate file-resolution query validates against the public 2026-10 schema, which does not establish compatibility with the internal endpoint.

Use a current browser with `AbortSignal.any`, `AbortSignal.timeout`, and native HTML dialog support. Version 1.0.1 was installed and enabled in Edge with Tampermonkey 5.5.1. Its visible results-page header button and complete live CSV export were verified: exported IDs matched every entry across all results pages, file references resolved, and the downloaded CSV parsed without malformed rows. The Forms overview chooser and Violentmonkey installation are covered by metadata/fixtures but have not been verified live. This is a userscript, not a Shopify app or an official Shopify feature.

If the button is missing after an update, check that the script's toggle is enabled in Tampermonkey, then reload Admin. Version 1.0.1 fixes placement on Shopify's current internal page component, which manually assigns its content slots.

If you see **Session token unavailable**, reload Admin, wait for the form to load, and retry. Confirm your manager allows execution in the page context. A 401/403 means the session expired or the current staff account lacks access.

## Development

The installable `.user.js` is the complete runtime: no bundled dependencies or build output.

```sh
npm ci
npm run check
npm test
```

Node.js 24 or newer is recommended for development. Tests execute the actual userscript in jsdom and exercise button placement, navigation, pagination, errors, CSV escaping, file batches, session-header capture, and iframe message validation with synthetic data. They do not access a real store. CI runs the same checks.

## Product and architecture baseline

Status: proposed documentation baseline, prepared November 8, 2026 against `0e8b3f1fc49117ef06ee500fdbd9329c2216f646`. Existing behavior and proposed requirements are distinguished below; new requirements and the retrospective ADR remain subject to review.

### Product requirements

The user is authorized Shopify staff exporting one complete form for administrative use. Success means all available submission IDs are represented once, every encountered field is preserved, and the operator can see incomplete file-resolution warnings. Shopify remains authoritative. CSV is a local copy and contains personal information already accessible to the staff member; protect it under the business's approved data-handling policy. No retention period is invented here.

| ID | Requirement / acceptance | Status |
|---|---|---|
| FE-FR-001 | Export the selected form's full dataset, independent of table filters; compare all returned IDs across pages | Existing documented/source behavior |
| FE-FR-002 | Authenticate using current same-origin session only; no server or external data collection | Existing boundary |
| FE-FR-003 | Reject invalid/repeated pagination and never download a partial submission result after a page failure | Existing control |
| FE-FR-004 | Union fields, deduplicate submission IDs and preserve unresolved file IDs with warning | Existing control |
| FE-FR-005 | Quote CSV correctly, preserve Unicode and neutralize spreadsheet-formula-like cells | Existing control |
| FE-FR-006 | Cancel on active store/form change and ignore late responses | Existing control |
| FE-FR-007 | Verify iframe source/origin; helper only relays form identifiers/names | Existing control |
| FE-FR-008 | Record current live compatibility separately from synthetic tests and historical acceptance | Proposed operational requirement |

### As-is architecture and requirements

The installable user.js file is the entire runtime. A page-context helper observes supported Forms routes and current session headers. The authenticated Admin page queries the undocumented internal GraphQL endpoint, accumulates and validates submission pages, resolves file URLs, then creates a local browser Blob download. No database, scheduler or remote write exists.

FE-AR-001: keep this read-only, single-file and serverless-in-the-literal-sense utility unless a new business requirement justifies a change. FE-AR-002: provider errors, navigation and invalid response shape must fail visibly without partial submission output. FE-AR-003: synthetic tests execute the actual script; public API schema validation must not be presented as proof of internal API compatibility. FE-AR-004: reviewed final-source checks gate merge; installed version and current compatibility date are recorded. FE-AR-005: bound requests and file-resolution batches; measure real large-form memory use before adding complexity.

### Compatibility and recovery record

Record date, reviewed script SHA/version, browser/userscript manager, supported page types exercised, complete submission count/ID comparison, unresolved-file warning result and any limitation. Do not put tokens or submission contents in the record. On failure, keep source data unchanged, inspect the explicit error and use an owner-approved manual export process if one is available; no guessed query mutation or broad extra permissions. Rollback installs the previous reviewed script; it does not restore Shopify data.

An operational recovery target would require owner approval before this occasional administrative aid becomes a required automated dependency. No current outage was demonstrated during the audit.

### Evidence and decision record

This is a bounded source and fixture review, not a current live compatibility certification. See the [internal query and pagination checks](https://github.com/iam-brain/shopify-forms-exporter-userscript/blob/0e8b3f1fc49117ef06ee500fdbd9329c2216f646/shopify-forms-exporter.user.js#L264-L297), [CSV and file-resolution controls](https://github.com/iam-brain/shopify-forms-exporter-userscript/blob/0e8b3f1fc49117ef06ee500fdbd9329c2216f646/shopify-forms-exporter.user.js#L306-L369), and the proposed [retrospective decision](docs/adr/ADR-001-read-only-userscript.md). Historical browser acceptance above remains dated evidence and does not establish the version installed today.

## License

[MIT](LICENSE). Original exporter: Copyright (c) 2025 Eugeniusz. Userscript adaptation: Copyright (c) 2026 iam-brain.
