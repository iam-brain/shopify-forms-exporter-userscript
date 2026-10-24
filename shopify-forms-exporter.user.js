// ==UserScript==
// @name         Shopify Forms — Export submissions
// @namespace    https://github.com/iam-brain/shopify-forms-exporter-userscript
// @version      1.0.3
// @description  Adds an inline Shopify-style button to export every submission for a form as CSV.
// @author       iam-brain; based on ozhehkovski/shopify_forms_exporter
// @license      MIT
// @match        https://admin.shopify.com/store/*
// @match        https://forms.shopifyapps.com/*
// @run-at       document-start
// @grant        none
// @sandbox      raw
// @inject-into  page
// @homepageURL  https://github.com/iam-brain/shopify-forms-exporter-userscript
// @downloadURL  https://raw.githubusercontent.com/iam-brain/shopify-forms-exporter-userscript/main/shopify-forms-exporter.user.js
// @updateURL    https://raw.githubusercontent.com/iam-brain/shopify-forms-exporter-userscript/main/shopify-forms-exporter.user.js
// ==/UserScript==

// Adapted from Shopify Forms Exporter, Copyright (c) 2025 Eugeniusz, MIT.
// The full upstream license is included at the end of this file.

(() => {
  'use strict';
  if (window.__shopifyFormsExporterInstalled) return;
  window.__shopifyFormsExporterInstalled = true;

  // The embedded app can identify forms, but only the Admin parent makes API calls.
  if (location.origin === 'https://forms.shopifyapps.com') {
    if (window.parent === window) return;
    let previous = '';
    const publish = () => {
      const forms = new Map();
      for (const link of document.querySelectorAll('a[href]')) {
        const url = new URL(link.href, location.href);
        const id = url.origin === location.origin && url.pathname.match(/^\/forms\/(\d+)(?:\/|$)/)?.[1];
        if (id) forms.set(id, { id, name: link.textContent.trim().slice(0, 160) || `Form ${id}` });
      }
      const data = { kind: 'shopify-forms-exporter:forms', path: location.pathname, forms: [...forms.values()] };
      const serialized = JSON.stringify(data);
      if (serialized !== previous) {
        window.parent.postMessage(data, 'https://admin.shopify.com');
        previous = serialized;
      }
    };
    setInterval(publish, 1000);
    publish();
    return;
  }
  if (location.origin !== 'https://admin.shopify.com' || window.top !== window) return;

  const ID = 'shopify-forms-exporter';
  const DEFAULT_APP_ID = '6171699'; // Shopify Forms application ID, also used upstream.
  const nativeFetch = window.fetch;
  let csrf = '';
  let formChoices = [];
  let framePath = '';
  let frameSource = null;
  let currentKey = '';
  let running = null;
  let lastMessage = '';
  let lastError = false;
  const completedExports = new Set();
  let control;
  let button;
  let status;
  let dialog;

  const isAdminRequest = input => {
    try { return new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href).origin === location.origin; }
    catch { return false; }
  };
  const capture = value => { if (typeof value === 'string' && value) csrf = value; };

  // Passive, in-memory replacement for the extension's webRequest listener.
  // Page-world execution is necessary: an isolated userscript sandbox cannot see Admin fetches.
  window.fetch = function (input, init) {
    if (isAdminRequest(input)) {
      try { capture(new Headers(init?.headers ?? input?.headers).get('x-csrf-token')); } catch { /* Leave the page request untouched. */ }
    }
    return nativeFetch.apply(this, arguments);
  };
  const xhrRequests = new WeakMap();
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (method, url) {
    xhrRequests.set(this, isAdminRequest(String(url)));
    return originalOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    const result = originalSetHeader.apply(this, arguments);
    if (xhrRequests.get(this) && String(name).toLowerCase() === 'x-csrf-token') capture(String(value));
    return result;
  };

  function context() {
    const store = location.pathname.match(/^\/store\/([^/]+)/)?.[1];
    if (!store) return null;
    const metaobject = location.pathname.match(/\/content\/metaobjects\/(?:read-only\/)?entries\/(app--(\d+)--shopify-forms(\d+))(?:\/|$)/);
    const app = location.pathname.match(/^\/store\/[^/]+\/apps\/shopify-forms(?:\/|$)/);
    if (!metaobject && !app) return null;
    const formId = metaobject?.[3] ?? location.pathname.match(/\/apps\/shopify-forms\/forms\/(\d+)(?:\/|$)/)?.[1];
    const appId = metaobject?.[2] ?? document.querySelector('[data-component-extra-api-client-id]')?.getAttribute('data-component-extra-api-client-id') ?? DEFAULT_APP_ID;
    return { store, appId: /^\d+$/.test(appId) ? appId : DEFAULT_APP_ID, formId };
  }

  function formsFrame() {
    return [...document.querySelectorAll('iframe')].find(frame => {
      try { return new URL(frame.src).origin === 'https://forms.shopifyapps.com'; } catch { return false; }
    });
  }

  window.addEventListener('message', event => {
    const frame = formsFrame();
    if (!context() || event.origin !== 'https://forms.shopifyapps.com' || event.source !== frame?.contentWindow) return;
    const data = event.data;
    if (data?.kind !== 'shopify-forms-exporter:forms' || !Array.isArray(data.forms) || typeof data.path !== 'string') return;
    sync();
    frameSource = event.source;
    framePath = data.path;
    formChoices = data.forms.filter(f => /^\d+$/.test(f?.id) && typeof f.name === 'string').slice(0, 500);
  });

  function notify(message, error = false) {
    lastMessage = message;
    lastError = error;
    const label = message || 'Export submissions';
    if (status && status.textContent !== label) status.textContent = label;
    if (button) button.setAttribute(button.localName === 's-internal-button' ? 'accessibilitylabel' : 'aria-label', label);
    if (status) status.style.color = error ? 'var(--p-color-text-critical, #b42318)' : 'inherit';
  }

  function makeControl() {
    control = document.createElement('span');
    control.id = ID;
    control.style.cssText = 'display:inline-flex;align-items:center;flex-wrap:wrap;gap:8px;margin-inline-start:8px;max-width:100%';
    // Reuse the registered native component; fall back to a real accessible HTML button.
    button = document.createElement(customElements.get('s-internal-button') ? 's-internal-button' : 'button');
    button.setAttribute('type', 'button');
    button.setAttribute('variant', 'secondary');
    if (button.localName === 'button') {
      button.className = 'Polaris-Button Polaris-Button--pressable Polaris-Button--variantSecondary Polaris-Button--sizeMedium Polaris-Button--textAlignCenter';
      button.style.cssText = 'font:inherit;font-size:13px;font-weight:550;line-height:20px;padding:5px 12px;border:1px solid var(--p-color-border,#c9cccf);border-radius:var(--p-border-radius-200,8px);background:var(--p-color-bg-surface,#fff);color:var(--p-color-text,#303030);box-shadow:0 1px 0 #0000000d;cursor:pointer';
    }
    button.style.maxWidth = '38ch';
    button.title = 'Download all submissions for this form as CSV. Table filters and selections do not limit the export.';
    button.addEventListener('click', event => {
      event.preventDefault();
      if (running) return;
      const info = context();
      if (!info) return;
      const embeddedId = frameSource === formsFrame()?.contentWindow ? framePath.match(/^\/forms\/(\d+)(?:\/|$)/)?.[1] : null;
      if (info.formId || embeddedId) startExport({ ...info, formId: info.formId ?? embeddedId });
      else chooseForm(info);
    });
    status = document.createElement('span');
    status.id = `${ID}-status`;
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.style.cssText = 'white-space:normal;overflow-wrap:anywhere';
    button.append(status);
    control.append(button);
    notify(lastMessage, lastError);
  }

  function chooseForm(info) {
    dialog?.remove();
    dialog = document.createElement('dialog');
    dialog.setAttribute('aria-labelledby', `${ID}-dialog-title`);
    dialog.style.cssText = 'font:13px/1.5 system-ui;color:#303030;border:1px solid #ddd;border-radius:12px;padding:24px;width:420px;max-width:calc(100vw - 48px);box-sizing:border-box;box-shadow:0 12px 48px #0003';
    const heading = document.createElement('h2');
    heading.id = `${ID}-dialog-title`;
    heading.textContent = 'Export form submissions';
    heading.style.cssText = 'font-size:16px;margin:0 0 16px';
    dialog.append(heading);
    if (frameSource === formsFrame()?.contentWindow && formChoices.length) {
      const label = document.createElement('label');
      label.textContent = 'Form';
      const select = document.createElement('select');
      select.style.cssText = 'display:block;width:100%;font:inherit;padding:8px;margin:8px 0 16px;border:1px solid #aaa;border-radius:8px;background:#fff';
      for (const form of formChoices) select.add(new Option(form.name, form.id));
      label.append(select);
      dialog.append(label);
      const exportButton = document.createElement('button');
      exportButton.type = 'button';
      exportButton.textContent = 'Export CSV';
      exportButton.addEventListener('click', () => { dialog.close(); startExport({ ...info, formId: select.value }); });
      dialog.append(exportButton);
    } else {
      const explanation = document.createElement('p');
      explanation.textContent = 'Open the form you want to export, then choose Export submissions. On the Forms overview, forms become available here once the list has loaded.';
      dialog.append(explanation);
    }
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Close';
    close.style.marginInlineStart = '8px';
    close.addEventListener('click', () => dialog.close());
    dialog.append(close);
    document.body.append(dialog);
    dialog.showModal();
  }

  function sync() {
    const info = context();
    const key = info ? `${info.store}/${info.appId}/${info.formId ?? ''}` : '';
    if (key !== currentKey) {
      running?.abort();
      currentKey = key;
      formChoices = [];
      framePath = '';
      frameSource = null;
      dialog?.remove();
      notify('');
    }
    if (!info) { control?.remove(); return; }
    const main = document.querySelector('#AppFrameMain, main, [role="main"]');
    if (!main) return;
    const page = main.querySelector('s-internal-page');
    const toolbar = main.querySelector('s-internal-toolbar');
    const header = main.querySelector('.Polaris-Page-Header__Row, .Polaris-Page-Header, header');
    // Shopify manually assigns its page slots; inserting a light-DOM child can
    // leave it in the content area. Use the rendered actions container directly.
    const target = page?.shadowRoot?.querySelector('.actions') ?? toolbar?.shadowRoot?.querySelector('.header-content') ?? header ?? main;
    if (!control) makeControl();
    if (control.parentNode !== target) {
      if (target === main) target.prepend(control);
      else target.append(control);
    }
    button.toggleAttribute('disabled', Boolean(running));
    button.setAttribute('aria-busy', String(Boolean(running)));
  }

  async function token(signal) {
    if (csrf) return csrf;
    const read = doc => doc.querySelector('meta[name="csrf-token"]')?.content;
    const value = read(document) || window.Shopify?.csrf;
    if (typeof value === 'string' && value) return value;
    const response = await nativeFetch.call(window, location.href, { credentials: 'same-origin', signal });
    if (response.ok) {
      const html = new DOMParser().parseFromString(await response.text(), 'text/html');
      const found = read(html);
      if (found) return found;
    }
    throw new Error('Session token unavailable. Reload this page, wait for it to load, then try again. Enable page-context execution in your userscript manager.');
  }

  async function query(info, operationName, queryText, variables, csrfToken, job) {
    const operation = operationName === 'Submissions' ? 'MetaobjectIndex' : operationName;
    const response = await nativeFetch.call(window, `/api/shopify/${encodeURIComponent(info.store)}?operation=${operation}&type=query`, {
      method: 'POST', credentials: 'same-origin', signal: job.requestSignal(),
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'x-shopify-web-force-proxy': '1', 'x-csrf-token': csrf || csrfToken },
      body: JSON.stringify({ operationName, variables, query: queryText }),
    });
    if (response.status === 401 || response.status === 403) throw new Error('Your Shopify session expired or access was denied. Reload the page and try again.');
    if (!response.ok) throw new Error(`Shopify returned HTTP ${response.status}. Please try again.`);
    const result = await response.json();
    sync();
    job.signal.throwIfAborted();
    if (result.errors?.length) throw new Error(result.errors.map(error => error.message).join('; '));
    if (!result.data) throw new Error('Shopify returned an unexpected response. No CSV was downloaded.');
    return result.data;
  }

  const SUBMISSIONS = `query Submissions($first:Int!,$after:String,$type:String!,$query:String){
    metaobjects:allMetaobjects(first:$first,after:$after,type:$type,query:$query,sortKey:"updated_at",reverse:true){
      edges{node{id displayName createdAt updatedAt fields{key value type}}}
      pageInfo{hasNextPage endCursor}
    }
  }`;
  const FILES = `query ResolveFiles($ids:[ID!]!){nodes(ids:$ids){
    ... on GenericFile{id url}
    ... on MediaImage{id image{url}}
  }}`;

  async function submissions(info, csrfToken, job) {
    const rows = [];
    const cursors = new Set();
    const ids = new Set();
    let after = null;
    do {
      const data = await query(info, 'Submissions', SUBMISSIONS, { first: 250, after, type: `app--${info.appId}--shopify-forms${info.formId}`, query: `added_by:app--${info.appId}` }, csrfToken, job);
      const connection = data.metaobjects;
      if (!Array.isArray(connection?.edges) || typeof connection.pageInfo?.hasNextPage !== 'boolean') throw new Error('Unexpected submissions response. No CSV was downloaded.');
      for (const { node } of connection.edges) {
        if (!node?.id || !Array.isArray(node.fields)) throw new Error('Incomplete submission returned. No CSV was downloaded.');
        if (ids.has(node.id)) continue;
        ids.add(node.id);
        const row = Object.assign(Object.create(null), { id: node.id, displayName: node.displayName, createdAt: node.createdAt, updatedAt: node.updatedAt });
        for (const field of node.fields) row[field.key] = field.value;
        rows.push(row);
      }
      notify(`${rows.length.toLocaleString()} submissions loaded…`);
      after = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null;
      if (connection.pageInfo.hasNextPage && (!after || cursors.has(after))) throw new Error('Shopify pagination did not advance. No partial CSV was downloaded.');
      if (after) cursors.add(after);
    } while (after);
    return rows;
  }

  function fileIds(value) {
    if (typeof value !== 'string') return [];
    if (/^gid:\/\/shopify\/(GenericFile|MediaImage)\/\d+$/.test(value)) return [value];
    try { const list = JSON.parse(value); return Array.isArray(list) ? list.flatMap(fileIds) : []; } catch { return []; }
  }

  async function resolveFiles(rows, info, csrfToken, job) {
    const ids = [...new Set(rows.flatMap(row => Object.values(row).flatMap(fileIds)))];
    const urls = new Map();
    let unresolved = false;
    for (let index = 0; index < ids.length; index += 250) {
      notify(`Resolving uploaded files (${Math.min(index + 250, ids.length)}/${ids.length})…`);
      try {
        const data = await query(info, 'ResolveFiles', FILES, { ids: ids.slice(index, index + 250) }, csrfToken, job);
        for (const node of data.nodes ?? []) if (node?.id && (node.url || node.image?.url)) urls.set(node.id, node.url || node.image.url);
      } catch (error) {
        if (job.signal.aborted) throw error;
        unresolved = true;
      }
    }
    for (const row of rows) for (const key of Object.keys(row)) {
      const refs = fileIds(row[key]);
      if (!refs.length) continue;
      if (refs.some(id => !urls.has(id))) unresolved = true;
      if (refs.length === 1 && row[key] === refs[0]) row[key] = urls.get(refs[0]) ?? row[key];
      else row[key] = JSON.stringify(JSON.parse(row[key]).map(id => urls.get(id) ?? id));
    }
    return unresolved;
  }

  function download(rows, filename) {
    const headers = [...new Set(rows.flatMap(Object.keys))];
    const escape = value => {
      let text = String(value ?? '');
      // Quoting alone does not prevent Excel from executing submitted formulas.
      if (/^[\s\u0000-\u001f]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
      return `"${text.replace(/"/g, '""')}"`;
    };
    const csv = '\uFEFF' + [headers, ...rows.map(row => headers.map(key => row[key]))].map(row => row.map(escape).join(',')).join('\r\n') + '\r\n';
    const href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = href;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(href), 30000);
  }

  async function startExport(info) {
    if (running) return;
    const exportKey = `${info.store}/${info.appId}/${info.formId}`;
    if (completedExports.has(exportKey) && !window.confirm('The export already completed successfully. Are you sure you want to export again?')) return;
    const controller = new AbortController();
    running = controller;
    const key = currentKey;
    sync();
    notify('Preparing export…');
    // Each request has a timeout; the complete export may span many pages.
    const job = { signal: controller.signal, requestSignal: () => AbortSignal.any([controller.signal, AbortSignal.timeout(45000)]) };
    try {
      const csrfToken = await token(job.requestSignal());
      const rows = await submissions(info, csrfToken, job);
      if (!rows.length) { notify('This form has no submissions.'); return; }
      const unresolved = await resolveFiles(rows, info, csrfToken, job);
      sync();
      if (controller.signal.aborted || currentKey !== key) return;
      download(rows, `form_${info.formId}_submissions_${new Date().toISOString().slice(0, 10)}.csv`);
      completedExports.add(exportKey);
      notify(`${rows.length.toLocaleString()} submissions exported${unresolved ? '. Some file links could not be resolved; their IDs were kept.' : ''}`);
    } catch (error) {
      if (!controller.signal.aborted && currentKey === key) notify(error.name === 'TimeoutError' ? 'Shopify took too long to respond. Please try again.' : error.message, true);
    } finally {
      if (running === controller) running = null;
      sync();
    }
  }

  // One lightweight poll handles SPA navigation, shadow headers, and React replacing nodes.
  // It also avoids observing every mutation in large submission tables.
  setInterval(sync, 750);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', sync, { once: true });
  else sync();
})();

/*
MIT License

Copyright (c) 2025 Eugeniusz
Copyright (c) 2026 iam-brain

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
