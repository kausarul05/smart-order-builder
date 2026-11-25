import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { flyTo, pulse, registerFlyTarget } from './flyTo';

/**
 * The target registry is module state, so each test unregisters what it
 * registered - otherwise a target would leak into the next test.
 */
const cleanups: (() => void)[] = [];

function register(key: 'draft' | 'cart', el: HTMLElement): () => void {
  const off = registerFlyTarget(key, el);
  cleanups.push(off);
  return off;
}

/**
 * The animation is cosmetic, so what matters is that it never gets in the
 * way: it has to bail out quietly wherever it cannot run, and it must not
 * leave its ghost element behind.
 */

interface FakeAnimation {
  fire(event: 'finish' | 'cancel'): void;
}

let animations: FakeAnimation[] = [];
let originalAnimate: typeof Element.prototype.animate | undefined;

/** jsdom has no Web Animations API, so one is stood up for the test. */
function installFakeAnimate(): void {
  originalAnimate = Element.prototype.animate;
  Element.prototype.animate = function fake(this: Element) {
    const listeners = new Map<string, (() => void)[]>();
    const animation = {
      addEventListener(type: string, handler: () => void) {
        const bucket = listeners.get(type) ?? [];
        bucket.push(handler);
        listeners.set(type, bucket);
      },
      cancel() {},
      finish() {},
    };
    animations.push({
      fire: (event) => {
        for (const handler of listeners.get(event) ?? []) handler();
      },
    });
    return animation as unknown as Animation;
  } as typeof Element.prototype.animate;
}

function sized(el: HTMLElement, rect: Partial<DOMRect>): HTMLElement {
  el.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 100,
      bottom: 100,
      width: 100,
      height: 100,
      toJSON: () => ({}),
      ...rect,
    }) as DOMRect;
  // offsetParent is null in jsdom; the fallback path uses getClientRects.
  el.getClientRects = (() => [el.getBoundingClientRect()]) as unknown as typeof el.getClientRects;
  return el;
}

function addEl(rect: Partial<DOMRect>): HTMLElement {
  const el = document.createElement('div');
  document.body.append(el);
  return sized(el, rect);
}

const ghosts = () =>
  [...document.body.children].filter(
    (child) => child.getAttribute('aria-hidden') === 'true',
  );

beforeEach(() => {
  animations = [];
  document.body.innerHTML = '';
  installFakeAnimate();
});

afterEach(() => {
  for (const off of cleanups.splice(0)) off();
  if (originalAnimate !== undefined) Element.prototype.animate = originalAnimate;
  else Reflect.deleteProperty(Element.prototype, 'animate');
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('flyTo', () => {
  it('does nothing when no target is registered', () => {
    const from = addEl({ left: 0, top: 0 });
    expect(flyTo('cart', from)).toBe(false);
    expect(ghosts()).toHaveLength(0);
  });

  it('flies a ghost to a registered target and cleans it up', () => {
    const from = addEl({ left: 10, top: 10, width: 60, height: 60 });
    const target = addEl({ left: 500, top: 300, width: 40, height: 40 });
    register('cart', target);

    expect(flyTo('cart', from, { imageSrc: '/img/options/toast.svg' })).toBe(true);
    expect(ghosts()).toHaveLength(1);
    expect(ghosts()[0]?.querySelector('img')?.getAttribute('src')).toBe(
      '/img/options/toast.svg',
    );

    // Two animations run: the flight, then the pulse on arrival.
    animations[0]?.fire('finish');
    expect(ghosts()).toHaveLength(0);
    expect(animations.length).toBe(2);
  });

  it('removes the ghost if the animation is cancelled', () => {
    const from = addEl({ left: 0, top: 0 });
    register('cart', addEl({ left: 400, top: 400 }));

    flyTo('cart', from);
    expect(ghosts()).toHaveLength(1);
    animations[0]?.fire('cancel');
    expect(ghosts()).toHaveLength(0);
  });

  it('stops flying once the target unregisters', () => {
    const from = addEl({ left: 0, top: 0 });
    const target = addEl({ left: 400, top: 400 });
    const unregister = register('cart', target);

    expect(flyTo('cart', from)).toBe(true);
    unregister();
    expect(flyTo('cart', from)).toBe(false);
  });

  it('keeps the draft and cart targets apart', () => {
    const from = addEl({ left: 0, top: 0 });
    register('draft', addEl({ left: 200, top: 200 }));

    expect(flyTo('draft', from)).toBe(true);
    expect(flyTo('cart', from)).toBe(false);
  });

  it('bails out when the viewer asked for reduced motion', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('reduce'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    register('cart', addEl({ left: 400, top: 400 }));

    expect(flyTo('cart', addEl({ left: 0, top: 0 }))).toBe(false);
    expect(ghosts()).toHaveLength(0);
  });

  it('bails out where there is no Web Animations API at all', () => {
    Reflect.deleteProperty(Element.prototype, 'animate');
    register('cart', addEl({ left: 400, top: 400 }));

    expect(flyTo('cart', addEl({ left: 0, top: 0 }))).toBe(false);
    expect(ghosts()).toHaveLength(0);
  });

  it('bails out for a zero-sized source', () => {
    register('cart', addEl({ left: 400, top: 400 }));
    expect(flyTo('cart', addEl({ width: 0, height: 0 }))).toBe(false);
  });
});

describe('pulse', () => {
  it('ignores a missing element', () => {
    expect(() => pulse(null)).not.toThrow();
    expect(animations).toHaveLength(0);
  });

  it('animates an element that is there', () => {
    pulse(addEl({ left: 0, top: 0 }));
    expect(animations).toHaveLength(1);
  });
});
