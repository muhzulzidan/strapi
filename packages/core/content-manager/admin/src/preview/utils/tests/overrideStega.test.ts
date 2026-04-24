import { vercelStegaDecode } from '@vercel/stega';

import { encodeBlocksOverride, encodeField, encodeMediaOverride } from '../overrideStega';

const decodeSourceParams = (value: unknown) => {
  if (typeof value !== 'string') return null;
  const decoded = vercelStegaDecode(value);
  if (!decoded || typeof decoded !== 'object' || !('strapiSource' in decoded)) {
    return null;
  }
  return new URLSearchParams((decoded as { strapiSource: string }).strapiSource);
};

const base = {
  documentId: 'doc-1',
  model: 'api::article.article' as any,
  kind: 'collectionType' as const,
  locale: 'en',
};

describe('overrideStega (admin-side outgoing strapiFieldOverride encoder)', () => {
  describe('encodeField', () => {
    it('omits fieldPath from payload when it equals path', () => {
      const encoded = encodeField('hello', {
        ...base,
        type: 'string',
        path: 'title',
        fieldPath: 'title',
      });

      const params = decodeSourceParams(encoded);
      expect(params?.get('path')).toBe('title');
      expect(params?.get('fieldPath')).toBeNull();
    });

    it('includes fieldPath when it differs from path', () => {
      const encoded = encodeField('hello', {
        ...base,
        type: 'blocks',
        path: 'body.0.children.0.text',
        fieldPath: 'body',
      });

      const params = decodeSourceParams(encoded);
      expect(params?.get('path')).toBe('body.0.children.0.text');
      expect(params?.get('fieldPath')).toBe('body');
    });
  });

  describe('encodeMediaOverride', () => {
    it('stega-encodes url on a single-value media override', () => {
      const value = { url: '/uploads/a.png', mime: 'image/png', alternativeText: 'Alt' };
      const encoded = encodeMediaOverride(value, { ...base, path: 'cover' }) as typeof value;

      expect(encoded.mime).toBe('image/png');
      expect(encoded.alternativeText).toBe('Alt');

      const params = decodeSourceParams(encoded.url);
      expect(params?.get('path')).toBe('cover.url');
      expect(params?.get('type')).toBe('media');
      expect(params?.get('documentId')).toBe('doc-1');
      expect(params?.get('model')).toBe('api::article.article');
      expect(params?.get('locale')).toBe('en');
      expect(params?.get('fieldPath')).toBeNull();
    });

    it('stega-encodes each entry url on a multi-value media override', () => {
      const value = [
        { url: '/uploads/a.jpg', mime: 'image/jpeg' },
        { url: '/uploads/b.mp4', mime: 'video/mp4' },
      ];
      const encoded = encodeMediaOverride(value, { ...base, path: 'gallery' }) as typeof value;

      expect(decodeSourceParams(encoded[0].url)?.get('path')).toBe('gallery.0.url');
      expect(decodeSourceParams(encoded[1].url)?.get('path')).toBe('gallery.1.url');
      expect(encoded[0].mime).toBe('image/jpeg');
      expect(encoded[1].mime).toBe('video/mp4');
    });

    it('passes through null values unchanged', () => {
      expect(encodeMediaOverride(null, { ...base, path: 'cover' })).toBeNull();
    });

    it('passes through entries without a string url', () => {
      const value = [
        { url: '/uploads/a.jpg', mime: 'image/jpeg' },
        { id: 2, mime: 'image/jpeg' },
      ];
      const encoded = encodeMediaOverride(value, { ...base, path: 'gallery' }) as typeof value;

      expect(decodeSourceParams(encoded[0].url)?.get('path')).toBe('gallery.0.url');
      // entry without url passes through untouched
      expect(encoded[1]).toEqual({ id: 2, mime: 'image/jpeg' });
    });

    it('omits locale when value has no locale', () => {
      const value = { url: '/uploads/a.png', mime: 'image/png' };
      const encoded = encodeMediaOverride(value, {
        ...base,
        locale: null,
        path: 'cover',
      }) as typeof value;

      expect(decodeSourceParams(encoded.url)?.get('locale')).toBeNull();
    });
  });

  describe('encodeBlocksOverride', () => {
    it('stega-encodes every text leaf with fieldPath pointing at the ancestor blocks field', () => {
      const tree = [
        {
          type: 'paragraph',
          children: [
            { type: 'text', text: 'First line' },
            {
              type: 'link',
              url: 'https://strapi.io',
              children: [{ type: 'text', text: 'Read more' }],
            },
          ],
        },
      ];
      const encoded = encodeBlocksOverride(tree, { ...base, path: 'body' }) as typeof tree;

      const first = decodeSourceParams(encoded[0].children[0].text);
      expect(first?.get('path')).toBe('body.0.children.0.text');
      expect(first?.get('fieldPath')).toBe('body');
      expect(first?.get('type')).toBe('blocks');
      expect(first?.get('documentId')).toBe('doc-1');

      const linkText = decodeSourceParams(
        (encoded[0].children[1] as any).children[0].text as string
      );
      expect(linkText?.get('path')).toBe('body.0.children.1.children.0.text');
      expect(linkText?.get('fieldPath')).toBe('body');

      // non-text leaves (like link.url) are passed through untouched
      expect((encoded[0].children[1] as any).url).toBe('https://strapi.io');
    });

    it('passes through non-blocks-shaped values unchanged', () => {
      expect(encodeBlocksOverride(null, { ...base, path: 'body' })).toBeNull();
      expect(encodeBlocksOverride('not blocks', { ...base, path: 'body' })).toBe('not blocks');
    });
  });

  /**
   * Shape parity with the server-side `createContentSourceMapsService().encodeField` in
   * packages/core/core/src/services/content-source-maps.ts. Asserting the concrete
   * URLSearchParams string catches insertion-order drift that would make saved and unsaved
   * payloads diverge even when the same keys are present.
   */
  describe('shape parity with the server-side encoder', () => {
    it('matches the server payload order for a media url', () => {
      const encoded = encodeField('/uploads/a.png', {
        ...base,
        type: 'media',
        path: 'cover.url',
      });

      expect(decodeSourceParams(encoded)?.toString()).toBe(
        'documentId=doc-1&type=media&path=cover.url&model=api%3A%3Aarticle.article&kind=collectionType&locale=en'
      );
    });

    it('matches the server payload order for a block text leaf', () => {
      const encoded = encodeField('hello', {
        ...base,
        type: 'blocks',
        path: 'body.0.children.0.text',
        fieldPath: 'body',
      });

      expect(decodeSourceParams(encoded)?.toString()).toBe(
        'documentId=doc-1&type=blocks&path=body.0.children.0.text&model=api%3A%3Aarticle.article&kind=collectionType&locale=en&fieldPath=body'
      );
    });
  });
});
