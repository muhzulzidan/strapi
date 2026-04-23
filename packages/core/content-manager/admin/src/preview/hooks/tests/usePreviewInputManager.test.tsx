/* eslint-disable check-file/filename-naming-convention */
// Test file is named after the camelCase hook it exercises.

import * as React from 'react';

import { Form } from '@strapi/admin/strapi-admin';
import { renderHook } from '@tests/utils';

import { usePreviewContext } from '../../pages/Preview';
import { usePreviewInputManager } from '../usePreviewInputManager';

import type { Schema } from '@strapi/types';

jest.mock('../../pages/Preview', () => ({
  usePreviewContext: jest.fn(),
}));

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
