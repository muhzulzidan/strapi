import type { Core } from '@strapi/strapi';

type WebhookFilterMap = Record<string, string[]>;

type EntryWebhookEvent =
  | 'entry.create'
  | 'entry.update'
  | 'entry.delete'
  | 'entry.publish'
  | 'entry.unpublish'
  | 'entry.draft-discard';

const FILTER_STORE_CONFIG = {
  type: 'core',
  name: 'admin',
  key: 'webhook-content-type-filters',
} as const;

const ENTRY_EVENTS = new Set<EntryWebhookEvent>([
  'entry.create',
  'entry.update',
  'entry.delete',
  'entry.publish',
  'entry.unpublish',
  'entry.draft-discard',
]);

let webhookFilterMap: WebhookFilterMap = {};
let isFilterMapLoaded = false;

const normalizeContentTypeUids = (value: unknown): string[] => {
  const raw = Array.isArray(value) ? value : [];

  return Array.from(
    new Set(
      raw
        .filter((uid): uid is string => typeof uid === 'string')
        .map((uid) => uid.trim())
        .filter((uid) => uid.length > 0 && uid.includes('::'))
    )
  );
};

const normalizeFilterMap = (value: unknown): WebhookFilterMap => {
  if (!value || typeof value !== 'object') {
    return {};
  }

  return Object.entries(value as Record<string, unknown>).reduce<WebhookFilterMap>(
    (acc, [id, uids]) => {
      acc[id] = normalizeContentTypeUids(uids);
      return acc;
    },
    {}
  );
};

const hasEntryEvents = (events: unknown): boolean => {
  if (!Array.isArray(events)) {
    return false;
  }
  return events.some(
    (event) => typeof event === 'string' && ENTRY_EVENTS.has(event as EntryWebhookEvent)
  );
};

const getWebhookFilter = (webhookId: string | number | undefined | null): string[] => {
  if (webhookId === undefined || webhookId === null) {
    return [];
  }
  return webhookFilterMap[String(webhookId)] ?? [];
};

const setWebhookFilter = (webhookId: string | number, contentTypes: string[]): void => {
  webhookFilterMap[String(webhookId)] = normalizeContentTypeUids(contentTypes);
};

const deleteWebhookFilter = (webhookId: string | number): void => {
  delete webhookFilterMap[String(webhookId)];
};

const ensureFilterMapLoaded = async (strapiInstance: Core.Strapi): Promise<void> => {
  if (isFilterMapLoaded) {
    return;
  }
  const pluginStore = strapiInstance.store(FILTER_STORE_CONFIG);
  const current = await pluginStore.get();
  webhookFilterMap = normalizeFilterMap(current);
  isFilterMapLoaded = true;
};

const persistFilterMap = async (strapiInstance: Core.Strapi): Promise<void> => {
  const pluginStore = strapiInstance.store(FILTER_STORE_CONFIG);
  await pluginStore.set({ value: webhookFilterMap });
};

const withContentTypeFilters = <T extends { id?: string | number }>(
  webhook: T
): T & { contentTypes: string[] } => {
  return {
    ...webhook,
    contentTypes: getWebhookFilter(webhook.id),
  };
};

const buildContentTypeAliasLookup = (strapiInstance: Core.Strapi): Map<string, string> => {
  const lookup = new Map<string, string>();

  for (const [uid, schema] of Object.entries(strapiInstance.contentTypes)) {
    if (!uid.startsWith('api::')) {
      continue;
    }

    const aliases = [
      uid,
      uid.replace(/^api::/, ''),
      uid.split('.').at(1),
      (schema as any)?.modelName,
      (schema as any)?.collectionName,
      (schema as any)?.info?.singularName,
      (schema as any)?.info?.pluralName,
    ].filter((alias): alias is string => typeof alias === 'string' && alias.trim().length > 0);

    for (const alias of aliases) {
      lookup.set(alias.toLowerCase(), uid);
    }
  }

  return lookup;
};

const resolveEntryEventContentTypeUid = (
  aliasLookup: Map<string, string>,
  info: Record<string, any> | undefined
): string | null => {
  const directUid = info?.uid;
  if (typeof directUid === 'string' && directUid.includes('::')) {
    return directUid;
  }

  const model = info?.model;
  if (typeof model === 'string') {
    if (model.includes('::')) {
      return model;
    }

    const resolved = aliasLookup.get(model.toLowerCase());
    if (resolved) {
      return resolved;
    }
  }

  return null;
};

export const shouldDeliverEntryEvent = (
  event: string,
  allowedContentTypes: string[],
  resolvedEventContentTypeUid: string | null
): boolean => {
  if (!ENTRY_EVENTS.has(event as EntryWebhookEvent)) {
    return true;
  }
  if (!allowedContentTypes.length) {
    return false;
  }
  if (!resolvedEventContentTypeUid) {
    return false;
  }
  return allowedContentTypes.includes(resolvedEventContentTypeUid);
};

const removeContentTypesFromBody = (
  ctx: any
): { contentTypes: string[]; hasContentTypesKey: boolean } => {
  const body = ctx.request?.body ?? {};
  const hasContentTypesKey = Object.prototype.hasOwnProperty.call(body, 'contentTypes');
  const contentTypes = normalizeContentTypeUids(body.contentTypes);

  if (hasContentTypesKey) {
    const nextBody = { ...body };
    delete nextBody.contentTypes;
    ctx.request.body = nextBody;
  }

  return { contentTypes, hasContentTypesKey };
};

/**
 * Override admin webhook controllers in-place so the custom `contentTypes`
 * field is stripped from the payload before Strapi's yup `.noUnknown()`
 * validator runs, and is persisted to / hydrated from a separate core store.
 *
 * Must be invoked during the user `register` lifecycle (admin controllers
 * are registered by then).
 */
export const applyWebhookControllerOverrides = (strapiInstance: Core.Strapi): void => {
  const controllersRegistry: any = (strapiInstance as any).get('controllers');
  const webhooksUid = 'admin::webhooks';

  if (typeof controllersRegistry?.extend !== 'function') {
    strapiInstance.log?.warn?.(
      '[webhook-filter] strapi.controllers.extend is not available; skipping override'
    );
    return;
  }

  const current = controllersRegistry.get(webhooksUid);
  if (!current) {
    strapiInstance.log?.warn?.(
      `[webhook-filter] controller ${webhooksUid} not found; skipping override`
    );
    return;
  }

  if ((current as any).__contentTypeFilterPatched) {
    return;
  }

  controllersRegistry.extend(webhooksUid, (original: any) => {
    const wrapped: any = { ...original };

    wrapped.listWebhooks = async (ctx: any) => {
      await ensureFilterMapLoaded(strapiInstance);
      await original.listWebhooks.call(original, ctx);
      if (Array.isArray(ctx.body?.data)) {
        ctx.body.data = ctx.body.data.map((webhook: any) => withContentTypeFilters(webhook));
      }
    };

    wrapped.getWebhook = async (ctx: any) => {
      await ensureFilterMapLoaded(strapiInstance);
      await original.getWebhook.call(original, ctx);
      if (ctx.body?.data) {
        ctx.body.data = withContentTypeFilters(ctx.body.data);
      }
    };

    wrapped.createWebhook = async (ctx: any) => {
      await ensureFilterMapLoaded(strapiInstance);
      const { contentTypes } = removeContentTypesFromBody(ctx);
      const events = ctx.request?.body?.events;

      if (hasEntryEvents(events) && contentTypes.length === 0) {
        return ctx.badRequest(
          'Select at least one content type when entry events are enabled.'
        );
      }

      await original.createWebhook.call(original, ctx);

      if (ctx.body?.data?.id) {
        setWebhookFilter(ctx.body.data.id, contentTypes);
        await persistFilterMap(strapiInstance);
        ctx.body.data = withContentTypeFilters(ctx.body.data);
      }
    };

    wrapped.updateWebhook = async (ctx: any) => {
      await ensureFilterMapLoaded(strapiInstance);

      const webhookId = ctx.params?.id;
      const previousWebhook = await strapiInstance.get('webhookStore').findWebhook(webhookId);

      if (!previousWebhook) {
        return ctx.notFound('webhook.notFound');
      }

      const { contentTypes, hasContentTypesKey } = removeContentTypesFromBody(ctx);
      const nextEvents = ctx.request?.body?.events ?? previousWebhook.events;
      const nextContentTypes = hasContentTypesKey ? contentTypes : getWebhookFilter(webhookId);

      if (hasEntryEvents(nextEvents) && nextContentTypes.length === 0) {
        return ctx.badRequest(
          'Select at least one content type when entry events are enabled.'
        );
      }

      await original.updateWebhook.call(original, ctx);

      if (hasContentTypesKey) {
        setWebhookFilter(webhookId, nextContentTypes);
        await persistFilterMap(strapiInstance);
      }

      if (ctx.body?.data) {
        ctx.body.data = withContentTypeFilters(ctx.body.data);
      }
    };

    wrapped.deleteWebhook = async (ctx: any) => {
      await ensureFilterMapLoaded(strapiInstance);
      await original.deleteWebhook.call(original, ctx);
      if (ctx.params?.id) {
        deleteWebhookFilter(ctx.params.id);
        await persistFilterMap(strapiInstance);
      }
    };

    wrapped.deleteWebhooks = async (ctx: any) => {
      await ensureFilterMapLoaded(strapiInstance);
      const ids = Array.isArray(ctx.request?.body?.ids)
        ? ctx.request.body.ids.map((id: unknown) => String(id))
        : [];
      await original.deleteWebhooks.call(original, ctx);
      if (ids.length > 0) {
        ids.forEach((id: string) => deleteWebhookFilter(id));
        await persistFilterMap(strapiInstance);
      }
    };

    wrapped.__contentTypeFilterPatched = true;
    return wrapped;
  });

  strapiInstance.log?.info?.('[webhook-filter] admin::webhooks controller overrides applied');
};

/**
 * Wrap the webhook runner's `run` method so entry events only fire for
 * configured content types. Safe to call during bootstrap.
 */
export const patchWebhookRunnerWithContentTypeFilter = async (
  strapiInstance: Core.Strapi
): Promise<void> => {
  await ensureFilterMapLoaded(strapiInstance);

  const webhookRunner = strapiInstance.get('webhookRunner') as any;

  if (!webhookRunner || webhookRunner.__contentTypeFilterPatched) {
    return;
  }

  const originalRun = webhookRunner.run.bind(webhookRunner);
  const aliasLookup = buildContentTypeAliasLookup(strapiInstance);

  webhookRunner.run = async (webhook: any, event: string, info: Record<string, any> = {}) => {
    const allowedContentTypes = getWebhookFilter(webhook?.id);
    const resolvedUid = resolveEntryEventContentTypeUid(aliasLookup, info);

    if (!shouldDeliverEntryEvent(event, allowedContentTypes, resolvedUid)) {
      return {
        statusCode: 204,
        message: 'Skipped by webhook content-type filter',
      };
    }

    return originalRun(webhook, event, info);
  };

  webhookRunner.__contentTypeFilterPatched = true;
  strapiInstance.log?.info?.('[webhook-filter] webhookRunner.run patched');
};
