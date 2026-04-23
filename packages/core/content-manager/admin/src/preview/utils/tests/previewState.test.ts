import { previewScript } from '../previewScript';

/**
 * No-run mode exposes the pure helpers that live inside the previewScript IIFE
 * so we can unit-test them without running the whole script (which does
 * side-effecting DOM work and a dynamic import from a CDN).
 */
const internals = previewScript({
  shouldRun: false,
  colors: { highlightHoverColor: '#000', highlightActiveColor: '#000' },
})!;

const { setAtPath, applyOverrides, createPreviewStateManager } = internals;

describe('setAtPath', () => {
  it('sets a top-level field', () => {
    const tree: Record<string, unknown> = { title: 'old' };
    setAtPath(tree, 'title', 'new');
    expect(tree).toEqual({ title: 'new' });
  });

  it('sets a nested object field, creating intermediates', () => {
    const tree: Record<string, unknown> = {};
    setAtPath(tree, 'seo.title', 'Hello');
    expect(tree).toEqual({ seo: { title: 'Hello' } });
  });

  it('treats numeric segments as array indices', () => {
    const tree: Record<string, unknown> = {};
    setAtPath(tree, 'components.0.image', { url: '/a.png' });
    expect(tree).toEqual({ components: [{ image: { url: '/a.png' } }] });
  });

  it('updates an existing array without replacing it', () => {
    const tree = { gallery: [{ url: '/one.png' }, { url: '/two.png' }] };
    setAtPath(tree, 'gallery.1', { url: '/swapped.png' });
    expect(tree.gallery).toEqual([{ url: '/one.png' }, { url: '/swapped.png' }]);
  });

  it('stores null at the tail as a cleared value', () => {
    const tree: Record<string, unknown> = { hero: { url: '/a.png' } };
    setAtPath(tree, 'hero', null);
    expect(tree).toEqual({ hero: null });
  });

  it('is a no-op on empty path or non-object root', () => {
    const tree: Record<string, unknown> = { title: 'keep' };
    expect(() => setAtPath(tree, '', 'x')).not.toThrow();
    expect(tree).toEqual({ title: 'keep' });

    expect(() => setAtPath(null, 'a.b', 'x')).not.toThrow();
    expect(() => setAtPath(undefined, 'a.b', 'x')).not.toThrow();
  });
});

describe('applyOverrides', () => {
  it('returns the same reference when there are no overrides', () => {
    const data = { title: 'hello' };
    expect(applyOverrides(data, {})).toBe(data);
  });

  it('returns the input unchanged when data is not an object', () => {
    expect(applyOverrides(null, { title: 'x' })).toBeNull();
    expect(applyOverrides(undefined, { title: 'x' })).toBeUndefined();
  });

  it('does not mutate the input when applying overrides', () => {
    const data = { title: 'hello', hero: { url: '/old.png' } };
    const result = applyOverrides(data, { hero: { url: '/new.png' } }) as {
      hero: { url: string };
    };

    expect(data.hero.url).toBe('/old.png');
    expect(result).not.toBe(data);
    expect(result.hero).toEqual({ url: '/new.png' });
  });

  it('applies a null override to represent a cleared field', () => {
    const data = { hero: { url: '/a.png' } };
    expect(applyOverrides(data, { hero: null })).toEqual({ hero: null });
  });

  it('applies a multi-value (array) override', () => {
    const data = { gallery: [{ url: '/a.png' }] };
    const result = applyOverrides(data, {
      gallery: [{ url: '/x.png' }, { url: '/y.png' }],
    });
    expect(result).toEqual({ gallery: [{ url: '/x.png' }, { url: '/y.png' }] });
  });

  it('applies overrides at nested component paths', () => {
    const data = { components: [{ image: { url: '/old.png' } }] };
    const result = applyOverrides(data, {
      'components.0.image': { url: '/new.png' },
    });
    expect(result).toEqual({ components: [{ image: { url: '/new.png' } }] });
  });
});

describe('createPreviewStateManager', () => {
  it('does not call subscribers on subscribe if no initial data has been set yet', () => {
    const state = createPreviewStateManager();
    const listener = jest.fn();

    state.api.subscribe(listener);

    expect(listener).not.toHaveBeenCalled();
  });

  it('calls a newly-added subscriber immediately with the current merged state', () => {
    const state = createPreviewStateManager();
    state.api.setInitialData({ hero: { url: '/a.png' } });

    const listener = jest.fn();
    state.api.subscribe(listener);

    expect(listener).toHaveBeenCalledWith({ hero: { url: '/a.png' } });
  });

  it('notifies subscribers when a field override arrives, with merged data', () => {
    const state = createPreviewStateManager();
    state.api.setInitialData({ hero: { url: '/old.png' }, title: 'keep me' });

    const listener = jest.fn();
    state.api.subscribe(listener);
    listener.mockClear();

    state.applyFieldOverride('hero', { url: '/new.png' });

    expect(listener).toHaveBeenCalledWith({
      hero: { url: '/new.png' },
      title: 'keep me',
    });
  });

  it('accumulates overrides across multiple field overrides (media and blocks flow through the same store)', () => {
    const state = createPreviewStateManager();
    state.api.setInitialData({
      hero: { url: '/h.png' },
      gallery: [{ url: '/g1.png' }],
    });

    const listener = jest.fn();
    state.api.subscribe(listener);

    state.applyFieldOverride('hero', { url: '/h-new.png' });
    state.applyFieldOverride('gallery', [{ url: '/g-new.png' }]);

    expect(listener).toHaveBeenLastCalledWith({
      hero: { url: '/h-new.png' },
      gallery: [{ url: '/g-new.png' }],
    });
  });

  it('treats a null value as a cleared field', () => {
    const state = createPreviewStateManager();
    state.api.setInitialData({ hero: { url: '/a.png' } });
    const listener = jest.fn();
    state.api.subscribe(listener);

    state.applyFieldOverride('hero', null);

    expect(listener).toHaveBeenLastCalledWith({ hero: null });
  });

  it('setInitialData discards outstanding overrides so saved data wins', () => {
    const state = createPreviewStateManager();
    state.api.setInitialData({ hero: { url: '/old.png' } });
    state.applyFieldOverride('hero', { url: '/draft.png' });

    const listener = jest.fn();
    state.api.subscribe(listener);
    listener.mockClear();

    state.api.setInitialData({ hero: { url: '/saved.png' } });

    expect(listener).toHaveBeenCalledWith({ hero: { url: '/saved.png' } });
  });

  it('returns an unsubscribe function that removes the listener', () => {
    const state = createPreviewStateManager();
    state.api.setInitialData({ title: 'first' });

    const listener = jest.fn();
    const unsubscribe = state.api.subscribe(listener);
    listener.mockClear();

    unsubscribe();
    state.applyFieldOverride('title', 'second');

    expect(listener).not.toHaveBeenCalled();
  });

  it('reset() clears subscribers and stored data', () => {
    const state = createPreviewStateManager();
    state.api.setInitialData({ title: 'first' });
    const listener = jest.fn();
    state.api.subscribe(listener);
    listener.mockClear();

    state.reset();
    state.applyFieldOverride('title', 'second');

    expect(listener).not.toHaveBeenCalled();
  });
});
