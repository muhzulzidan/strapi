'use strict';
const { createCoreController } = require('@strapi/strapi').factories;
const { isTrustedNewsService, canReadAdminOnlyNews, restrictNewsQuery } = require('../news-access');

module.exports = createCoreController('api::news.news', ({ strapi }) => ({
  async find(ctx) {
    ctx.set('Cache-Control', 'private, no-store');
    const allowPrivate = canReadAdminOnlyNews(ctx);
    const { includeAdminOnly: _includeAdminOnly, ...query } = ctx.query;
    ctx.query = allowPrivate ? query : restrictNewsQuery(query, !isTrustedNewsService(ctx));
    return super.find(ctx);
  },

  async findOne(ctx) {
    ctx.set('Cache-Control', 'private, no-store');
    const allowPrivate = canReadAdminOnlyNews(ctx);
    const { includeAdminOnly: _includeAdminOnly, ...query } = ctx.query;
    ctx.query = allowPrivate ? query : restrictNewsQuery(query, !isTrustedNewsService(ctx));
    if (!allowPrivate) {
      const document = await strapi.documents('api::news.news').findOne({
        documentId: ctx.params.id,
        status: ctx.query.status || 'published',
        fields: ['isPublic'],
      });
      if (document?.isPublic === false) return ctx.notFound();
    }
    return super.findOne(ctx);
  },
}));
