import type { Core } from '@strapi/strapi';

const CONTENT_VERSION_UID = 'api::content-version.content-version';

// Store reference to original methods
let originalCreate: any = null;
let originalUpdate: any = null;

export default {
  /**
   * An asynchronous register function that runs before
   * your application is initialized.
   *
   * This gives you an opportunity to extend code.
   */
  register({ strapi }: { strapi: Core.Strapi }) {
    // Hook into entity service lifecycle to capture changes
    originalCreate = strapi.entityService.create;
    originalUpdate = strapi.entityService.update;

    strapi.entityService.create = async function (uid: string, opts: any): Promise<any> {
      // Call original create
      const result = await originalCreate.call(this, uid, opts);

      // Skip versioning for content-version itself and core models
      if (
        uid === CONTENT_VERSION_UID ||
        uid.startsWith('admin::') ||
        uid.startsWith('plugin::')
      ) {
        return result;
      }

      // Record version for create action
      try {
        const locale = opts?.data?.locale || 'en';
        const service = (strapi.service('api::content-version.content-version-tracking') as any);
        if (service && result) {
          // Use documentId (Strapi v5 standard) or fallback to id
          const entryId = (result as any).documentId || (result as any).id;
          await service.recordVersion(uid, entryId, locale, {
            actionType: 'create',
            previousData: {},
            newData: result,
            draftState: !(result as any)?.publishedAt,
            publishedState: !!(result as any)?.publishedAt,
          });
        }
      } catch (error) {
        console.warn('[Versioning] Failed to record version for create:', error);
      }

      return result;
    };

    strapi.entityService.update = async function (
      uid: string,
      id: string | number,
      opts: any
    ): Promise<any> {
      // Get previous state before updating using the original method before we replaced it
      let previousData: Record<string, any> = {};
      try {
        // Try to get current state - use strapi instance from context
        const current = await (strapi.entityService as any).findOne(uid, id, { populate: '*' });
        if (current) {
          previousData = JSON.parse(JSON.stringify(current));
        }
      } catch (error) {
        // If we can't get previous state, continue anyway
        console.warn('[Versioning] Failed to get previous data:', error);
      }

      // Call original update
      const result = await originalUpdate.call(this, uid, id, opts);

      // Skip versioning for content-version itself and core models
      if (
        uid === CONTENT_VERSION_UID ||
        uid.startsWith('admin::') ||
        uid.startsWith('plugin::')
      ) {
        return result;
      }

      // Record version for update action
      try {
        const locale = opts?.data?.locale || (previousData as any)?.locale || 'en';
        const service = (strapi.service('api::content-version.content-version-tracking') as any);
        if (service && result) {
          // Determine action type based on publish state
          let actionType: 'update' | 'publish' | 'unpublish' = 'update';
          const wasPreviouslyPublished = !!(previousData as any)?.publishedAt;
          const isNowPublished = !!(result as any)?.publishedAt;

          if (!wasPreviouslyPublished && isNowPublished) {
            actionType = 'publish';
          } else if (wasPreviouslyPublished && !isNowPublished) {
            actionType = 'unpublish';
          }

          const changedFields = service.calculateChangedFields(
            previousData,
            opts?.data || {}
          );

          // Use documentId (Strapi v5 standard) or fallback to id
          const entryId = (result as any).documentId || (id as string);
          await service.recordVersion(uid, entryId, locale, {
            actionType,
            previousData,
            newData: result,
            draftState: !(result as any)?.publishedAt,
            publishedState: !!(result as any)?.publishedAt,
            changedFields,
          });
        }
      } catch (error) {
        console.warn('[Versioning] Failed to record version for update:', error);
      }

      return result;
    };
  },

  /**
   * An asynchronous bootstrap function that runs before
   * your application gets started.
   *
   * This gives you an opportunity to set up your data model,
   * run jobs, or perform some special logic.
   */
  bootstrap({ strapi }: { strapi: Core.Strapi }) {
    console.log('✅ Content versioning system initialized');
  },
};
