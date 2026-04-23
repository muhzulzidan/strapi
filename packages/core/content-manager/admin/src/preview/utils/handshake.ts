/**
 * Parses the optional `features` array from a `previewReady` message payload.
 * Non-object payloads, missing arrays, and non-string entries are ignored, so
 * callers can treat the return value as a safe, normalized capability list.
 */
export const parsePreviewReadyFeatures = (data: unknown): readonly string[] => {
  if (typeof data !== 'object' || data === null) {
    return [];
  }

  const features = (data as { features?: unknown }).features;
  if (!Array.isArray(features)) {
    return [];
  }

  return features.filter((feature): feature is string => typeof feature === 'string');
};
