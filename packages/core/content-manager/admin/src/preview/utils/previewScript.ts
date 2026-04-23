// NOTE: This override is for the properties on _user's site_, it's not about Strapi Admin.
declare global {
  interface Window {
    __strapi_previewCleanup?: () => void;
    STRAPI_HIGHLIGHT_HOVER_COLOR?: string;
    STRAPI_HIGHLIGHT_ACTIVE_COLOR?: string;
    STRAPI_DISABLE_STEGA_DECODING?: boolean;
    /**
     * Consumer-facing API set up by the injected preview script. Consumers
     * register their base loader data via {@link StrapiPreview.setInitialData}
     * and subscribe to the merged render state via
     * {@link StrapiPreview.subscribe}; the script owns the override map driven
     * by `strapiFieldOverride` messages.
     */
    strapiPreview?: StrapiPreview;
  }
}

interface StrapiPreview<T = unknown> {
  setInitialData: (data: T) => void;
  subscribe: (listener: (data: T) => void) => () => void;
}

/**
 * previewScript will be injected into the preview iframe after being stringified.
 * Therefore it CANNOT use any imports, or refer to any variables outside of its own scope.
 * It's why many functions are defined within previewScript, it's the only way to avoid going full spaghetti.
 * To get a better overview of everything previewScript does, go to the orchestration part at its end.
 */
type PreviewScriptColors = {
  highlightHoverColor: string;
  highlightActiveColor: string;
};

type PreviewScriptConfig = {
  shouldRun?: boolean;
  colors: PreviewScriptColors;
};

const previewScript = (config: PreviewScriptConfig) => {
  const { shouldRun = true, colors } = config;

  /* -----------------------------------------------------------------------------------------------
   * Params
   * ---------------------------------------------------------------------------------------------*/
  const HIGHLIGHT_PADDING = 2; // in pixels
  const HIGHLIGHT_HOVER_COLOR = window.STRAPI_HIGHLIGHT_HOVER_COLOR ?? colors.highlightHoverColor;
  const HIGHLIGHT_ACTIVE_COLOR =
    window.STRAPI_HIGHLIGHT_ACTIVE_COLOR ?? colors.highlightActiveColor;
  const HIGHLIGHT_STYLES_ID = 'strapi-preview-highlight-styles';
  const DOUBLE_CLICK_TIMEOUT = 300; // milliseconds to wait for potential double-click

  const DISABLE_STEGA_DECODING = window.STRAPI_DISABLE_STEGA_DECODING ?? false;
  const SOURCE_ATTRIBUTE = 'data-strapi-source';
  const OVERLAY_ID = 'strapi-preview-overlay';
  const INTERNAL_EVENTS = {
    STRAPI_FIELD_FOCUS: 'strapiFieldFocus',
    STRAPI_FIELD_BLUR: 'strapiFieldBlur',
    STRAPI_FIELD_CHANGE: 'strapiFieldChange',
    STRAPI_FIELD_FOCUS_INTENT: 'strapiFieldFocusIntent',
    STRAPI_FIELD_SINGLE_CLICK_HINT: 'strapiFieldSingleClickHint',
    STRAPI_FIELD_OVERRIDE: 'strapiFieldOverride',
  } as const;

  /* -----------------------------------------------------------------------------------------------
   * Preview state manager (media override + subscribe API)
   *
   * The consumer calls window.strapiPreview.setInitialData(loaderData) and
   * window.strapiPreview.subscribe(listener) to hook a state container up to
   * the iframe's render tree. Any strapiFieldOverride message splices into an
   * internal override map; subscribers are always notified with the merged
   * result so the iframe's own framework can reconcile the resulting DOM.
   * Setting initial data resets overrides — saved values win over stale
   * unsaved ones when the consumer revalidates after a save.
   * ---------------------------------------------------------------------------------------------*/

  const isNumericSegment = (segment: string) => /^\d+$/.test(segment);

  const setAtPath = (root: unknown, path: string, value: unknown) => {
    if (!path || root === null || typeof root !== 'object') return;

    const segments = path.split('.');
    let cursor = root as Record<string | number, unknown>;

    for (let i = 0; i < segments.length - 1; i++) {
      const segment = segments[i];
      const next = segments[i + 1];
      const key = isNumericSegment(segment) ? Number(segment) : segment;

      if (cursor[key] === null || typeof cursor[key] !== 'object') {
        cursor[key] = isNumericSegment(next) ? [] : {};
      }

      cursor = cursor[key] as Record<string | number, unknown>;
    }

    const tail = segments[segments.length - 1];
    cursor[isNumericSegment(tail) ? Number(tail) : tail] = value;
  };

  const applyOverrides = (data: unknown, overrides: Record<string, unknown>): unknown => {
    if (!data || typeof data !== 'object') return data;
    const entries = Object.entries(overrides);
    if (entries.length === 0) return data;
    // JSON round-trip — data is a Strapi API response, fully serializable.
    const clone = JSON.parse(JSON.stringify(data));
    for (const [path, value] of entries) setAtPath(clone, path, value);
    return clone;
  };

  const createPreviewStateManager = () => {
    let initialData: unknown;
    let overrides: Record<string, unknown> = {};
    const subscribers = new Set<(data: unknown) => void>();
    let hasInitialData = false;

    const merged = () => applyOverrides(initialData, overrides);

    const notify = () => {
      const next = merged();
      subscribers.forEach((listener) => listener(next));
    };

    return {
      api: {
        setInitialData(data: unknown) {
          initialData = data;
          overrides = {};
          hasInitialData = true;
          notify();
        },
        subscribe(listener: (data: unknown) => void) {
          subscribers.add(listener);
          if (hasInitialData) listener(merged());
          return () => {
            subscribers.delete(listener);
          };
        },
      } as StrapiPreview,

      applyFieldOverride(path: string, value: unknown) {
        overrides = { ...overrides, [path]: value };
        notify();
      },

      reset() {
        subscribers.clear();
        overrides = {};
        initialData = undefined;
        hasInitialData = false;
      },
    };
  };

  /**
   * Calling the function in no-run mode lets us retrieve the constants and pure
   * helpers from other files and keep a single source of truth for them. It's
   * the only way to do this because this script can't refer to any variables
   * outside of its own scope, because it's stringified before it's run.
   */
  if (!shouldRun) {
    return { INTERNAL_EVENTS, createPreviewStateManager, setAtPath, applyOverrides };
  }

  // Set up the consumer-facing API synchronously so `window.strapiPreview` is
  // already on the window by the time the consumer executes the next line
  // after injecting the script tag. The `strapiFieldOverride` listener itself
  // is intentionally registered in the async block below, alongside the other
  // inbound message handlers — see the note there for why.
  const previewState = createPreviewStateManager();
  window.strapiPreview = previewState.api;

  /* -----------------------------------------------------------------------------------------------
   * Utils
   * ---------------------------------------------------------------------------------------------*/

  const sendMessage = (
    type: (typeof INTERNAL_EVENTS)[keyof typeof INTERNAL_EVENTS],
    payload: unknown
  ) => {
    window.parent.postMessage({ type, payload }, '*');
  };

  const getElementsByPath = (path: string) => {
    return document.querySelectorAll(`[${SOURCE_ATTRIBUTE}*="path=${path}"]`);
  };

  const isMediaElement = (element: Element): boolean => {
    return element.tagName === 'IMG' || element.tagName === 'VIDEO';
  };

  const isMediaValue = (value: unknown): value is { url?: unknown; mime?: unknown } => {
    return (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      'url' in value &&
      'mime' in value
    );
  };

  /**
   * A blocks field's value is an array of block nodes shaped like
   * `{ type, children }`. Detecting this shape lets the strapiFieldChange
   * handler route leaf-level text edits to {@link patchBlocksLeaves} instead
   * of the plain textContent patcher, which would serialize the whole tree
   * into `[object Object]`.
   */
  const isBlocksValue = (value: unknown): value is Array<{ type: unknown; children?: unknown }> => {
    return (
      Array.isArray(value) &&
      value.length > 0 &&
      value.every(
        (node) =>
          typeof node === 'object' &&
          node !== null &&
          !Array.isArray(node) &&
          'type' in (node as object)
      )
    );
  };

  /**
   * Walks a blocks tree and, for every text leaf, finds DOM nodes whose
   * `data-strapi-source` was stega-decoded to the leaf's path and updates
   * their `textContent` when it differs. Structural changes never reach here
   * — the admin routes them to the override channel — so unmatched leaves are
   * just skipped.
   */
  const patchBlocksLeaves = (fieldPath: string, blocksTree: unknown) => {
    const walk = (node: unknown, pathParts: string[]) => {
      if (Array.isArray(node)) {
        node.forEach((child, i) => walk(child, pathParts.concat(String(i))));
        return;
      }

      if (typeof node !== 'object' || node === null) return;

      if ('text' in (node as object)) {
        const text = (node as { text?: unknown }).text;
        if (typeof text !== 'string') return;

        const leafPath = pathParts.concat('text').join('.');
        const matches = document.querySelectorAll(`[${SOURCE_ATTRIBUTE}*="path=${leafPath}"]`);
        matches.forEach((element) => {
          if (element.textContent !== text) {
            element.textContent = text;
          }
        });
        return;
      }

      if (
        'children' in (node as object) &&
        Array.isArray((node as { children: unknown }).children)
      ) {
        walk((node as { children: unknown[] }).children, pathParts.concat('children'));
      }
    };

    walk(blocksTree, fieldPath.split('.'));
  };

  /**
   * Get the field path to use for focusing a media field.
   * - For IMG/VIDEO elements: the path was already normalized (stripped of .url) during stega decoding
   * - For non-media elements with model=plugin::upload.file (e.g., caption text): strip the last
   *   segment to focus the parent media field (e.g., "hero.caption" -> "hero")
   */
  const getFieldPathForMedia = (sourceAttr: string, element: Element): string => {
    // IMG/VIDEO elements already have the correct path from stega decoding
    if (isMediaElement(element)) {
      return sourceAttr;
    }

    // For non-media elements, check if it's a media asset field
    const params = new URLSearchParams(sourceAttr);
    if (params.get('model') === 'plugin::upload.file') {
      const elementPath = params.get('path');
      if (elementPath) {
        // Strip the last segment (e.g., "hero.caption" -> "hero")
        const parentPath = elementPath.split('.').slice(0, -1).join('.');
        params.set('path', parentPath);
        return params.toString();
      }
    }

    return sourceAttr;
  };

  /* -----------------------------------------------------------------------------------------------
   * Functionality pieces
   * ---------------------------------------------------------------------------------------------*/

  const setupStegaDOMObserver = async () => {
    if (DISABLE_STEGA_DECODING) {
      return;
    }

    const { vercelStegaDecode: stegaDecode, vercelStegaClean: stegaClean } = await import(
      // @ts-expect-error it's not a local dependency
      // eslint-disable-next-line import/no-unresolved
      'https://cdn.jsdelivr.net/npm/@vercel/stega@0.1.2/+esm'
    );

    const applyStegaToElement = (element: Element) => {
      // Handle img and video tags - check src attribute for stega encoding
      if (isMediaElement(element)) {
        const src = element.getAttribute('src');
        if (src) {
          try {
            const result = stegaDecode(src);
            if (result && 'strapiSource' in result) {
              // Parse the source and remove .url suffix to point to the media field
              const sourceValue = result.strapiSource as string;
              const pathMatch = sourceValue.match(/path=([^&]+)/);
              if (pathMatch) {
                const originalPath = pathMatch[1];
                // Remove .url to get the media field path
                const mediaPath = originalPath.replace(/\.url$/, '');
                const newSource = sourceValue.replace(`path=${originalPath}`, `path=${mediaPath}`);
                element.setAttribute(SOURCE_ATTRIBUTE, newSource);
              }
            }
            // Clean the src attribute so the resource can load
            const cleanedSrc = stegaClean(src);
            if (cleanedSrc !== src) {
              element.setAttribute('src', cleanedSrc);
            }
          } catch (error) {}
        }
        return;
      }

      const directTextNodes = Array.from(element.childNodes).filter(
        (node) => node.nodeType === Node.TEXT_NODE
      );

      const directTextContent = directTextNodes.map((node) => node.textContent || '').join('');

      if (directTextContent) {
        try {
          // TODO: check if we can call split instead of decode+clean
          const result = stegaDecode(directTextContent);
          if (result && 'strapiSource' in result) {
            element.setAttribute(SOURCE_ATTRIBUTE, result.strapiSource);

            // Remove encoded part from DOM text content (to avoid breaking links for example)
            directTextNodes.forEach((node) => {
              if (node.textContent) {
                const cleanedText = stegaClean(node.textContent);
                if (cleanedText !== node.textContent) {
                  node.textContent = cleanedText;
                }
              }
            });
          }
        } catch (error) {}
      }
    };

    // Process all existing elements
    const allElements = document.querySelectorAll('*');
    Array.from(allElements).forEach(applyStegaToElement);

    // Create observer for new elements and text changes
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        // Handle added nodes
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const element = node as Element;
              // Process the added element
              applyStegaToElement(element);
              // Process all child elements
              const childElements = element.querySelectorAll('*');
              Array.from(childElements).forEach(applyStegaToElement);
            }
          });
        }

        // Handle text content changes
        if (mutation.type === 'characterData' && mutation.target.parentElement) {
          applyStegaToElement(mutation.target.parentElement);
        }

        // Handle src attribute changes for img/video elements
        if (mutation.type === 'attributes' && mutation.attributeName === 'src') {
          const target = mutation.target as Element;
          if (isMediaElement(target)) {
            applyStegaToElement(target);
          }
        }
      });
    });

    observer.observe(document, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['src'],
    });

    return observer;
  };

  const createHighlightStyles = () => {
    const existingStyles = document.getElementById(HIGHLIGHT_STYLES_ID);
    // Remove existing styles to avoid duplicates
    if (existingStyles) {
      existingStyles.remove();
    }

    const styleElement = document.createElement('style');
    styleElement.id = HIGHLIGHT_STYLES_ID;
    styleElement.textContent = `
      .strapi-highlight {
        position: absolute;
        outline: 2px solid transparent;
        pointer-events: auto;
        border-radius: 2px;
        background-color: transparent;
        will-change: transform;
        transition: outline-color 0.1s ease-in-out;
      }

      .strapi-highlight:hover {
        outline-color: ${HIGHLIGHT_HOVER_COLOR} !important;
      }

      .strapi-highlight.strapi-highlight-focused {
        outline-color: ${HIGHLIGHT_ACTIVE_COLOR} !important;
        outline-width: 3px !important;
      }
    `;

    document.head.appendChild(styleElement);
    return styleElement;
  };

  const createOverlaySystem = () => {
    // Clean up before creating a new overlay so we can safely call previewScript multiple times
    window.__strapi_previewCleanup?.();
    document.getElementById(OVERLAY_ID)?.remove();

    const overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 9999;
    `;

    window.document.body.appendChild(overlay);
    return overlay;
  };

  type EventListenersList = Array<{
    element: HTMLElement | Window;
    type: keyof HTMLElementEventMap | 'message';
    handler: EventListener;
  }>;

  const createHighlightManager = (overlay: HTMLElement) => {
    const elementsToHighlight = new Map<Element, HTMLElement>();
    const eventListeners: EventListenersList = [];
    const focusedHighlights: HTMLElement[] = [];
    const pendingClicks = new Map<Element, number>(); // number is timeout id
    let focusedField: string | null = null;

    const drawHighlight = (target: Element, highlight: HTMLElement) => {
      if (!highlight) return;

      const rect = target.getBoundingClientRect();
      highlight.style.width = `${rect.width + HIGHLIGHT_PADDING * 2}px`;
      highlight.style.height = `${rect.height + HIGHLIGHT_PADDING * 2}px`;
      highlight.style.transform = `translate(${rect.left - HIGHLIGHT_PADDING}px, ${rect.top - HIGHLIGHT_PADDING}px)`;
    };

    const updateAllHighlights = () => {
      elementsToHighlight.forEach((highlight, element) => {
        drawHighlight(element, highlight);
      });
    };

    const createHighlightForElement = (element: HTMLElement) => {
      if (elementsToHighlight.has(element)) {
        // Already has a highlight
        return;
      }

      const highlight = document.createElement('div');
      highlight.className = 'strapi-highlight';
      const clickHandler = (event: MouseEvent) => {
        // Skip if this is a re-dispatched event from our delayed handler to avoid infinite loops
        if ((event as any).__strapi_redispatched) {
          return;
        }

        // Prevent the immediate action for interactive elements
        event.preventDefault();
        event.stopPropagation();

        // Clear any existing timeout for this element
        const existingTimeout = pendingClicks.get(element);
        if (existingTimeout) {
          window.clearTimeout(existingTimeout);
          pendingClicks.delete(element);
        }

        // Set up a delayed single-click handler
        const timeout = window.setTimeout(() => {
          pendingClicks.delete(element);

          // Send single-click hint notification
          sendMessage(INTERNAL_EVENTS.STRAPI_FIELD_SINGLE_CLICK_HINT, null);

          // For img/video elements, find the nearest interactive parent since media
          // elements themselves aren't interactive - their behavior comes from parents
          let targetElement: HTMLElement = element;
          if (isMediaElement(element)) {
            let parent = element.parentElement;
            while (parent) {
              if (
                parent.tagName === 'A' ||
                parent.tagName === 'BUTTON' ||
                parent.hasAttribute('onclick') ||
                parent.getAttribute('role') === 'button' ||
                parent.getAttribute('role') === 'link'
              ) {
                targetElement = parent;
                break;
              }
              parent = parent.parentElement;
            }
          }

          // Re-trigger the click on the underlying element after the double-click timeout
          // Create a new event to dispatch with a marker to prevent re-handling
          const newEvent = new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            view: window,
            detail: 1,
            button: event.button,
            buttons: event.buttons,
            clientX: event.clientX,
            clientY: event.clientY,
            ctrlKey: event.ctrlKey,
            altKey: event.altKey,
            shiftKey: event.shiftKey,
            metaKey: event.metaKey,
          });
          (newEvent as any).__strapi_redispatched = true;
          targetElement.dispatchEvent(newEvent);
        }, DOUBLE_CLICK_TIMEOUT);

        pendingClicks.set(element, timeout);
      };

      const doubleClickHandler = (event: MouseEvent) => {
        // Prevent the default behavior on double-click
        event.preventDefault();
        event.stopPropagation();

        // Clear any pending single-click action
        const existingTimeout = pendingClicks.get(element);
        if (existingTimeout) {
          clearTimeout(existingTimeout);
          pendingClicks.delete(element);
        }

        const sourceAttribute = element.getAttribute(SOURCE_ATTRIBUTE);
        if (sourceAttribute) {
          const path = getFieldPathForMedia(sourceAttribute, element);
          const rect = element.getBoundingClientRect();
          sendMessage(INTERNAL_EVENTS.STRAPI_FIELD_FOCUS_INTENT, {
            path,
            position: {
              top: rect.top,
              left: rect.left,
              right: rect.right,
              bottom: rect.bottom,
              width: rect.width,
              height: rect.height,
            },
          });
        }
      };

      const mouseDownHandler = (event: MouseEvent) => {
        // Prevent default multi click to select behavior
        if (event.detail >= 2) {
          event.preventDefault();
        }
      };

      highlight.addEventListener('click', clickHandler);
      highlight.addEventListener('dblclick', doubleClickHandler);
      highlight.addEventListener('mousedown', mouseDownHandler);

      // Store event listeners for cleanup
      eventListeners.push(
        { element: highlight, type: 'click', handler: clickHandler as EventListener },
        { element: highlight, type: 'dblclick', handler: doubleClickHandler as EventListener },
        { element: highlight, type: 'mousedown', handler: mouseDownHandler as EventListener }
      );

      elementsToHighlight.set(element, highlight);
      overlay.appendChild(highlight);
      drawHighlight(element, highlight);
    };

    const removeHighlightForElement = (element: Element) => {
      const highlight = elementsToHighlight.get(element);

      if (!highlight) return;

      // Clear any pending click timeout for this element
      const pendingTimeout = pendingClicks.get(element);
      if (pendingTimeout) {
        window.clearTimeout(pendingTimeout);
        pendingClicks.delete(element);
      }

      highlight.remove();
      elementsToHighlight.delete(element);

      // Remove event listeners for this highlight
      const listenersToRemove = eventListeners.filter((listener) => listener.element === highlight);
      listenersToRemove.forEach(({ element, type, handler }) => {
        element.removeEventListener(type, handler);
      });

      // Mutate eventListeners to remove listeners for this highlight
      eventListeners.splice(
        0,
        eventListeners.length,
        ...eventListeners.filter((listener) => listener.element !== highlight)
      );
    };

    // Process all existing elements with source attributes
    const initialElements = window.document.querySelectorAll(`[${SOURCE_ATTRIBUTE}]`);
    Array.from(initialElements).forEach((element) => {
      if (element instanceof HTMLElement) {
        createHighlightForElement(element);
      }
    });

    return {
      get elements() {
        return Array.from(elementsToHighlight.keys());
      },
      get highlights() {
        return Array.from(elementsToHighlight.values());
      },
      updateAllHighlights,
      eventListeners,
      focusedHighlights,
      createHighlightForElement,
      removeHighlightForElement,
      setFocusedField: (field: string | null) => {
        focusedField = field;
      },
      getFocusedField: () => focusedField,
      clearAllPendingClicks: () => {
        pendingClicks.forEach((timeout) => clearTimeout(timeout));
        pendingClicks.clear();
      },
    };
  };

  type HighlightManager = ReturnType<typeof createHighlightManager>;

  /**
   * We need to track scroll in all the element parents in order to keep the highlight position
   * in sync with the element position. Listening to window scroll is not enough because the
   * element can be inside one or more scrollable containers.
   */
  const setupScrollManagement = (highlightManager: HighlightManager) => {
    const updateOnScroll = () => {
      highlightManager.updateAllHighlights();
    };

    const scrollableElements = new Set<Element | Window>();
    scrollableElements.add(window);

    // Find all scrollable ancestors for all tracked elements and set up scroll listeners
    highlightManager.elements.forEach((element) => {
      let parent = element.parentElement;
      while (parent) {
        const computedStyle = window.getComputedStyle(parent);
        const overflow = computedStyle.overflow + computedStyle.overflowX + computedStyle.overflowY;

        if (overflow.includes('scroll') || overflow.includes('auto')) {
          scrollableElements.add(parent);
        }

        parent = parent.parentElement;
      }
    });

    // Add scroll listeners to all scrollable elements
    scrollableElements.forEach((element) => {
      if (element === window) {
        window.addEventListener('scroll', updateOnScroll);
        window.addEventListener('resize', updateOnScroll);
      } else {
        element.addEventListener('scroll', updateOnScroll);
      }
    });

    const cleanup = () => {
      scrollableElements.forEach((element) => {
        if (element === window) {
          window.removeEventListener('scroll', updateOnScroll);
          window.removeEventListener('resize', updateOnScroll);
        } else {
          (element as Element).removeEventListener('scroll', updateOnScroll);
        }
      });
    };

    return { cleanup };
  };

  const setupObservers = (
    highlightManager: HighlightManager,
    stegaObserver: MutationObserver | undefined
  ) => {
    const resizeObserver = new ResizeObserver(() => {
      highlightManager.updateAllHighlights();
    });

    const observeElementForResize = (element: Element) => {
      resizeObserver.observe(element);
    };

    // Observe existing elements
    highlightManager.elements.forEach(observeElementForResize);
    resizeObserver.observe(document.documentElement);

    // Create highlight observer to watch for new elements with source attributes
    const highlightObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.attributeName === SOURCE_ATTRIBUTE) {
          const target = mutation.target as HTMLElement;
          if (target.hasAttribute(SOURCE_ATTRIBUTE)) {
            highlightManager.createHighlightForElement(target);
            observeElementForResize(target);
          } else {
            highlightManager.removeHighlightForElement(target);
          }
        }

        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const element = node as Element;
              // Check if the added element has source attribute
              if (element.hasAttribute(SOURCE_ATTRIBUTE) && element instanceof HTMLElement) {
                highlightManager.createHighlightForElement(element);
                observeElementForResize(element);
              }
              // Check all child elements for source attributes
              const elementsWithSource = element.querySelectorAll(`[${SOURCE_ATTRIBUTE}]`);
              Array.from(elementsWithSource).forEach((childElement) => {
                if (childElement instanceof HTMLElement) {
                  highlightManager.createHighlightForElement(childElement);
                  observeElementForResize(childElement);
                }
              });
            }
          });

          mutation.removedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const element = node as Element;
              highlightManager.removeHighlightForElement(element);
            }
          });
        }
      });
    });

    highlightObserver.observe(document, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [SOURCE_ATTRIBUTE],
    });

    return {
      resizeObserver,
      highlightObserver,
      stegaObserver,
    };
  };

  const setupEventHandlers = (highlightManager: HighlightManager) => {
    const handleMessage = (event: MessageEvent) => {
      if (!event.data?.type) return;

      // The user edited a field — mechanism-1 path, driven by the hybrid
      // routing gate in the admin. Three shapes arrive here:
      //   - string/number/boolean: set textContent on matched non-media elements.
      //   - media file object (same-type `src` swap): set `src` on matched
      //     img/video elements. The admin only routes here when prev and next
      //     share a MIME category, so tag-swap hazards can't reach this branch.
      //   - blocks tree (leaf-only edit): walk the tree, find each text leaf's
      //     DOM counterpart by its stega-encoded `path`, and patch textContent.
      if (event.data.type === INTERNAL_EVENTS.STRAPI_FIELD_CHANGE) {
        const { field, value } = event.data.payload;
        if (!field) return;

        if (isMediaValue(value)) {
          const nextSrc = (value as { url?: unknown }).url;
          if (typeof nextSrc === 'string') {
            getElementsByPath(field).forEach((element) => {
              if (element instanceof HTMLElement && isMediaElement(element)) {
                if (element.getAttribute('src') !== nextSrc) {
                  element.setAttribute('src', nextSrc);
                }
              }
            });
          }
          highlightManager.updateAllHighlights();
          return;
        }

        if (isBlocksValue(value)) {
          patchBlocksLeaves(field, value);
          highlightManager.updateAllHighlights();
          return;
        }

        getElementsByPath(field).forEach((element) => {
          if (element instanceof HTMLElement && !isMediaElement(element)) {
            element.textContent = value || '';
          }
        });

        // Update highlight dimensions since the new text content may affect them
        highlightManager.updateAllHighlights();
        return;
      }

      // A structural media or blocks edit — mechanism-2 path, only reached
      // when the iframe advertised the matching `features` capability. We
      // don't mutate the DOM from here (cross-type swaps and blocks add /
      // remove / reorder all require the iframe's own framework to reconcile);
      // we just splice the value into the override map and let subscribers
      // (registered via window.strapiPreview.subscribe) render the merged state.
      //
      // IMPORTANT: this handler deliberately lives inside the async block that
      // registers after the stega observer resolves. A synchronous listener
      // would catch the admin's on-mount `strapiFieldOverride` burst (one per
      // opted-in field) before the observer has had a chance to decode the
      // server-side stega in each `<img src>` or block text leaf. Those admin
      // messages carry plain URLs / text, so applying them would overwrite the
      // stega in the DOM and the observer would find nothing to decode —
      // leaving the media element (or block leaf) without the
      // `data-strapi-source` needed for click-to-focus. Dropping the on-mount
      // burst is safe: the iframe already has the same baseline values via its
      // own loader response.
      if (event.data.type === INTERNAL_EVENTS.STRAPI_FIELD_OVERRIDE) {
        const { path, value } = event.data.payload ?? {};
        if (typeof path !== 'string') return;
        previewState.applyFieldOverride(path, value);
        return;
      }

      // The user focused a new input, update the highlights in the preview
      if (event.data.type === INTERNAL_EVENTS.STRAPI_FIELD_FOCUS) {
        const { field } = event.data.payload;
        if (!field) return;

        // Clear existing focused highlights
        highlightManager.focusedHighlights.forEach((highlight: HTMLElement) => {
          highlight.classList.remove('strapi-highlight-focused');
        });
        highlightManager.focusedHighlights.length = 0;

        // Set new focused field and highlight matching elements
        highlightManager.setFocusedField(field);
        getElementsByPath(field).forEach((element, index) => {
          if (index === 0) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
          const highlight =
            highlightManager.highlights[Array.from(highlightManager.elements).indexOf(element)];
          if (highlight) {
            highlight.classList.add('strapi-highlight-focused');
            highlightManager.focusedHighlights.push(highlight);
          }
        });
        return;
      }

      // The user is no longer focusing an input, remove the highlights
      if (event.data.type === INTERNAL_EVENTS.STRAPI_FIELD_BLUR) {
        const { field } = event.data.payload;
        if (field !== highlightManager.getFocusedField()) return;

        highlightManager.focusedHighlights.forEach((highlight: HTMLElement) => {
          highlight.classList.remove('strapi-highlight-focused');
        });
        highlightManager.focusedHighlights.length = 0;
        highlightManager.setFocusedField(null);
      }
    };

    window.addEventListener('message', handleMessage);

    // Add the message handler to the cleanup list
    const messageEventListener = {
      element: window,
      type: 'message' as keyof HTMLElementEventMap,
      handler: handleMessage as EventListener,
    };

    return [...highlightManager.eventListeners, messageEventListener];
  };

  const createCleanupSystem = (
    overlay: HTMLElement,
    observers: ReturnType<typeof setupObservers>,
    scrollManager: ReturnType<typeof setupScrollManagement>,
    eventHandlers: EventListenersList,
    highlightManager: HighlightManager
  ) => {
    window.__strapi_previewCleanup = () => {
      observers.resizeObserver.disconnect();
      observers.highlightObserver.disconnect();
      observers.stegaObserver?.disconnect();

      // Clean up scroll listeners
      scrollManager.cleanup();

      // Clear all pending click timeouts
      highlightManager.clearAllPendingClicks();

      // Remove highlight event listeners
      eventHandlers.forEach(({ element, type, handler }) => {
        element.removeEventListener(type, handler);
      });

      // Clean up CSS styles
      const existingStyles = document.getElementById(HIGHLIGHT_STYLES_ID);
      if (existingStyles) {
        existingStyles.remove();
      }

      overlay.remove();

      // Drop the consumer-facing API and forget any subscribers / overrides,
      // so a second injection starts from a clean slate.
      previewState.reset();
      delete window.strapiPreview;
    };
  };

  /* -----------------------------------------------------------------------------------------------
   * Orchestration
   * ---------------------------------------------------------------------------------------------*/

  setupStegaDOMObserver().then((stegaObserver) => {
    createHighlightStyles();
    const overlay = createOverlaySystem();
    const highlightManager = createHighlightManager(overlay);
    const observers = setupObservers(highlightManager, stegaObserver);
    const scrollManager = setupScrollManagement(highlightManager);
    const eventHandlers = setupEventHandlers(highlightManager);
    createCleanupSystem(overlay, observers, scrollManager, eventHandlers, highlightManager);
  });
};

export { previewScript };
