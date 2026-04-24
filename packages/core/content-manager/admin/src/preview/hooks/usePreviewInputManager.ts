import * as React from 'react';

import { useField } from '@strapi/admin/strapi-admin';
import { Schema, UID } from '@strapi/types';

import { useHasInputPopoverParent } from '../components/InputPopover';
import { usePreviewContext } from '../pages/Preview';
import { INTERNAL_EVENTS } from '../utils/constants';
import { getSendMessage } from '../utils/getSendMessage';
import { encodeBlocksOverride, encodeMediaOverride } from '../utils/overrideStega';
import { resolveMediaUrl } from '../utils/resolveMediaUrl';
import { isSameShapeMediaChange, isTextLeafOnlyBlocksChange } from '../utils/routing';

type PreviewInputProps = Pick<
  Required<React.InputHTMLAttributes<HTMLInputElement>>,
  'onFocus' | 'onBlur'
>;

const SKIPPED_TYPES = new Set<Schema.Attribute.AnyAttribute['type']>(['component', 'dynamiczone']);

export function usePreviewInputManager(
  name: string,
  attribute: Schema.Attribute.AnyAttribute
): PreviewInputProps {
  const iframe = usePreviewContext('usePreviewInputManager', (state) => state.iframeRef, false);
  const setPopoverField = usePreviewContext(
    'usePreviewInputManager',
    (state) => state.setPopoverField,
    false
  );
  const features = usePreviewContext('usePreviewInputManager', (state) => state.features, false);
  const document = usePreviewContext('usePreviewInputManager', (state) => state.document, false);
  const schema = usePreviewContext('usePreviewInputManager', (state) => state.schema, false);
  const hasInputPopoverParent = useHasInputPopoverParent();
  const { value } = useField(name);
  const { type } = attribute;

  /**
   * Previous value for routing-time diff. Distinct from the popover ref below
   * because the two effects read "previous" at different moments in the render
   * cycle.
   */
  const routingPrevRef = React.useRef<unknown>(undefined);

  React.useEffect(() => {
    if (!iframe || !type) {
      return;
    }

    if (SKIPPED_TYPES.has(type)) {
      return;
    }

    const sendMessage = getSendMessage(iframe);
    const prev = routingPrevRef.current;

    /**
     * Hybrid routing — per edit, pick the channel based on the prev/next diff
     * and the iframe's advertised capabilities.
     *
     * Safe attribute-level edits (same-type media src swap, blocks text-leaf
     * typing) go via `strapiFieldChange` and are patched in the injected
     * preview script with no consumer-side work.
     *
     * Structural edits (cross-type media, multi-value, null, blocks add /
     * remove / reorder) go via `strapiFieldOverride` and require the iframe
     * to have advertised the matching `features` entry — otherwise we no-op,
     * matching today's "no live preview for this edit" behavior.
     */
    const stegaBase =
      document && schema
        ? {
            documentId: document.documentId,
            model: schema.uid as UID.Schema,
            kind: schema.kind,
            locale: document.locale ?? null,
          }
        : null;

    if (type === 'media') {
      // Relative upload URLs (e.g. `/uploads/a.png`) resolve against the admin
      // origin while the value lives in the admin, but would resolve against
      // the iframe's origin on the other side of the postMessage boundary.
      // Normalize here so every consumer — same-origin or cross-origin — gets
      // an absolute URL it can render or patch without extra work.
      const resolvedValue = resolveMediaUrl(value);
      if (isSameShapeMediaChange(prev, value)) {
        sendMessage(INTERNAL_EVENTS.STRAPI_FIELD_CHANGE, { field: name, value: resolvedValue });
      } else if (features?.includes('media')) {
        // Stega-encode the outgoing override so click-to-focus on unsaved media
        // resolves to the same field as saved media (parity with server encoding).
        const encoded = stegaBase
          ? encodeMediaOverride(resolvedValue, { ...stegaBase, path: name })
          : resolvedValue;
        sendMessage(INTERNAL_EVENTS.STRAPI_FIELD_OVERRIDE, { path: name, value: encoded });
      }
      routingPrevRef.current = value;
      return;
    }

    if (type === 'blocks') {
      if (isTextLeafOnlyBlocksChange(prev, value)) {
        sendMessage(INTERNAL_EVENTS.STRAPI_FIELD_CHANGE, { field: name, value });
      } else if (features?.includes('blocks')) {
        const encoded = stegaBase
          ? encodeBlocksOverride(value, { ...stegaBase, path: name })
          : value;
        sendMessage(INTERNAL_EVENTS.STRAPI_FIELD_OVERRIDE, { path: name, value: encoded });
      }
      routingPrevRef.current = value;
      return;
    }

    sendMessage(INTERNAL_EVENTS.STRAPI_FIELD_CHANGE, { field: name, value });
    routingPrevRef.current = value;
  }, [name, value, iframe, type, features, document, schema]);

  const popoverPrevRef = React.useRef(value);

  React.useEffect(() => {
    if (!hasInputPopoverParent || !setPopoverField || type !== 'media') {
      return;
    }

    const currentValue = value;
    const previousValue = popoverPrevRef.current;

    const hadValue =
      previousValue != null && (Array.isArray(previousValue) ? previousValue.length > 0 : true);
    const hasNoValue =
      currentValue == null || (Array.isArray(currentValue) ? currentValue.length === 0 : false);

    if (hadValue && hasNoValue) {
      setPopoverField(null);
    }

    popoverPrevRef.current = currentValue;
  }, [value, hasInputPopoverParent, setPopoverField, type]);

  const sendMessage = getSendMessage(iframe);

  return {
    onFocus: () => {
      if (hasInputPopoverParent) return;

      sendMessage(INTERNAL_EVENTS.STRAPI_FIELD_FOCUS, { field: name });
    },
    onBlur: () => {
      if (hasInputPopoverParent) return;

      setPopoverField?.(null);
      sendMessage(INTERNAL_EVENTS.STRAPI_FIELD_BLUR, { field: name });
    },
  };
}
