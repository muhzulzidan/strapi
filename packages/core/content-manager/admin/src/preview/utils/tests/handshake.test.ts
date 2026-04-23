import { parsePreviewReadyFeatures } from '../handshake';

describe('parsePreviewReadyFeatures', () => {
  it('returns an empty list when the payload is missing', () => {
    expect(parsePreviewReadyFeatures(undefined)).toEqual([]);
    expect(parsePreviewReadyFeatures(null)).toEqual([]);
  });

  it('returns an empty list when the payload is not an object', () => {
    expect(parsePreviewReadyFeatures('previewReady')).toEqual([]);
    expect(parsePreviewReadyFeatures(42)).toEqual([]);
  });

  it('returns an empty list when features is absent', () => {
    expect(parsePreviewReadyFeatures({ type: 'previewReady' })).toEqual([]);
  });

  it('returns an empty list when features is not an array', () => {
    expect(parsePreviewReadyFeatures({ type: 'previewReady', features: 'media' })).toEqual([]);
    expect(parsePreviewReadyFeatures({ type: 'previewReady', features: { media: true } })).toEqual(
      []
    );
  });

  it('returns an empty list when features is an empty array', () => {
    expect(parsePreviewReadyFeatures({ type: 'previewReady', features: [] })).toEqual([]);
  });

  it('returns the advertised capabilities when features is a string array', () => {
    expect(parsePreviewReadyFeatures({ type: 'previewReady', features: ['media'] })).toEqual([
      'media',
    ]);
    expect(
      parsePreviewReadyFeatures({
        type: 'previewReady',
        features: ['media', 'blocks'],
      })
    ).toEqual(['media', 'blocks']);
  });

  it('filters out non-string entries while preserving string entries', () => {
    expect(
      parsePreviewReadyFeatures({
        type: 'previewReady',
        features: ['media', 42, null, undefined, { nested: true }, 'blocks'],
      })
    ).toEqual(['media', 'blocks']);
  });

  it('re-parses each handshake independently so reload with a changed list wins', () => {
    const first = parsePreviewReadyFeatures({ type: 'previewReady', features: ['media'] });
    const second = parsePreviewReadyFeatures({ type: 'previewReady', features: [] });
    const third = parsePreviewReadyFeatures({
      type: 'previewReady',
      features: ['media', 'blocks'],
    });

    expect(first).toEqual(['media']);
    expect(second).toEqual([]);
    expect(third).toEqual(['media', 'blocks']);
  });
});
