import { vercelStegaCombine } from '@vercel/stega';

import type { FieldContentSourceMap } from '@strapi/admin/strapi-admin';
import type { UID } from '@strapi/types';

/**
 * Admin-side stega encoding for outgoing `strapiFieldOverride` payloads.
 *
 * The payload shape must mirror the server's
 * `packages/core/core/src/services/content-source-maps.ts` encoding so that
 * click-to-focus resolves the same fields for saved and unsaved content.
 * A parity test lives alongside this file.
 */

type OverrideEncodingBase = Omit<FieldContentSourceMap, 'path' | 'type' | 'fieldPath'> & {
  kind?: FieldContentSourceMap['kind'];
  locale?: string | null;
};

type EncodeFieldInput = Omit<FieldContentSourceMap, 'fieldPath'> & {
  fieldPath?: string;
};

const isObject = (value: unknown): value is Record<string, any> => {
  return typeof value === 'object' && value !== null;
};

const isBlocksLikeValue = (value: unknown): boolean => {
  if (!Array.isArray(value)) {
    return false;
  }

  return value.every((node) => {
    if (!isObject(node)) {
      return false;
    }

    return typeof node.type === 'string' && Array.isArray(node.children);
  });
};

export function encodeField(
  text: string,
  { kind, model, documentId, type, path, locale, fieldPath }: EncodeFieldInput
): string {
  const strapiSource = new URLSearchParams();
  strapiSource.set('documentId', documentId);
  strapiSource.set('type', type);
  strapiSource.set('path', path);

  if (model) {
    strapiSource.set('model', model);
  }
  if (kind) {
    strapiSource.set('kind', kind);
  }
  if (locale) {
    strapiSource.set('locale', locale);
  }
  if (fieldPath && fieldPath !== path) {
    strapiSource.set('fieldPath', fieldPath);
  }

  return vercelStegaCombine(text, { strapiSource: strapiSource.toString() }, false);
}

export function encodeBlocks(
  blocks: unknown,
  base: OverrideEncodingBase & { path: string; fieldPath: string }
): unknown {
  const visitNode = (node: unknown, currentPath: string): unknown => {
    if (Array.isArray(node)) {
      return node.map((child, index) => visitNode(child, `${currentPath}.${index}`));
    }

    if (!isObject(node)) {
      return node;
    }

    return Object.entries(node).reduce(
      (acc, [nodeKey, nodeValue]) => {
        if (nodeKey === 'text' && typeof nodeValue === 'string') {
          acc[nodeKey] = encodeField(nodeValue, {
            ...base,
            path: `${currentPath}.text`,
            type: 'blocks',
            fieldPath: base.fieldPath,
          });
          return acc;
        }

        if (nodeKey === 'children' && Array.isArray(nodeValue)) {
          acc[nodeKey] = nodeValue.map((child, index) =>
            visitNode(child, `${currentPath}.children.${index}`)
          );
          return acc;
        }

        acc[nodeKey] = nodeValue;
        return acc;
      },
      {} as Record<string, unknown>
    );
  };

  return visitNode(blocks, base.path);
}

type MediaItem = { url?: unknown } & Record<string, unknown>;

const encodeMediaItem = (item: MediaItem, base: OverrideEncodingBase, path: string): MediaItem => {
  if (typeof item.url !== 'string') {
    return item;
  }

  return {
    ...item,
    url: encodeField(item.url, {
      ...base,
      path: `${path}.url`,
      type: 'media',
      model: base.model as UID.Schema | undefined,
    }),
  };
};

/**
 * Encode the stega `strapiSource` payload on a media override value. Handles
 * the single-value case (`{ url, ... }`) and the multi-value case
 * (`[{ url, ... }, ...]`). Non-string `url` values are passed through.
 */
export function encodeMediaOverride(value: unknown, base: OverrideEncodingBase & { path: string }) {
  if (value == null) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry, index) =>
      isObject(entry) ? encodeMediaItem(entry as MediaItem, base, `${base.path}.${index}`) : entry
    );
  }

  if (isObject(value)) {
    return encodeMediaItem(value as MediaItem, base, base.path);
  }

  return value;
}

/**
 * Encode the stega `strapiSource` payload on a blocks override value. `path`
 * and `fieldPath` both point at the blocks attribute; leaf `path`s are built
 * during tree descent.
 */
export function encodeBlocksOverride(
  value: unknown,
  base: OverrideEncodingBase & { path: string }
) {
  if (!isBlocksLikeValue(value)) {
    return value;
  }

  return encodeBlocks(value, { ...base, fieldPath: base.path });
}
