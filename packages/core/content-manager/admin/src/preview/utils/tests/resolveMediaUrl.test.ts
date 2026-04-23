import { resolveMediaUrl } from '../resolveMediaUrl';

describe('resolveMediaUrl', () => {
  const origin = window.location.origin;

  it('absolutizes a root-relative url on a single media object', () => {
    const result = resolveMediaUrl({ url: '/uploads/a.png', mime: 'image/png' });
    expect(result).toEqual({ url: `${origin}/uploads/a.png`, mime: 'image/png' });
  });

  it('leaves an http(s) url untouched', () => {
    const value = { url: 'https://cdn.example.com/a.png', mime: 'image/png' };
    expect(resolveMediaUrl(value)).toEqual(value);
  });

  it('leaves a protocol-relative url untouched', () => {
    const value = { url: '//cdn.example.com/a.png', mime: 'image/png' };
    expect(resolveMediaUrl(value)).toEqual(value);
  });

  it('leaves a data: uri untouched', () => {
    const value = { url: 'data:image/png;base64,AAA', mime: 'image/png' };
    expect(resolveMediaUrl(value)).toEqual(value);
  });

  it('normalizes every item in a multi-value media array', () => {
    const result = resolveMediaUrl([
      { url: '/uploads/a.png', mime: 'image/png' },
      { url: 'https://cdn.example.com/b.png', mime: 'image/png' },
      { url: '/uploads/c.mp4', mime: 'video/mp4' },
    ]);
    expect(result).toEqual([
      { url: `${origin}/uploads/a.png`, mime: 'image/png' },
      { url: 'https://cdn.example.com/b.png', mime: 'image/png' },
      { url: `${origin}/uploads/c.mp4`, mime: 'video/mp4' },
    ]);
  });

  it('passes null and undefined through', () => {
    expect(resolveMediaUrl(null)).toBeNull();
    expect(resolveMediaUrl(undefined)).toBeUndefined();
  });

  it('passes values without a `url` property through unchanged', () => {
    const value = { mime: 'image/png', name: 'a.png' };
    expect(resolveMediaUrl(value)).toEqual(value);
  });

  it('passes values where `url` is not a string through unchanged', () => {
    // @ts-expect-error — testing defensive handling of malformed values
    expect(resolveMediaUrl({ url: 42, mime: 'image/png' })).toEqual({ url: 42, mime: 'image/png' });
  });

  it('does not mutate its input', () => {
    const value = { url: '/uploads/a.png', mime: 'image/png' };
    const snapshot = { ...value };
    resolveMediaUrl(value);
    expect(value).toEqual(snapshot);
  });
});
