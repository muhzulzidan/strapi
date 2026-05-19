import type { Core } from '@strapi/strapi';
import {
  applyWebhookControllerOverrides,
  patchWebhookRunnerWithContentTypeFilter,
} from './webhook-content-type-filter';

const CONTENT_VERSION_UID = 'api::content-version.content-version';
const AUTO_SLUG_UIDS = new Set([
  'api::news.news',
  'api::page.page',
  'api::events.events',
  'api::summits.summits',
  'api::job.job',
  'api::legal-document.legal-document',
]);

const slugify = (value: string): string => {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
};

const applyAutoSlugToData = (uid: string, data: Record<string, any> | undefined): void => {
  if (!AUTO_SLUG_UIDS.has(uid) || !data) {
    return;
  }

  const hasSlug = typeof data.slug === 'string' && data.slug.trim().length > 0;
  const hasTitle = typeof data.title === 'string' && data.title.trim().length > 0;

  if (hasSlug || !hasTitle) {
    return;
  }

  const generatedSlug = slugify(data.title);
  if (generatedSlug) {
    data.slug = generatedSlug;
  }
};

const maybeApplyAutoSlug = (uid: string, opts: any): any => {
  if (!AUTO_SLUG_UIDS.has(uid)) {
    return opts;
  }

  const data = opts?.data;
  if (!data) {
    return opts;
  }

  const nextData = { ...data };
  applyAutoSlugToData(uid, nextData);

  return {
    ...opts,
    data: nextData,
  };
};

const parseCsvEnv = (value: string | undefined): string[] => {
  return (value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
};

const ENTRY_WEBHOOK_URL = process.env.ENTRY_WEBHOOK_URL || '';
const ENTRY_WEBHOOK_AUTH_HEADER = process.env.ENTRY_WEBHOOK_AUTH_HEADER || 'Authorization';
const ENTRY_WEBHOOK_AUTH_VALUE = process.env.ENTRY_WEBHOOK_AUTH_VALUE || '';
const ENTRY_WEBHOOK_FLAG_FIELD = process.env.ENTRY_WEBHOOK_FLAG_FIELD || 'sendToWebhook';
const ENTRY_WEBHOOK_UIDS = new Set(
  parseCsvEnv(
    process.env.ENTRY_WEBHOOK_UIDS ||
      'api::news.news,api::page.page,api::events.events,api::summits.summits,api::job.job,api::legal-document.legal-document'
  )
);

type EntryWebhookAction = 'create' | 'update' | 'delete' | 'publish' | 'unpublish';

const shouldSendEntryWebhook = (
  uid: string,
  entry: Record<string, any> | undefined,
  previousData?: Record<string, any>
): boolean => {
  if (!ENTRY_WEBHOOK_URL || !ENTRY_WEBHOOK_UIDS.has(uid)) {
    return false;
  }

  const currentEnabled = !!entry?.[ENTRY_WEBHOOK_FLAG_FIELD];
  const previousEnabled = !!previousData?.[ENTRY_WEBHOOK_FLAG_FIELD];
  return currentEnabled || previousEnabled;
};

const sendEntryWebhook = async (
  strapi: Core.Strapi,
  uid: string,
  action: EntryWebhookAction,
  entry: Record<string, any> | undefined,
  previousData?: Record<string, any>
): Promise<void> => {
  if (!shouldSendEntryWebhook(uid, entry, previousData)) {
    return;
  }

  const entryId = entry?.documentId || entry?.id || previousData?.documentId || previousData?.id || null;
  const payload = {
    source: 'strapi',
    model: uid,
    action,
    entryId,
    timestamp: new Date().toISOString(),
    data: entry || null,
    previousData: previousData || null,
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (ENTRY_WEBHOOK_AUTH_VALUE) {
    headers[ENTRY_WEBHOOK_AUTH_HEADER] = ENTRY_WEBHOOK_AUTH_VALUE;
  }

  try {
    const response = await fetch(ENTRY_WEBHOOK_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      strapi.log.warn(
        `[EntryWebhook] Delivery failed for ${uid}:${String(entryId)} (${action}) with status ${response.status}`
      );
    }
  } catch (error) {
    strapi.log.warn(`[EntryWebhook] Delivery failed for ${uid}:${String(entryId)} (${action})`);
  }
};

// Store reference to original methods
let originalCreate: any = null;
let originalUpdate: any = null;
let originalDelete: any = null;

export default {
  /**
   * An asynchronous register function that runs before
   * your application is initialized.
   *
   * This gives you an opportunity to extend code.
   */
  register({ strapi }: { strapi: Core.Strapi }) {
    // Override admin webhook controllers to accept the custom `contentTypes`
    // field used by the custom Webhooks admin page. Must run in register so
    // the override is in place before any admin request is handled.
    applyWebhookControllerOverrides(strapi);

    // Hook into entity service lifecycle to capture changes
    originalCreate = strapi.entityService.create;
    originalUpdate = strapi.entityService.update;
    originalDelete = (strapi.entityService as any).delete;

    strapi.entityService.create = async function (uid: string, opts: any): Promise<any> {
      const createOpts = maybeApplyAutoSlug(uid, opts);

      // Call original create
      const result = await originalCreate.call(this, uid, createOpts);

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
        const locale = createOpts?.data?.locale || 'en';
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

      void sendEntryWebhook(strapi, uid, 'create', result as Record<string, any>);

      return result;
    };

    strapi.entityService.update = async function (
      uid: string,
      id: string | number,
      opts: any
    ): Promise<any> {
      const updateOpts = maybeApplyAutoSlug(uid, opts);

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
      const result = await originalUpdate.call(this, uid, id, updateOpts);

      const wasPreviouslyPublished = !!(previousData as any)?.publishedAt;
      const isNowPublished = !!(result as any)?.publishedAt;
      let actionType: 'update' | 'publish' | 'unpublish' = 'update';

      if (!wasPreviouslyPublished && isNowPublished) {
        actionType = 'publish';
      } else if (wasPreviouslyPublished && !isNowPublished) {
        actionType = 'unpublish';
      }

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
        const locale = updateOpts?.data?.locale || (previousData as any)?.locale || 'en';
        const service = (strapi.service('api::content-version.content-version-tracking') as any);
        if (service && result) {
          const changedFields = service.calculateChangedFields(
            previousData,
            updateOpts?.data || {}
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

      void sendEntryWebhook(
        strapi,
        uid,
        actionType,
        result as Record<string, any>,
        previousData
      );

      return result;
    };

    strapi.entityService.delete = async function (
      uid: string,
      id: string | number,
      opts: any
    ): Promise<any> {
      let previousData: Record<string, any> = {};
      try {
        const current = await (strapi.entityService as any).findOne(uid, id, { populate: '*' });
        if (current) {
          previousData = JSON.parse(JSON.stringify(current));
        }
      } catch (error) {
        console.warn('[EntryWebhook] Failed to get previous data for delete:', error);
      }

      const result = await originalDelete.call(this, uid, id, opts);

      if (
        uid !== CONTENT_VERSION_UID &&
        !uid.startsWith('admin::') &&
        !uid.startsWith('plugin::')
      ) {
        void sendEntryWebhook(
          strapi,
          uid,
          'delete',
          (result as Record<string, any>) || previousData,
          previousData
        );
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
  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    // Filter webhook deliveries for entry events by configured content types.
    await patchWebhookRunnerWithContentTypeFilter(strapi);

    strapi.db.lifecycles.subscribe({
      models: Array.from(AUTO_SLUG_UIDS),
      beforeCreate(event) {
        applyAutoSlugToData(event.model.uid, event.params.data as Record<string, any>);
      },
      beforeUpdate(event) {
        applyAutoSlugToData(event.model.uid, event.params.data as Record<string, any>);
      },
    });

    console.log('✅ Content versioning system initialized');
  },
};
