/* eslint-disable check-file/filename-naming-convention */
// Test file is named after the camelCase hook it exercises.

import * as React from 'react';

import { Form, useField } from '@strapi/admin/strapi-admin';
import { act, renderHook } from '@tests/utils';
import { vercelStegaDecode } from '@vercel/stega';

import { usePreviewContext } from '../../pages/Preview';
import { usePreviewInputManager } from '../usePreviewInputManager';

import type { Schema } from '@strapi/types';

jest.mock('../../pages/Preview', () => ({
  usePreviewContext: jest.fn(),
}));

const decodeSourceParams = (value: unknown) => {
  if (typeof value !== 'string') return null;
  const decoded = vercelStegaDecode(value);
  if (!decoded || typeof decoded !== 'object' || !('strapiSource' in decoded)) return null;
  return new URLSearchParams((decoded as { strapiSource: string }).strapiSource);
};

const IFRAME_ORIGIN = 'http://iframe.test';

const makeIframeRef = (postMessage: jest.Mock) => ({
  current: {
    src: `${IFRAME_ORIGIN}/`,
    contentWindow: { postMessage },
  },
});

type PreviewState = {
  iframeRef: ReturnType<typeof makeIframeRef> | null;
  features: readonly string[];
  setPopoverField: jest.Mock;
  document?: { documentId: string; locale?: string | null };
  schema?: { uid: string; kind: 'collectionType' | 'singleType' };
};

const mockPreviewContext = (state: PreviewState) => {
  (usePreviewContext as jest.Mock).mockImplementation(
    (_caller: string, selector: (s: PreviewState) => unknown) => selector(state)
  );
};

const createWrapper = (initialValues: Record<string, unknown>) =>
  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <Form method="POST" initialValues={initialValues} onSubmit={jest.fn()}>
        {children}
      </Form>
    );
  };

const attribute = (type: Schema.Attribute.AnyAttribute['type']) =>
  ({ type }) as Schema.Attribute.AnyAttribute;

describe('usePreviewInputManager routing', () => {
  let postMessage: jest.Mock;
  let iframeRef: ReturnType<typeof makeIframeRef>;

  beforeEach(() => {
    postMessage = jest.fn();
    iframeRef = makeIframeRef(postMessage);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('posts strapiFieldChange for non-media/non-blocks fields regardless of advertised features', () => {
    mockPreviewContext({
      iframeRef,
      features: [],
      setPopoverField: jest.fn(),
    });

    renderHook(() => usePreviewInputManager('title', attribute('string')), {
      wrapper: createWrapper({ title: 'Hello' }),
    });

    expect(postMessage).toHaveBeenCalledWith(
      { type: 'strapiFieldChange', payload: { field: 'title', value: 'Hello' } },
      IFRAME_ORIGIN
    );
  });

  it('posts strapiFieldOverride for a media field on first mount when the iframe advertised media (null → value is structural)', () => {
    const mediaValue = { url: '/uploads/a.png', mime: 'image/png' };
    mockPreviewContext({
      iframeRef,
      features: ['media'],
      setPopoverField: jest.fn(),
    });

    renderHook(() => usePreviewInputManager('hero', attribute('media')), {
      wrapper: createWrapper({ hero: mediaValue }),
    });

    // Media urls are absolutized to the admin origin at the send site so
    // cross-origin iframes can consume them directly.
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith(
      {
        type: 'strapiFieldOverride',
        payload: {
          path: 'hero',
          value: { url: `${window.location.origin}/uploads/a.png`, mime: 'image/png' },
        },
      },
      IFRAME_ORIGIN
    );
  });

  it('posts nothing for media fields when the iframe did not advertise the media capability', () => {
    mockPreviewContext({
      iframeRef,
      features: [],
      setPopoverField: jest.fn(),
    });

    renderHook(() => usePreviewInputManager('hero', attribute('media')), {
      wrapper: createWrapper({ hero: { url: '/uploads/a.png', mime: 'image/png' } }),
    });

    expect(postMessage).not.toHaveBeenCalled();
  });

  it('posts strapiFieldOverride for a blocks field on first mount when the iframe advertised blocks', () => {
    const blocksValue = [{ type: 'paragraph', children: [{ text: 'hello' }] }];
    mockPreviewContext({
      iframeRef,
      features: ['blocks'],
      setPopoverField: jest.fn(),
    });

    renderHook(() => usePreviewInputManager('body', attribute('blocks')), {
      wrapper: createWrapper({ body: blocksValue }),
    });

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith(
      { type: 'strapiFieldOverride', payload: { path: 'body', value: blocksValue } },
      IFRAME_ORIGIN
    );
  });

  it('posts nothing for a blocks field when the iframe did not advertise the blocks capability', () => {
    const blocksValue = [{ type: 'paragraph', children: [{ text: 'hello' }] }];
    mockPreviewContext({
      iframeRef,
      features: ['media'], // only media, not blocks
      setPopoverField: jest.fn(),
    });

    renderHook(() => usePreviewInputManager('body', attribute('blocks')), {
      wrapper: createWrapper({ body: blocksValue }),
    });

    expect(postMessage).not.toHaveBeenCalled();
  });

  it('posts nothing for component and dynamiczone fields (children dispatch their own events)', () => {
    mockPreviewContext({
      iframeRef,
      features: ['media', 'blocks'],
      setPopoverField: jest.fn(),
    });

    const { rerender } = renderHook(
      ({ type }: { type: Schema.Attribute.AnyAttribute['type'] }) =>
        usePreviewInputManager('container', attribute(type)),
      {
        wrapper: createWrapper({ container: {} }),
        initialProps: { type: 'component' },
      }
    );

    expect(postMessage).not.toHaveBeenCalled();

    rerender({ type: 'dynamiczone' });
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('stega-encodes media override url when document + schema context is available', () => {
    mockPreviewContext({
      iframeRef,
      features: ['media'],
      setPopoverField: jest.fn(),
      document: { documentId: 'doc-1', locale: 'en' },
      schema: { uid: 'api::article.article', kind: 'collectionType' },
    });

    renderHook(() => usePreviewInputManager('hero', attribute('media')), {
      wrapper: createWrapper({ hero: { url: '/uploads/a.png', mime: 'image/png' } }),
    });

    const [message] = postMessage.mock.calls[0];
    expect(message.type).toBe('strapiFieldOverride');
    expect(message.payload.path).toBe('hero');

    const params = decodeSourceParams(message.payload.value.url);
    expect(params?.get('path')).toBe('hero.url');
    expect(params?.get('type')).toBe('media');
    expect(params?.get('documentId')).toBe('doc-1');
    expect(params?.get('model')).toBe('api::article.article');
    expect(params?.get('locale')).toBe('en');
    expect(message.payload.value.mime).toBe('image/png');
  });

  it('stega-encodes blocks override text leaves with ancestor fieldPath when context is available', () => {
    const blocksValue = [{ type: 'paragraph', children: [{ type: 'text', text: 'hello' }] }];
    mockPreviewContext({
      iframeRef,
      features: ['blocks'],
      setPopoverField: jest.fn(),
      document: { documentId: 'doc-1', locale: 'en' },
      schema: { uid: 'api::article.article', kind: 'collectionType' },
    });

    renderHook(() => usePreviewInputManager('body', attribute('blocks')), {
      wrapper: createWrapper({ body: blocksValue }),
    });

    const [message] = postMessage.mock.calls[0];
    expect(message.type).toBe('strapiFieldOverride');
    expect(message.payload.path).toBe('body');

    const leafParams = decodeSourceParams(message.payload.value[0].children[0].text);
    expect(leafParams?.get('path')).toBe('body.0.children.0.text');
    expect(leafParams?.get('fieldPath')).toBe('body');
    expect(leafParams?.get('type')).toBe('blocks');
  });

  it('does not post anything when there is no iframe connected', () => {
    mockPreviewContext({
      iframeRef: null,
      features: ['media', 'blocks'],
      setPopoverField: jest.fn(),
    });

    renderHook(() => usePreviewInputManager('title', attribute('string')), {
      wrapper: createWrapper({ title: 'Hello' }),
    });

    expect(postMessage).not.toHaveBeenCalled();
  });
});

/**
 * Routing matrix regression guard (slice #07).
 *
 * These tests assert the exact message (or absence of one) the admin posts for
 * every combination of field type × diff result × advertised features. The
 * hybrid routing gate in `usePreviewInputManager` is the protocol-critical
 * surface the PRD flags as most at risk of regression — silently routing a
 * safe edit down the structural channel would double-send to v2 consumers and
 * break v1 consumers.
 *
 * Test harness note: `usePreviewInputManager` is paired with `useField` so the
 * test can drive subsequent edits through `onChange`, exercising the
 * prev/next diff branches (same-type media swap, blocks leaf-only, feature
 * re-advertisement). Just mounting with different initial values only covers
 * the first-render `prev = undefined` case.
 */
describe('usePreviewInputManager routing matrix', () => {
  let postMessage: jest.Mock;
  let iframeRef: ReturnType<typeof makeIframeRef>;

  const useHarness = (name: string, attr: Schema.Attribute.AnyAttribute) => {
    usePreviewInputManager(name, attr);
    const { onChange } = useField(name);
    return onChange;
  };

  const mountHarness = (
    name: string,
    attr: Schema.Attribute.AnyAttribute,
    initialValues: Record<string, unknown>
  ) =>
    renderHook(() => useHarness(name, attr), {
      wrapper: createWrapper(initialValues),
    });

  const edit = (
    result: { current: (path: string, value: unknown) => void },
    name: string,
    value: unknown
  ) => {
    act(() => {
      result.current(name, value);
    });
  };

  const messagesForField = (fieldName: string) =>
    postMessage.mock.calls
      .map(([message]) => message)
      .filter((m) => m.payload?.field === fieldName || m.payload?.path === fieldName);

  beforeEach(() => {
    postMessage = jest.fn();
    iframeRef = makeIframeRef(postMessage);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  /* ---------------------- Mechanism 1 (strapiFieldChange) --------------------- */

  it('same-category media swap (image/png → image/jpeg) routes via strapiFieldChange regardless of advertised features', () => {
    const cases: ReadonlyArray<readonly string[]> = [
      ['media'],
      ['blocks'],
      [],
      ['media', 'blocks'],
    ];
    for (const features of cases) {
      mockPreviewContext({ iframeRef, features, setPopoverField: jest.fn() });

      const { result } = mountHarness('hero', attribute('media'), {
        hero: { url: '/a.png', mime: 'image/png' },
      });
      // Clear mount-time traffic so we can assert only the edit's effect.
      postMessage.mockClear();

      edit(result, 'hero', { url: '/b.jpg', mime: 'image/jpeg' });

      const posted = messagesForField('hero');
      expect(posted).toHaveLength(1);
      expect(posted[0].type).toBe('strapiFieldChange');
      expect(posted[0].payload.value.mime).toBe('image/jpeg');
    }
  });

  it('blocks leaf-only edit routes via strapiFieldChange regardless of advertised features', () => {
    const cases: ReadonlyArray<readonly string[]> = [
      ['blocks'],
      ['media'],
      [],
      ['media', 'blocks'],
    ];
    for (const features of cases) {
      mockPreviewContext({ iframeRef, features, setPopoverField: jest.fn() });

      const { result } = mountHarness('body', attribute('blocks'), {
        body: [{ type: 'paragraph', children: [{ text: 'hello' }] }],
      });
      postMessage.mockClear();

      edit(result, 'body', [{ type: 'paragraph', children: [{ text: 'hello world' }] }]);

      const posted = messagesForField('body');
      expect(posted).toHaveLength(1);
      expect(posted[0].type).toBe('strapiFieldChange');
    }
  });

  /* --------------------- Mechanism 2 (strapiFieldOverride) -------------------- */

  it('media cross-type swap (image → video) routes via strapiFieldOverride when media is advertised', () => {
    mockPreviewContext({ iframeRef, features: ['media'], setPopoverField: jest.fn() });

    const { result } = mountHarness('hero', attribute('media'), {
      hero: { url: '/a.png', mime: 'image/png' },
    });
    postMessage.mockClear();

    edit(result, 'hero', { url: '/b.mp4', mime: 'video/mp4' });

    const posted = messagesForField('hero');
    expect(posted).toHaveLength(1);
    expect(posted[0].type).toBe('strapiFieldOverride');
    expect(posted[0].payload.value.mime).toBe('video/mp4');
  });

  it('media clear (value → null) routes via strapiFieldOverride when media is advertised', () => {
    mockPreviewContext({ iframeRef, features: ['media'], setPopoverField: jest.fn() });

    const { result } = mountHarness('hero', attribute('media'), {
      hero: { url: '/a.png', mime: 'image/png' },
    });
    postMessage.mockClear();

    edit(result, 'hero', null);

    const posted = messagesForField('hero');
    expect(posted).toHaveLength(1);
    expect(posted[0].type).toBe('strapiFieldOverride');
    expect(posted[0].payload.value).toBeNull();
  });

  it('multi-value media add (array-shape diff) routes via strapiFieldOverride when media is advertised', () => {
    mockPreviewContext({ iframeRef, features: ['media'], setPopoverField: jest.fn() });

    const { result } = mountHarness('gallery', attribute('media'), {
      gallery: [{ url: '/a.png', mime: 'image/png' }],
    });
    postMessage.mockClear();

    edit(result, 'gallery', [
      { url: '/a.png', mime: 'image/png' },
      { url: '/b.png', mime: 'image/png' },
    ]);

    const posted = messagesForField('gallery');
    expect(posted).toHaveLength(1);
    expect(posted[0].type).toBe('strapiFieldOverride');
    expect(posted[0].payload.value).toHaveLength(2);
  });

  it('blocks structural edit (add block) routes via strapiFieldOverride when blocks is advertised', () => {
    mockPreviewContext({ iframeRef, features: ['blocks'], setPopoverField: jest.fn() });

    const { result } = mountHarness('body', attribute('blocks'), {
      body: [{ type: 'paragraph', children: [{ text: 'a' }] }],
    });
    postMessage.mockClear();

    edit(result, 'body', [
      { type: 'paragraph', children: [{ text: 'a' }] },
      { type: 'paragraph', children: [{ text: 'b' }] },
    ]);

    const posted = messagesForField('body');
    expect(posted).toHaveLength(1);
    expect(posted[0].type).toBe('strapiFieldOverride');
    expect(posted[0].payload.value).toHaveLength(2);
  });

  /* ----------------------------- No-op branches ----------------------------- */

  it('media cross-type swap is dropped when media is not advertised', () => {
    mockPreviewContext({ iframeRef, features: [], setPopoverField: jest.fn() });

    const { result } = mountHarness('hero', attribute('media'), {
      hero: { url: '/a.png', mime: 'image/png' },
    });
    postMessage.mockClear();

    edit(result, 'hero', { url: '/b.mp4', mime: 'video/mp4' });

    expect(postMessage).not.toHaveBeenCalled();
  });

  it('blocks structural edit is dropped when blocks is not advertised', () => {
    mockPreviewContext({ iframeRef, features: ['media'], setPopoverField: jest.fn() });

    const { result } = mountHarness('body', attribute('blocks'), {
      body: [{ type: 'paragraph', children: [{ text: 'a' }] }],
    });
    postMessage.mockClear();

    edit(result, 'body', [
      { type: 'paragraph', children: [{ text: 'a' }] },
      { type: 'paragraph', children: [{ text: 'b' }] },
    ]);

    expect(postMessage).not.toHaveBeenCalled();
  });

  /* ---------------- Re-handshake with a changed features list ---------------- */

  it('routes against the updated features list after a second handshake reseeds the context', () => {
    // First handshake advertises nothing; a cross-type swap is dropped.
    let state: PreviewState = { iframeRef, features: [], setPopoverField: jest.fn() };
    mockPreviewContext(state);

    const { result, rerender } = mountHarness('hero', attribute('media'), {
      hero: { url: '/a.png', mime: 'image/png' },
    });
    postMessage.mockClear();

    edit(result, 'hero', { url: '/b.mp4', mime: 'video/mp4' });
    expect(messagesForField('hero')).toHaveLength(0);

    // Second handshake advertises media; a subsequent cross-type swap (video →
    // image) must now route as an override. New context object re-triggers
    // the effect's `features` dep.
    state = { iframeRef, features: ['media'], setPopoverField: jest.fn() };
    mockPreviewContext(state);
    rerender();
    postMessage.mockClear();

    edit(result, 'hero', { url: '/c.png', mime: 'image/png' });

    const posted = messagesForField('hero');
    expect(posted).toHaveLength(1);
    expect(posted[0].type).toBe('strapiFieldOverride');
    expect(posted[0].payload.value.mime).toBe('image/png');
  });
});
