'use strict';

const publicNewsFilter = () => ({
  $or: [{ isPublic: { $eq: true } }, { isPublic: { $null: true } }],
});

// API tokens are server credentials. Website visitors never receive one.
const isTrustedNewsService = (ctx) =>
  ctx.state?.auth?.strategy?.name === 'api-token' && Boolean(ctx.state.auth.credentials);

const canReadAdminOnlyNews = (ctx) =>
  isTrustedNewsService(ctx) && String(ctx.query?.includeAdminOnly) === 'true';

const restrictNewsQuery = (query = {}, publishedOnly = true) => ({
  ...query,
  ...(publishedOnly ? { status: 'published' } : {}),
  filters: { $and: [query.filters || {}, publicNewsFilter()] },
});

module.exports = { isTrustedNewsService, canReadAdminOnlyNews, restrictNewsQuery, publicNewsFilter };
