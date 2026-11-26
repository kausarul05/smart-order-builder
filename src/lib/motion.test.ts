import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { canAnimate, collapseAway, prefersReducedMotion, stagger } from './motion';

/**
 * The exit animation sits between a click and the request that follows it,
 * so the thing that matters is that it ALWAYS resolves - with no Web
 * Animations API, under reduced motion, or on a node that is already gone.
 * If it ever hung, Remove would stop working.
 */

let originalAnimate: typeof Element.prototype.animate | undefined;
let finishers: (() => void)[] = [];

function installFakeAnimate(): void {
  originalAnimate = Element.prototype.animate;
  Element.prototype.animate = function fake(this: Element) {
    let resolve!: () => void;
    const finished = new Promise<void>((done) => {
      resolve = done;
    });
    finishers.push(resolve);
    return { finished, cancel: () => {} } as unknown as Animation;
  } as typeof Element.prototype.animate;
}

function row(): HTMLElement {
  const el = document.createElement('li');
  el.textContent = 'a cart line';
  document.body.append(el);
  el.getBoundingClientRect = () =>
    ({ height: 80, width: 300, top: 0, left: 0, toJSON: () => ({}) }) as DOMRect;
  return el;
}

beforeEach(() => {
  finishers = [];
  document.body.innerHTML = '';
  installFakeAnimate();
});

afterEach(() => {
  if (originalAnimate !== undefined) Element.prototype.animate = originalAnimate;
  else Reflect.deleteProperty(Element.prototype, 'animate');
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('collapseAway', () => {
  it('resolves once the animation finishes', async () => {
    const el = row();
    let done = false;
    const pending = collapseAway(el).then(() => {
      done = true;
    });

    expect(finishers).toHaveLength(1);
    expect(done).toBe(false);

    finishers[0]?.();
    await pending;
    expect(done).toBe(true);
  });

  it('hides the overflow so the row can shrink', async () => {
    const el = row();
    const pending = collapseAway(el);
    expect(el.style.overflow).toBe('hidden');
    finishers[0]?.();
    await pending;
  });

  it('resolves immediately for a missing element', async () => {
    await expect(collapseAway(null)).resolves.toBeUndefined();
    expect(finishers).toHaveLength(0);
  });

  it('resolves immediately under reduced motion', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('reduce'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));

    await expect(collapseAway(row())).resolves.toBeUndefined();
    expect(finishers).toHaveLength(0);
  });

  it('resolves immediately where there is no Web Animations API', async () => {
    Reflect.deleteProperty(Element.prototype, 'animate');
    await expect(collapseAway(row())).resolves.toBeUndefined();
  });

  it('still resolves when the animation is rejected rather than finished', async () => {
    Element.prototype.animate = (() =>
      ({
        finished: Promise.reject(new Error('cancelled')),
        cancel: () => {},
      }) as unknown as Animation) as typeof Element.prototype.animate;

    // A cancelled animation must not leave Remove hanging.
    await expect(collapseAway(row())).resolves.toBeUndefined();
  });
});

describe('environment guards', () => {
  it('reports the Web Animations API when it is there', () => {
    expect(canAnimate()).toBe(true);
    Reflect.deleteProperty(Element.prototype, 'animate');
    expect(canAnimate()).toBe(false);
  });

  it('reports reduced motion only when asked for', () => {
    expect(prefersReducedMotion()).toBe(false);
    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    expect(prefersReducedMotion()).toBe(true);
  });
});

describe('stagger', () => {
  it('animates every element once', () => {
    stagger([row(), row(), row()]);
    expect(finishers).toHaveLength(3);
  });

  it('does nothing under reduced motion', () => {
    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    stagger([row(), row()]);
    expect(finishers).toHaveLength(0);
  });

  it('does nothing with an empty list', () => {
    stagger([]);
    expect(finishers).toHaveLength(0);
  });
});
