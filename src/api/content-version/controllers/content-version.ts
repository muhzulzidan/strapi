/**
 * content-version controller
 * Handles history listing, viewing versions, and reverting content
 */

import type { Core } from '@strapi/strapi';

type ContentVersionUID = 'api::content-version.content-version';
const CONTENT_VERSION_UID: ContentVersionUID = 'api::content-version.content-version';

const controller = ({ strapi }: { strapi: Core.Strapi }) => ({
  /**
   * List all versions for a specific entry
   * GET /api/content-versions/history?contentTypeUid=api::news.news&documentId=123&locale=en
   */
  async getHistory(ctx: any) {
    try {
      const { contentTypeUid, entryId, locale = 'en', limit = 100, offset = 0 } = ctx.query;

      if (!contentTypeUid || !entryId) {
        return ctx.badRequest(
          'Missing required query params: contentTypeUid, entryId'
        );
      }

      const versions = await strapi.entityService.findMany(CONTENT_VERSION_UID as any, {
        filters: {
          contentTypeUid,
          entryId,
          locale,
        },
        sort: { versionNumber: 'desc' },
        limit: Math.min(parseInt(limit as string, 10) || 100, 500),
        offset: parseInt(offset as string, 10) || 0,
      });

      const total = await strapi.db.query(CONTENT_VERSION_UID as any).count({
        where: {
          contentTypeUid,
          entryId,
          locale,
        },
      });

      ctx.body = {
        data: versions,
        pagination: {
          offset,
          limit,
          total,
        },
      };
    } catch (error) {
      ctx.throw(500, error);
    }
  },

  /**
   * Get a specific version
   * GET /api/content-versions/:id
   */
  async getVersion(ctx: any) {
    try {
      const { id } = ctx.params;

      const version = await strapi.entityService.findOne(CONTENT_VERSION_UID as any, id);

      if (!version) {
        return ctx.notFound('Version not found');
      }

      ctx.body = { data: version };
    } catch (error) {
      ctx.throw(500, error);
    }
  },

  /**
   * Compare two versions
   * GET /api/content-versions/compare?from=versionId1&to=versionId2
   */
  async compareVersions(ctx: any) {
    try {
      const { from, to } = ctx.query;

      if (!from || !to) {
        return ctx.badRequest('Missing required query params: from, to');
      }

      const versionFrom = await strapi.entityService.findOne(CONTENT_VERSION_UID as any, from);
      const versionTo = await strapi.entityService.findOne(CONTENT_VERSION_UID as any, to);

      if (!versionFrom || !versionTo) {
        return ctx.notFound('One or both versions not found');
      }

      ctx.body = {
        data: {
          from: versionFrom,
          to: versionTo,
          differences: calculateDifferences(
            (versionFrom as any).newData || {},
            (versionTo as any).newData || {}
          ),
        },
      };
    } catch (error) {
      ctx.throw(500, error);
    }
  },

  /**
   * Revert an entry to a specific version
   * POST /api/content-versions/:versionId/revert
   */
  async revertToVersion(ctx: any) {
    try {
      const { versionId } = ctx.params;
      const { locale } = ctx.request.body || {};

      if (!versionId) {
        return ctx.badRequest('Version ID is required');
      }

      const version: any = await strapi.entityService.findOne(CONTENT_VERSION_UID as any, versionId);

      if (!version) {
        return ctx.notFound('Version not found');
      }

      const { contentTypeUid, entryId } = version;

      // Fetch current entry
      const currentEntry = await strapi.entityService.findOne(contentTypeUid, entryId, {
        populate: '*',
      });

      if (!currentEntry) {
        return ctx.notFound(`Entry ${entryId} not found`);
      }

      // Prepare data to revert
      const revertData = version.newData || {};

      // Update entry with reverted data
      const updatedEntry = await strapi.entityService.update(contentTypeUid, entryId, {
        data: revertData,
      });

      // Record the revert action
      const userId = (ctx.state as any).user?.id;
      const userEmail = (ctx.state as any).user?.email;

      const trackingService = strapi.service('api::content-version.content-version-tracking') as any;
      if (trackingService) {
        await trackingService.recordVersion(contentTypeUid, entryId, locale || version.locale || 'en', {
          actionType: 'revert',
          previousData: currentEntry,
          newData: updatedEntry,
          userId,
          userEmail,
          reason: `Reverted to version ${version.versionNumber}`,
        });
      }

      ctx.body = {
        data: updatedEntry,
        message: `Content reverted to version ${version.versionNumber}`,
      };
    } catch (error) {
      ctx.throw(500, error);
    }
  },
});

/**
 * Calculate differences between two data snapshots
 */
function calculateDifferences(
  oldData: Record<string, any> | undefined,
  newData: Record<string, any> | undefined
) {
  const differences: Record<string, any> = {};
  const old = oldData || {};
  const neu = newData || {};

  const allKeys = new Set([...Object.keys(old), ...Object.keys(neu)]);

  for (const key of allKeys) {
    if (JSON.stringify(old[key]) !== JSON.stringify(neu[key])) {
      differences[key] = {
        from: old[key],
        to: neu[key],
      };
    }
  }

  return differences;
}

export default controller;
