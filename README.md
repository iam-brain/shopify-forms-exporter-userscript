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

Use a current browser with `AbortSignal.any`, `AbortSignal.timeout`, and native HTML dialog support. Tampermonkey/Violentmonkey metadata is provided; installation and a complete live Shopify export have not yet been verified. Shopify's current header structure was inspected in a signed-in browser, and behavior is covered by automated DOM/network fixtures. This is a userscript, not a Shopify app or an official Shopify feature.

If you see **Session token unavailable**, reload Admin, wait for the form to load, and retry. Confirm your manager allows execution in the page context. A 401/403 means the session expired or the current staff account lacks access.

## Development

The installable `.user.js` is the complete runtime: no bundled dependencies or build output.

```sh
npm ci
npm run check
npm test
```

Node.js 24 or newer is recommended for development. Tests execute the actual userscript in jsdom and exercise button placement, navigation, pagination, errors, CSV escaping, file batches, session-header capture, and iframe message validation with synthetic data. They do not access a real store. CI runs the same checks.

## License

[MIT](LICENSE). Original exporter: Copyright (c) 2025 Eugeniusz. Userscript adaptation: Copyright (c) 2026 iam-brain.
