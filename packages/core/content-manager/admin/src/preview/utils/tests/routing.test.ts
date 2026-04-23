import { isSameShapeMediaChange, isTextLeafOnlyBlocksChange } from '../routing';

describe('isSameShapeMediaChange', () => {
  it('returns true when both values share a MIME category', () => {
    expect(
      isSameShapeMediaChange(
        { url: '/a.png', mime: 'image/png' },
        { url: '/b.jpg', mime: 'image/jpeg' }
      )
    ).toBe(true);

    expect(
      isSameShapeMediaChange(
        { url: '/a.mp4', mime: 'video/mp4' },
        { url: '/b.webm', mime: 'video/webm' }
      )
    ).toBe(true);
  });

  it('returns false for cross-category changes', () => {
    expect(
      isSameShapeMediaChange(
        { url: '/a.png', mime: 'image/png' },
        { url: '/b.mp4', mime: 'video/mp4' }
      )
    ).toBe(false);

    expect(
      isSameShapeMediaChange(
        { url: '/a.mp4', mime: 'video/mp4' },
        { url: '/b.png', mime: 'image/png' }
      )
    ).toBe(false);
  });

  it('returns false on null transitions in either direction', () => {
    expect(isSameShapeMediaChange(null, { url: '/a.png', mime: 'image/png' })).toBe(false);
    expect(isSameShapeMediaChange({ url: '/a.png', mime: 'image/png' }, null)).toBe(false);
    expect(isSameShapeMediaChange(undefined, { url: '/a.png', mime: 'image/png' })).toBe(false);
    expect(isSameShapeMediaChange({ url: '/a.png', mime: 'image/png' }, undefined)).toBe(false);
  });

  it('returns false when either side is an array (multi-value is structural)', () => {
    expect(
      isSameShapeMediaChange(
        [{ url: '/a.png', mime: 'image/png' }],
        [
          { url: '/a.png', mime: 'image/png' },
          { url: '/b.png', mime: 'image/png' },
        ]
      )
    ).toBe(false);

    expect(
      isSameShapeMediaChange([{ url: '/a.png', mime: 'image/png' }], {
        url: '/b.png',
        mime: 'image/png',
      })
    ).toBe(false);
  });

  it('returns false when the MIME field is missing or not a string', () => {
    expect(isSameShapeMediaChange({ url: '/a.png' }, { url: '/b.png' })).toBe(false);
    expect(
      isSameShapeMediaChange({ url: '/a.png', mime: null }, { url: '/b.png', mime: 'image/png' })
    ).toBe(false);
  });
});

describe('isTextLeafOnlyBlocksChange', () => {
  const leafTree = (text: string) => [{ type: 'paragraph', children: [{ text }] }];

  it('returns true when only leaf text differs', () => {
    expect(isTextLeafOnlyBlocksChange(leafTree('hello'), leafTree('hello world'))).toBe(true);
  });

  it('returns true when marks match and only text differs', () => {
    const prev = [
      {
        type: 'paragraph',
        children: [{ text: 'a', bold: true }, { text: ' and ' }, { text: 'c', italic: true }],
      },
    ];
    const next = [
      {
        type: 'paragraph',
        children: [{ text: 'x', bold: true }, { text: ' and ' }, { text: 'y', italic: true }],
      },
    ];
    expect(isTextLeafOnlyBlocksChange(prev, next)).toBe(true);
  });

  it('returns false when block count differs (add/remove)', () => {
    const prev = leafTree('hello');
    const next = [...leafTree('hello'), { type: 'paragraph', children: [{ text: 'new block' }] }];
    expect(isTextLeafOnlyBlocksChange(prev, next)).toBe(false);
  });

  it('returns false when a block type changes (e.g., paragraph → heading)', () => {
    const prev = [{ type: 'paragraph', children: [{ text: 'hello' }] }];
    const next = [{ type: 'heading', level: 1, children: [{ text: 'hello' }] }];
    expect(isTextLeafOnlyBlocksChange(prev, next)).toBe(false);
  });

  it('returns false when a leaf mark is added or removed', () => {
    const prev = [{ type: 'paragraph', children: [{ text: 'hello' }] }];
    const next = [{ type: 'paragraph', children: [{ text: 'hello', bold: true }] }];
    expect(isTextLeafOnlyBlocksChange(prev, next)).toBe(false);
  });

  it('returns false when children count differs (split/merge)', () => {
    const prev = [{ type: 'paragraph', children: [{ text: 'hello world' }] }];
    const next = [
      {
        type: 'paragraph',
        children: [{ text: 'hello' }, { text: ' world' }],
      },
    ];
    expect(isTextLeafOnlyBlocksChange(prev, next)).toBe(false);
  });

  it('returns false when non-children primitive metadata changes (e.g., heading level)', () => {
    const prev = [{ type: 'heading', level: 1, children: [{ text: 'hi' }] }];
    const next = [{ type: 'heading', level: 2, children: [{ text: 'hi' }] }];
    expect(isTextLeafOnlyBlocksChange(prev, next)).toBe(false);
  });

  it('returns true for deeply nested unchanged structures', () => {
    const tree = [
      {
        type: 'list',
        format: 'unordered',
        children: [
          {
            type: 'list-item',
            children: [{ text: 'one' }],
          },
          {
            type: 'list-item',
            children: [{ text: 'two' }],
          },
        ],
      },
    ];
    const edited = [
      {
        type: 'list',
        format: 'unordered',
        children: [
          {
            type: 'list-item',
            children: [{ text: 'first' }],
          },
          {
            type: 'list-item',
            children: [{ text: 'second' }],
          },
        ],
      },
    ];
    expect(isTextLeafOnlyBlocksChange(tree, edited)).toBe(true);
  });

  it('returns false for first-mount transitions (undefined → tree)', () => {
    expect(isTextLeafOnlyBlocksChange(undefined, leafTree('hello'))).toBe(false);
    expect(isTextLeafOnlyBlocksChange(null, leafTree('hello'))).toBe(false);
  });
});
