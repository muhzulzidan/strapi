/**
 * Normalize relative media URLs before they cross the frame boundary.
 *
 * Strapi stores upload URLs as root-relative paths (e.g. `/uploads/file.jpg`).
 * The admin is served from the same origin as those uploads, so the path
 * resolves correctly while it lives in the admin. Once we post it to a preview
 * iframe hosted on a different origin (e.g. a Next.js consumer on :3000 vs
 * Strapi on :1337), the iframe would resolve the path against its own origin
 * and 404 on the image fetch.
 *
 * Absolutizing here — at the send site — means every consumer gets an
 * already-usable URL and no one has to re-implement this in their preview
 * integration. Absolute URLs (http/https, protocol-relative, data:) and
 * non-media values pass through unchanged.
 */

const absolutize = (url: string): string => {
  // Already absolute: http(s)://, any other scheme, or protocol-relative //.
  if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(url)) return url;
  // Inline data URIs.
  if (url.startsWith('data:')) return url;
  // Root-relative path served from the admin's own origin.
  if (url.startsWith('/')) return window.location.origin + url;
  return url;
};

const absolutizeMedia = (value: unknown): unknown => {
  if (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'url' in value &&
    typeof (value as { url: unknown }).url === 'string'
  ) {
    return {
      ...(value as Record<string, unknown>),
      url: absolutize((value as { url: string }).url),
    };
  }
  return value;
};

/**
 * Walks a media field value — single object, array of objects, or nullish —
 * and returns a shallow copy with every relative `url` resolved against the
 * current admin origin. Values without a `url` property are returned as-is.
 */
export const resolveMediaUrl = <T>(value: T): T => {
  if (value == null) return value;
  if (Array.isArray(value)) {
    return value.map(absolutizeMedia) as unknown as T;
  }
  return absolutizeMedia(value) as T;
};
