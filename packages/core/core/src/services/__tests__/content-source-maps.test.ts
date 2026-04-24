import { vercelStegaDecode } from '@vercel/stega';

import { createContentSourceMapsService } from '../content-source-maps';

const decodeSourceParams = (value: string) => {
  const decoded = vercelStegaDecode(value);

  if (!decoded || typeof decoded !== 'object' || !('strapiSource' in decoded)) {
    return null;
  }

  return new URLSearchParams((decoded as { strapiSource: string }).strapiSource);
};

describe('Content source maps service', () => {
  const articleSchema = {
    uid: 'api::article.article',
    kind: 'collectionType',
    attributes: {
      title: { type: 'string' },
      summary: { type: 'text' },
      rating: { type: 'integer' },
      body: { type: 'blocks' },
    },
  };

  const articleWithMediaSchema = {
    uid: 'api::article-with-media.article-with-media',
    kind: 'collectionType',
    attributes: {
      title: { type: 'string' },
      cover: { type: 'media' },
      gallery: { type: 'media', multiple: true },
    },
  };

  const uploadFileSchema = {
    uid: 'plugin::upload.file',
    kind: 'collectionType',
    attributes: {
      url: { type: 'string' },
      mime: { type: 'string' },
      alternativeText: { type: 'string' },
      caption: { type: 'string' },
    },
  };

  const strapi = {
    getModel: jest.fn((uid) => {
      if (uid === articleSchema.uid) {
        return articleSchema;
      }
      if (uid === articleWithMediaSchema.uid) {
        return articleWithMediaSchema;
      }
      if (uid === uploadFileSchema.uid) {
        return uploadFileSchema;
      }

      throw new Error(`Unknown model: ${uid}`);
    }),
    log: {
      error: jest.fn(),
    },
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('encodes blocks text leaves with full path specificity and ancestor fieldPath', async () => {
    const service = createContentSourceMapsService(strapi);
    const data = {
      documentId: 'doc-1',
      locale: 'en',
      title: 'Article title',
      body: [
        {
          type: 'paragraph',
          children: [
            { type: 'text', text: 'First line' },
            {
              type: 'link',
              url: 'https://strapi.io',
              rel: 'noopener noreferrer',
              target: '_blank',
              children: [{ type: 'text', text: 'Read more' }],
            },
          ],
        },
      ],
    };

    const encoded = await service.encodeSourceMaps({ data, schema: articleSchema as any });
    const encodedTitle = decodeSourceParams(encoded.title);
    const encodedFirstText = decodeSourceParams(encoded.body[0].children[0].text);
    const encodedLinkText = decodeSourceParams(encoded.body[0].children[1].children[0].text);

    expect(encodedTitle?.get('path')).toBe('title');
    expect(encodedTitle?.get('type')).toBe('string');
    expect(encodedTitle?.get('fieldPath')).toBeNull();

    expect(encoded.body[0].type).toBe('paragraph');
    expect(encoded.body[0].children[1].type).toBe('link');
    expect(encoded.body[0].children[1].url).toBe('https://strapi.io');
    expect(decodeSourceParams(encoded.body[0].children[1].url)).toBeNull();

    expect(encodedFirstText?.get('path')).toBe('body.0.children.0.text');
    expect(encodedFirstText?.get('fieldPath')).toBe('body');
    expect(encodedFirstText?.get('type')).toBe('blocks');
    expect(encodedFirstText?.get('documentId')).toBe('doc-1');
    expect(encodedFirstText?.get('locale')).toBe('en');
    expect(encodedFirstText?.get('model')).toBe('api::article.article');

    expect(encodedLinkText?.get('path')).toBe('body.0.children.1.children.0.text');
    expect(encodedLinkText?.get('fieldPath')).toBe('body');
    expect(encodedLinkText?.get('type')).toBe('blocks');
  });

  test('encodes url on a single-value media attribute', async () => {
    const service = createContentSourceMapsService(strapi);
    const data = {
      documentId: 'doc-media-1',
      locale: 'en',
      title: 'Has cover',
      cover: {
        id: 10,
        url: '/uploads/cover.jpg',
        mime: 'image/jpeg',
        alternativeText: 'Cover image',
      },
    };

    const encoded = await service.encodeSourceMaps({
      data,
      schema: articleWithMediaSchema as any,
    });

    expect(encoded.cover.id).toBe(10);
    expect(encoded.cover.mime).toBe('image/jpeg');
    expect(encoded.cover.alternativeText).toBe('Cover image');

    const encodedUrl = decodeSourceParams(encoded.cover.url);
    expect(encodedUrl?.get('path')).toBe('cover.url');
    expect(encodedUrl?.get('type')).toBe('media');
    expect(encodedUrl?.get('documentId')).toBe('doc-media-1');
    expect(encodedUrl?.get('locale')).toBe('en');
    expect(encodedUrl?.get('model')).toBe('api::article-with-media.article-with-media');
  });

  test('encodes url on every entry of a multi-value media attribute', async () => {
    const service = createContentSourceMapsService(strapi);
    const data = {
      documentId: 'doc-media-2',
      locale: 'en',
      title: 'Has gallery',
      gallery: [
        { id: 1, url: '/uploads/a.jpg', mime: 'image/jpeg' },
        { id: 2, url: '/uploads/b.mp4', mime: 'video/mp4' },
      ],
    };

    const encoded = await service.encodeSourceMaps({
      data,
      schema: articleWithMediaSchema as any,
    });

    expect(Array.isArray(encoded.gallery)).toBe(true);
    expect(encoded.gallery).toHaveLength(2);

    const first = decodeSourceParams(encoded.gallery[0].url);
    const second = decodeSourceParams(encoded.gallery[1].url);

    expect(first?.get('path')).toBe('gallery.0.url');
    expect(first?.get('type')).toBe('media');
    expect(first?.get('documentId')).toBe('doc-media-2');

    expect(second?.get('path')).toBe('gallery.1.url');
    expect(second?.get('type')).toBe('media');
    expect(second?.get('documentId')).toBe('doc-media-2');

    expect(encoded.gallery[0].id).toBe(1);
    expect(encoded.gallery[0].mime).toBe('image/jpeg');
    expect(encoded.gallery[1].id).toBe(2);
    expect(encoded.gallery[1].mime).toBe('video/mp4');
  });

  test('omits locale from payload when entry has no locale', async () => {
    const service = createContentSourceMapsService(strapi);
    const data = {
      documentId: 'doc-nolocale',
      title: 'No locale here',
    };

    const encoded = await service.encodeSourceMaps({ data, schema: articleSchema as any });
    const encodedTitle = decodeSourceParams(encoded.title);

    expect(encodedTitle?.get('locale')).toBeNull();
    expect(encodedTitle?.get('path')).toBe('title');
  });

  test('leaves non-opted-in fields untouched', async () => {
    const service = createContentSourceMapsService(strapi);
    const data = {
      documentId: 'doc-3',
      locale: 'en',
      rating: 5,
      body: null,
      cover: null,
    };

    const encoded = await service.encodeSourceMaps({
      data,
      schema: {
        ...articleSchema,
        attributes: {
          ...articleSchema.attributes,
          cover: { type: 'media' },
        },
      } as any,
    });

    expect(encoded.rating).toBe(5);
    expect(encoded.body).toBeNull();
    expect(encoded.cover).toBeNull();
    expect(encoded.documentId).toBe('doc-3');
  });

  /**
   * Keep in sync with the admin-side override encoder test at
   * packages/core/content-manager/admin/src/preview/utils/tests/overrideStega.test.ts —
   * both assert the same literal URLSearchParams string to catch insertion-order drift
   * that would make click-to-focus resolve different fields for saved vs unsaved content.
   */
  test('stable payload order for a media url matches the admin override encoder', () => {
    const service = createContentSourceMapsService(strapi);

    const encoded = service.encodeField('/uploads/a.png', {
      documentId: 'doc-1',
      type: 'media',
      path: 'cover.url',
      model: 'api::article.article' as any,
      kind: 'collectionType',
      locale: 'en',
    });

    expect(decodeSourceParams(encoded)?.toString()).toBe(
      'documentId=doc-1&type=media&path=cover.url&model=api%3A%3Aarticle.article&kind=collectionType&locale=en'
    );
  });

  test('stable payload order for a block text leaf matches the admin override encoder', () => {
    const service = createContentSourceMapsService(strapi);

    const encoded = service.encodeField('hello', {
      documentId: 'doc-1',
      type: 'blocks',
      path: 'body.0.children.0.text',
      fieldPath: 'body',
      model: 'api::article.article' as any,
      kind: 'collectionType',
      locale: 'en',
    });

    expect(decodeSourceParams(encoded)?.toString()).toBe(
      'documentId=doc-1&type=blocks&path=body.0.children.0.text&model=api%3A%3Aarticle.article&kind=collectionType&locale=en&fieldPath=body'
    );
  });

  test('omits fieldPath from payload when it equals path', () => {
    const service = createContentSourceMapsService(strapi);

    const encoded = service.encodeField('hello', {
      documentId: 'doc-1',
      type: 'string',
      path: 'title',
      model: 'api::article.article' as any,
      fieldPath: 'title',
    });

    const params = decodeSourceParams(encoded);
    expect(params?.get('path')).toBe('title');
    expect(params?.get('fieldPath')).toBeNull();
  });

  test('includes fieldPath in payload when it differs from path', () => {
    const service = createContentSourceMapsService(strapi);

    const encoded = service.encodeField('hello', {
      documentId: 'doc-1',
      type: 'blocks',
      path: 'body.0.children.0.text',
      model: 'api::article.article' as any,
      fieldPath: 'body',
    });

    const params = decodeSourceParams(encoded);
    expect(params?.get('path')).toBe('body.0.children.0.text');
    expect(params?.get('fieldPath')).toBe('body');
  });

  test('skips media entries that have no url string', async () => {
    const service = createContentSourceMapsService(strapi);
    const data = {
      documentId: 'doc-media-3',
      locale: 'en',
      title: 'Mixed gallery',
      gallery: [
        { id: 1, url: '/uploads/a.jpg', mime: 'image/jpeg' },
        { id: 2, mime: 'image/jpeg' },
      ],
    };

    const encoded = await service.encodeSourceMaps({
      data,
      schema: articleWithMediaSchema as any,
    });

    expect(decodeSourceParams(encoded.gallery[0].url)?.get('path')).toBe('gallery.0.url');
    expect(encoded.gallery[1].url).toBeUndefined();
    expect(encoded.gallery[1].id).toBe(2);
  });
});
