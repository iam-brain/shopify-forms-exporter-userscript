const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { JSDOM } = require('jsdom');
const source = readFileSync(require.resolve('../shopify-forms-exporter.user.js'), 'utf8');
const base = 'https://admin.shopify.com/store/example';
const entries = '/content/metaobjects/read-only/entries/app--987654--shopify-forms123';
const pageHTML = '<main id="AppFrameMain"><s-internal-page heading="Entries"><div slot="secondary-actions">Manage definition</div></s-internal-page></main>';
const record = (id, fields = []) => ({ node: { id: `gid://shopify/Metaobject/${id}`, displayName: `Submission ${id}`, createdAt: '2026-01-01', updatedAt: '2026-01-02', fields } });
const pageData = (edges, hasNextPage = false, endCursor = null) => ({ data: { metaobjects: { edges, pageInfo: { hasNextPage, endCursor } } } });
const json = data => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });

function setup({ path = entries, html = pageHTML, fetch, meta = true, native = true } = {}) {
  const dom = new JSDOM(`${meta ? '<meta name="csrf-token" content="fixture-token">' : ''}${html}`, { url: base + path, runScripts: 'outside-only' });
  const w = dom.window;
  const intervals = [];
  const calls = [];
  const blobs = [];
  const downloads = [];
  w.setInterval = fn => { intervals.push(fn); return intervals.length; };
  w.setTimeout = () => 1;
  w.Headers = Headers;
  w.Request = Request;
  w.Blob = Blob;
  w.AbortController = AbortController;
  w.AbortSignal = AbortSignal;
  w.URL.createObjectURL = blob => { blobs.push(blob); return 'blob:fixture'; };
  w.URL.revokeObjectURL = () => {};
  w.HTMLAnchorElement.prototype.click = function () { downloads.push(this.download); };
  if (native) w.customElements.define('s-internal-button', class extends w.HTMLElement {});
  w.fetch = (...args) => { calls.push(args); return fetch ? fetch(...args) : Promise.resolve(json(pageData([]))); };
  w.eval(source);
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  const tick = () => intervals.forEach(fn => fn());
  return { dom, w, calls, blobs, downloads, tick, button: () => w.document.querySelector('#shopify-forms-exporter > :first-child'), status: () => w.document.querySelector('[role="status"]')?.textContent ?? '' };
}

async function settle(env) {
  for (let i = 0; i < 100; i++) {
    await new Promise(resolve => setImmediate(resolve));
    if (env.button()?.getAttribute('aria-busy') === 'false') return;
  }
  assert.fail('Export did not settle');
}

test('one native page action survives rerenders, reinjection, and SPA navigation', () => {
  const e = setup();
  assert.equal(e.button().localName, 's-internal-button');
  assert.equal(e.button().parentElement.slot, 'primaryAction');
  e.tick(); e.tick(); e.w.eval(source);
  assert.equal(e.w.document.querySelectorAll('#shopify-forms-exporter').length, 1);
  e.w.document.querySelector('main').innerHTML = '<s-internal-page heading="New form"></s-internal-page>';
  e.tick();
  assert.ok(e.button().isConnected);
  e.w.history.pushState({}, '', base + '/orders'); e.tick();
  assert.equal(e.button(), null);
  e.w.history.pushState({}, '', base + '/apps/shopify-forms/forms/456'); e.tick();
  assert.ok(e.button());
  e.dom.window.close();
});

test('embedded-app toolbar uses its existing header layout', () => {
  const e = setup({ path: '/apps/shopify-forms/forms/456', html: '<main><s-internal-toolbar></s-internal-toolbar></main>' });
  const toolbar = e.w.document.querySelector('s-internal-toolbar');
  toolbar.attachShadow({ mode: 'open' }).innerHTML = '<div class="header-content"><h1>Forms</h1></div>';
  e.tick();
  assert.equal(toolbar.shadowRoot.querySelector('#shopify-forms-exporter > :first-child').textContent, 'Export submissions');
  e.dom.window.close();
});

test('HTML fallback cannot submit its enclosing form', () => {
  const e = setup({ native: false, html: '<main><form><header></header></form></main>' });
  assert.equal(e.button().tagName, 'BUTTON');
  assert.equal(e.button().type, 'button');
  e.dom.window.close();
});

test('exports every page, deduplicates overlaps, unions fields, and protects spreadsheet cells', async () => {
  const e = setup({ fetch: async (url, init) => {
    const body = JSON.parse(init.body);
    assert.equal(init.credentials, 'same-origin');
    assert.equal(init.headers['x-csrf-token'], 'fixture-token');
    assert.equal(body.variables.type, 'app--987654--shopify-forms123');
    if (!body.variables.after) return json(pageData([record(1, [{ key: 'name', value: 'Zoë, "Example"\nSecond line' }, { key: 'formula', value: '=1+1' }])], true, 'cursor-1'));
    assert.equal(body.variables.after, 'cursor-1');
    return json(pageData([record(1), record(2, [{ key: 'late_field', value: 'later' }, { key: 'phone', value: '+15555550123' }])]));
  } });
  e.button().click(); e.button().click();
  await settle(e);
  assert.equal(e.calls.length, 2);
  assert.equal(e.downloads.length, 1);
  assert.match(e.downloads[0], /^form_123_submissions_\d{4}-\d\d-\d\d\.csv$/);
  const bytes = new Uint8Array(await e.blobs[0].arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [239, 187, 191]);
  const csv = await e.blobs[0].text();
  assert.match(csv, /"Zoë, ""Example""\nSecond line"/);
  assert.ok(csv.includes('"\'=1+1"'));
  assert.ok(csv.includes('"\'+15555550123"'));
  assert.match(csv.split('\r\n')[0], /"late_field","phone"/);
  assert.equal((csv.match(/gid:\/\/shopify\/Metaobject\/1/g) || []).length, 1);
  assert.equal(e.status(), '2 submissions exported.');
  e.dom.window.close();
});

for (const [name, response, expected] of [
  ['GraphQL errors', { errors: [{ message: 'Access denied' }] }, /Access denied/],
  ['malformed response', { data: { metaobjects: { edges: [] } } }, /Unexpected submissions response/],
  ['expired session', null, /session expired or access was denied/],
]) test(`${name} fails without downloading a misleading CSV`, async () => {
  const e = setup({ fetch: async () => response ? json(response) : new Response('', { status: 403 }) });
  e.button().click(); await settle(e);
  assert.equal(e.downloads.length, 0);
  assert.match(e.status(), expected);
  e.dom.window.close();
});

test('later-page failure never downloads earlier pages', async () => {
  let count = 0;
  const e = setup({ fetch: async () => ++count === 1 ? json(pageData([record(1)], true, 'next')) : json({ errors: [{ message: 'Page failed' }] }) });
  e.button().click(); await settle(e);
  assert.equal(e.calls.length, 2);
  assert.equal(e.downloads.length, 0);
  assert.match(e.status(), /Page failed/);
  e.dom.window.close();
});

test('repeated cursors fail instead of looping or downloading partial records', async () => {
  const e = setup({ fetch: async () => json(pageData([record(1)], true, 'repeated')) });
  e.button().click(); await settle(e);
  assert.equal(e.calls.length, 2);
  assert.equal(e.downloads.length, 0);
  assert.match(e.status(), /pagination did not advance/);
  e.dom.window.close();
});

test('empty forms report zero submissions', async () => {
  const e = setup();
  e.button().click(); await settle(e);
  assert.equal(e.downloads.length, 0);
  assert.equal(e.status(), 'This form has no submissions.');
  e.dom.window.close();
});

test('file references use bounded batches, including list references', async () => {
  const gids = Array.from({ length: 251 }, (_, i) => `gid://shopify/GenericFile/${i + 1}`);
  const e = setup({ fetch: async (_, init) => {
    const body = JSON.parse(init.body);
    if (body.operationName === 'Submissions') return json(pageData([record(1, [{ key: 'files', value: JSON.stringify(gids) }])]));
    assert.ok(body.variables.ids.length <= 250);
    return json({ data: { nodes: body.variables.ids.map(id => ({ id, url: `https://cdn.shopify.com/${id.split('/').at(-1)}.pdf` })) } });
  } });
  e.button().click(); await settle(e);
  assert.equal(e.calls.length, 3);
  const csv = await e.blobs[0].text();
  assert.match(csv, /https:\/\/cdn.shopify.com\/251.pdf/);
  assert.doesNotMatch(csv, /gid:\/\/shopify\/GenericFile/);
  e.dom.window.close();
});

test('unresolved uploads retain IDs and show a warning', async () => {
  const e = setup({ fetch: async (_, init) => JSON.parse(init.body).operationName === 'Submissions' ? json(pageData([record(1, [{ key: 'file', value: 'gid://shopify/MediaImage/123' }])])) : json({ errors: [{ message: 'File unavailable' }] }) });
  e.button().click(); await settle(e);
  assert.equal(e.downloads.length, 1);
  assert.match(await e.blobs[0].text(), /gid:\/\/shopify\/MediaImage\/123/);
  assert.match(e.status(), /IDs were kept/);
  e.dom.window.close();
});

test('navigation aborts an in-flight export and ignores its late response', async () => {
  let resolve;
  const e = setup({ fetch: (_, init) => new Promise(r => { resolve = () => r(json(pageData([record(1)]))); }) });
  e.button().click();
  await new Promise(r => setImmediate(r));
  e.w.history.pushState({}, '', base + '/apps/shopify-forms/forms/456'); e.tick();
  assert.ok(e.calls[0][1].signal.aborted);
  resolve(); await settle(e);
  assert.equal(e.downloads.length, 0);
  assert.equal(e.status(), '');
  e.dom.window.close();
});

test('captures CSRF from Request headers without changing the page response', async () => {
  const response = json(pageData([]));
  const e = setup({ meta: false, fetch: async () => response });
  const actual = await e.w.fetch(new Request(`${base}/api/example`, { headers: { 'x-csrf-token': 'captured-token' } }));
  assert.equal(actual, response);
  e.button().click(); await settle(e);
  assert.equal(e.calls[1][1].headers['x-csrf-token'], 'captured-token');
  e.dom.window.close();
});

test('shell token fallback handles meta attributes in either order', async () => {
  const e = setup({ meta: false, fetch: async (_, init) => init.method ? json(pageData([])) : new Response('<meta content="shell-token" name="csrf-token">') });
  e.button().click(); await settle(e);
  assert.equal(e.calls[1][1].headers['x-csrf-token'], 'shell-token');
  e.dom.window.close();
});

test('overview chooser accepts form names only from its real Forms iframe', async () => {
  const e = setup({ path: '/apps/shopify-forms', html: '<main><header></header><iframe src="https://forms.shopifyapps.com/"></iframe></main>' });
  e.w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  e.w.HTMLDialogElement.prototype.close = function () { this.open = false; };
  const frame = e.w.document.querySelector('iframe');
  const data = { kind: 'shopify-forms-exporter:forms', path: '/', forms: [{ id: '456', name: '<img src=x onerror=alert(1)>' }] };
  e.w.dispatchEvent(new e.w.MessageEvent('message', { origin: 'https://evil.example', source: frame.contentWindow, data }));
  e.button().click();
  assert.equal(e.w.document.querySelector('select'), null);
  e.w.dispatchEvent(new e.w.MessageEvent('message', { origin: 'https://forms.shopifyapps.com', source: frame.contentWindow, data }));
  e.button().click();
  assert.equal(e.w.document.querySelector('option').textContent, data.forms[0].name);
  assert.equal(e.w.document.querySelector('dialog img'), null);
  e.w.document.querySelector('dialog button').click(); await settle(e);
  assert.equal(JSON.parse(e.calls[0][1].body).variables.type, 'app--6171699--shopify-forms456');
  e.dom.window.close();
});

test('embedded helper relays only same-origin numeric form links to Admin', () => {
  const dom = new JSDOM('<a href="/forms/12">Newsletter</a><a href="https://evil.example/forms/99">Ignore</a>', { url: 'https://forms.shopifyapps.com/', runScripts: 'outside-only' });
  const messages = [];
  Object.defineProperty(dom.window, 'parent', { value: { postMessage: (...args) => messages.push(args) } });
  dom.window.setInterval = () => 1;
  dom.window.eval(source);
  assert.equal(messages[0][1], 'https://admin.shopify.com');
  assert.equal(JSON.stringify(messages[0][0].forms), JSON.stringify([{ id: '12', name: 'Newsletter' }]));
  assert.equal(dom.window.document.querySelector('#shopify-forms-exporter'), null);
  dom.window.close();
});
