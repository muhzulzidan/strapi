/**
 * Diff helpers that drive the hybrid routing gate in `usePreviewInputManager`.
 *
 * The admin picks one of two channels per field edit:
 *   - `strapiFieldChange` (mechanism 1 — imperative DOM patch in the injected
 *     preview script) is safe for attribute-level edits: same-type media `src`
 *     swap, text-leaf edits inside a blocks tree. Consumers need no opt-in for
 *     these.
 *   - `strapiFieldOverride` (mechanism 2 — framework-reconciled via
 *     `window.strapiPreview.subscribe`) is required for structural edits:
 *     cross-type media swap, multi-value array changes, media clears, and
 *     block add / remove / reorder. The iframe must advertise the matching
 *     `features: ['media' | 'blocks']` capability.
 *
 * These two functions are the single source of truth for picking the channel.
 */

export const isSameShapeMediaChange = (prev: unknown, next: unknown): boolean => {
  // Null on either side is a structural transition (add or clear).
  if (prev == null || next == null) return false;

  // Array shape on either side is structural. Covers single↔multi transitions
  // and any edit inside a multi-value media field.
  if (Array.isArray(prev) || Array.isArray(next)) return false;

  if (typeof prev !== 'object' || typeof next !== 'object') return false;

  const prevMime = (prev as { mime?: unknown }).mime;
  const nextMime = (next as { mime?: unknown }).mime;
  if (typeof prevMime !== 'string' || typeof nextMime !== 'string') return false;

  // Same MIME category (image/*, video/*) means the rendered tag type is the
  // same, so the preview script can safely patch `src` in place.
  return prevMime.split('/')[0] === nextMime.split('/')[0];
};

export const isTextLeafOnlyBlocksChange = (prev: unknown, next: unknown): boolean => {
  return sameBlocksStructure(prev, next);
};

const sameBlocksStructure = (prev: unknown, next: unknown): boolean => {
  if (isTextLeaf(prev) && isTextLeaf(next)) {
    return sameLeafMarks(prev, next);
  }

  if (Array.isArray(prev) && Array.isArray(next)) {
    if (prev.length !== next.length) return false;
    for (let i = 0; i < prev.length; i++) {
      if (!sameBlocksStructure(prev[i], next[i])) return false;
    }
    return true;
  }

  if (isObjectNode(prev) && isObjectNode(next)) {
    if (prev.type !== next.type) return false;

    const prevKeys = objectKeys(prev);
    const nextKeys = objectKeys(next);
    if (prevKeys.length !== nextKeys.length) return false;
    for (let i = 0; i < prevKeys.length; i++) {
      if (prevKeys[i] !== nextKeys[i]) return false;
    }

    for (const key of prevKeys) {
      if (key === 'children' || key === 'type') continue;
      if (!deepEqual(prev[key], next[key])) return false;
    }

    return sameBlocksStructure(prev.children, next.children);
  }

  return prev === next;
};

type BlocksNode = Record<string, unknown>;

const isTextLeaf = (node: unknown): node is BlocksNode => {
  return (
    typeof node === 'object' && node !== null && !Array.isArray(node) && 'text' in (node as object)
  );
};

const isObjectNode = (node: unknown): node is BlocksNode => {
  return typeof node === 'object' && node !== null && !Array.isArray(node);
};

const objectKeys = (node: BlocksNode) => Object.keys(node).sort();

const sameLeafMarks = (prev: BlocksNode, next: BlocksNode): boolean => {
  const prevKeys = objectKeys(prev).filter((k) => k !== 'text');
  const nextKeys = objectKeys(next).filter((k) => k !== 'text');
  if (prevKeys.length !== nextKeys.length) return false;
  for (let i = 0; i < prevKeys.length; i++) {
    if (prevKeys[i] !== nextKeys[i]) return false;
    if (prev[prevKeys[i]] !== next[nextKeys[i]]) return false;
  }
  return true;
};

const deepEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const ak = Object.keys(a as object).sort();
    const bk = Object.keys(b as object).sort();
    if (ak.length !== bk.length) return false;
    for (let i = 0; i < ak.length; i++) if (ak[i] !== bk[i]) return false;
    for (const k of ak) {
      if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) {
        return false;
      }
    }
    return true;
  }
  return false;
};
