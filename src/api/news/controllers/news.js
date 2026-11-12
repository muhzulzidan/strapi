'use strict';
const { createCoreController } = require('@strapi/strapi').factories;
const { isTrustedNewsService, restrictNewsQuery } = require('../news-access');

module.exports = createCoreController('api::news.news', ({ strapi }) => ({
  async find(ctx) {
    ctx.set('Cache-Control', 'private, no-store');
    if (!isTrustedNewsService(ctx)) ctx.query = restrictNewsQuery(ctx.query);
    return super.find(ctx);
  },

  async findOne(ctx) {
    ctx.set('Cache-Control', 'private, no-store');
    if (!isTrustedNewsService(ctx)) {
      ctx.query = restrictNewsQuery(ctx.query);
      const document = await strapi.documents('api::news.news').findOne({
        documentId: ctx.params.id,
        status: 'published',
        fields: ['isPublic'],
      });
      if (document?.isPublic === false) return ctx.notFound();
    }
    return super.findOne(ctx);
  },
}));
