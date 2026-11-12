const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { isTrustedNewsService, canReadAdminOnlyNews, restrictNewsQuery } = require('../src/api/news/news-access.js');

test('visitor filters cannot override public, published news restrictions', () => {
  const query = restrictNewsQuery({ status: 'draft', filters: { isPublic: false } });
  assert.equal(query.status, 'published');
  assert.deepEqual(query.filters.$and[0], { isPublic: false });
  assert.ok(query.filters.$and[1].$or.some(f => f.isPublic.$eq === true));
  for (const state of [{}, { user: { role: 'admin' } }, { auth: { strategy: { name: 'users-permissions' }, credentials: { role: 'admin' } } }]) {
    assert.equal(isTrustedNewsService({ state }), false);
  }
  assert.equal(isTrustedNewsService({ state: { auth: { strategy: { name: 'api-token' }, credentials: { id: 1 } } } }), true);
  const service = { state: { auth: { strategy: { name: 'content-api-token' }, credentials: { id: 1 } } }, query: {} };
  assert.equal(canReadAdminOnlyNews(service), false);
  service.query.includeAdminOnly = 'true';
  assert.equal(canReadAdminOnlyNews(service), true);
  assert.equal(canReadAdminOnlyNews({ state: {}, query: { includeAdminOnly: 'true' } }), false);
});

test('a direct visitor request cannot return an admin-only article', async () => {
  let delivered = false;
  const parent = { findOne: () => { delivered = true; } };
  const m = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/api/news/controllers/news.js'), 'utf8'), {
    module: m, exports: m.exports,
    require(name) {
      if (name === '../news-access') return { isTrustedNewsService, canReadAdminOnlyNews, restrictNewsQuery };
      return { factories: { createCoreController: (_uid, build) => Object.setPrototypeOf(build({ strapi: { documents: () => ({ findOne: async () => ({ isPublic: false }) }) } }), parent) } };
    },
  });
  const ctx = { state: {}, query: {}, params: { id: 'private-article' }, set() {}, notFound() { return 'not found'; } };
  assert.equal(await m.exports.findOne(ctx), 'not found');
  assert.equal(delivered, false);
});

test('version history requires an active native CMS administrator session', async () => {
  const { default: policy } = await import('../src/policies/content-history-admin.ts');
  for (const [valid, active, userActive, expected] of [[false, true, true, false], [true, false, true, false], [true, true, false, false], [true, true, true, true]]) {
    const strapi = { sessionManager(namespace) {
      assert.equal(namespace, 'admin');
      return { validateAccessToken: () => ({ isValid: valid, payload: { sessionId: 'test', userId: '1' } }), isSessionActive: async () => active };
    }, db: { query: () => ({ findOne: async () => ({ id: 1, isActive: userActive }) }) } };
    const ctx = { request: { header: { authorization: 'Bearer synthetic' } }, state: {} };
    assert.equal(await policy(ctx, {}, { strapi }), expected);
  }
});

test('private news and news without explicit webhook opt-in never deliver automatically', async () => {
  const { shouldDeliverNewsEntryWebhook: allowed } = await import('../src/webhook-content-type-filter.ts');
  assert.equal(allowed({ isPublic: false, sendToWebhook: true }), false);
  assert.equal(allowed({ isPublic: true, sendToWebhook: false }), false);
  assert.equal(allowed({ isPublic: true }), false);
  assert.equal(allowed({ isPublic: true, sendToWebhook: true }), true);
});

test('all version routes use the native administrator session policy, including restore', async () => {
  const { default: router } = await import('../src/api/content-version/routes/content-version.ts');
  for (const route of router.routes) {
    assert.equal(route.config.auth, false);
    assert.deepEqual(route.config.policies, ['global::content-history-admin']);
  }
});
