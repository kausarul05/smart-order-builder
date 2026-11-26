/**
 * List motion, by hand.
 *
 * Two things are awkward without an animation library, and both are here:
 *
 *   collapseAway  an EXIT animation. React removes a node the moment state
 *                 changes, so the row is animated out first and removed
 *                 only when that finishes.
 *
 *   useFlipList   FLIP. Positions are measured before the update and after
 *                 it; each row is then transformed back to where it was
 *                 and released, so rows slide to their new places instead
 *                 of jumping.
 *
 * Both are cosmetic and fail open: no Web Animations API (jsdom, during
 * tests), or `prefers-reduced-motion`, and they resolve immediately
 * without animating. Only `transform` and `opacity` move, so nothing here
 * triggers layout.
 */

import { useLayoutEffect, useRef } from 'react';

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function canAnimate(): boolean {
  return (
    typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function'
  );
}

/**
 * Shrinks a row away and resolves when it is safe to unmount it. Resolves
 * immediately where it cannot animate, so the caller never has to branch.
 */
export async function collapseAway(el: HTMLElement | null): Promise<void> {
  if (el === null || !canAnimate() || prefersReducedMotion()) return;

  const { height } = el.getBoundingClientRect();
  const style = getComputedStyle(el);
  const gap = parseFloat(style.marginBottom) || 0;

  // The wrapper is what collapses, so siblings move up with it rather than
  // snapping once the row is gone.
  el.style.overflow = 'hidden';

  const animation = el.animate(
    [
      { height: `${height}px`, opacity: 1, transform: 'translateX(0)', marginBottom: `${gap}px` },
      { height: '0px', opacity: 0, transform: 'translateX(12px)', marginBottom: '0px' },
    ],
    { duration: 220, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' },
  );

  await animation.finished.catch(() => undefined);
}

/**
 * FLIP for a list. Put the returned ref on the container and give every
 * child a stable `data-flip-key`.
 *
 * `signature` must change whenever the list could have moved - pass
 * something cheap like the joined ids.
 */
export function useFlipList<T extends HTMLElement>(signature: string) {
  const containerRef = useRef<T>(null);
  const previous = useRef(new Map<string, DOMRect>());

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (container === null) return;

    const rows = [...container.querySelectorAll<HTMLElement>('[data-flip-key]')];
    const before = previous.current;
    const after = new Map<string, DOMRect>();

    for (const row of rows) {
      const key = row.dataset.flipKey;
      if (key === undefined) continue;
      const rect = row.getBoundingClientRect();
      after.set(key, rect);

      const old = before.get(key);
      if (old === undefined) continue; // new row: its own enter animation runs
      if (!canAnimate() || prefersReducedMotion()) continue;

      const dy = old.top - rect.top;
      if (Math.abs(dy) < 1) continue;

      row.animate(
        [{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }],
        { duration: 240, easing: 'cubic-bezier(.4,0,.2,1)' },
      );
    }

    previous.current = after;
  }, [signature]);

  return containerRef;
}

/**
 * A short staggered fade-up over a set of elements, used when a grid first
 * paints. Index-based delay, capped so a long list does not crawl in.
 */
export function stagger(els: readonly HTMLElement[], stepMs = 24): void {
  if (!canAnimate() || prefersReducedMotion()) return;
  els.forEach((el, index) => {
    el.animate(
      [
        { opacity: 0, transform: 'translateY(8px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ],
      {
        duration: 260,
        delay: Math.min(index * stepMs, 300),
        easing: 'cubic-bezier(.2,.7,.3,1)',
        fill: 'backwards',
      },
    );
  });
}
