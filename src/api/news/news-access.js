'use strict';

const publicNewsFilter = () => ({
  $or: [{ isPublic: { $eq: true } }, { isPublic: { $null: true } }],
});

// API tokens are server credentials. Website visitors never receive one.
const isTrustedNewsService = (ctx) =>
  ctx.state?.auth?.strategy?.name === 'api-token' && Boolean(ctx.state.auth.credentials);

const restrictNewsQuery = (query = {}) => ({
  ...query,
  status: 'published',
  filters: { $and: [query.filters || {}, publicNewsFilter()] },
});

module.exports = { isTrustedNewsService, restrictNewsQuery, publicNewsFilter };
