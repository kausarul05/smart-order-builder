/**
 * The "it flew into the cart" animation.
 *
 * A ghost of the thing you picked is cloned, positioned over the element
 * you pressed, and flown along a shallow arc into whichever drop target is
 * currently on screen. It is cosmetic by design: everything here bails out
 * quietly rather than ever standing between a tap and the request.
 *
 * It refuses to run when
 *   - the viewer asked for reduced motion,
 *   - no target is registered or none is visible,
 *   - the environment has no Web Animations API (jsdom, during tests).
 *
 * Only `transform` and `opacity` are animated, so it stays on the
 * compositor and never reflows the grid underneath.
 */

export type FlyTargetKey = 'draft' | 'cart';

const targets = new Map<FlyTargetKey, Set<HTMLElement>>();

/** Call with the element, and again with null on unmount. */
export function registerFlyTarget(key: FlyTargetKey, el: HTMLElement | null): () => void {
  const bucket = targets.get(key) ?? new Set<HTMLElement>();
  targets.set(key, bucket);
  if (el !== null) bucket.add(el);
  return () => {
    if (el !== null) bucket.delete(el);
  };
}

/** The registered target that is actually laid out right now. */
function visibleTarget(key: FlyTargetKey): HTMLElement | null {
  for (const el of targets.get(key) ?? []) {
    // offsetParent is null for display:none, which is how the responsive
    // layout hides the desktop rail or the phone bar.
    if (el.offsetParent !== null || el.getClientRects().length > 0) return el;
  }
  return null;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function canAnimate(): boolean {
  return (
    typeof document !== 'undefined' &&
    typeof Element !== 'undefined' &&
    typeof Element.prototype.animate === 'function'
  );
}

export interface FlyOptions {
  /** Artwork to fly. Without one a plain dot is used. */
  readonly imageSrc?: string | undefined;
  readonly durationMs?: number;
  /** How high the arc lifts, in pixels. */
  readonly lift?: number;
  /** Size of the ghost in pixels. */
  readonly size?: number;
}

/**
 * Flies a ghost from `from` into the current target for `key`.
 * Returns true when an animation actually started.
 */
export function flyTo(key: FlyTargetKey, from: Element, options: FlyOptions = {}): boolean {
  if (!canAnimate() || prefersReducedMotion()) return false;

  const target = visibleTarget(key);
  if (target === null) return false;

  const start = from.getBoundingClientRect();
  const end = target.getBoundingClientRect();
  if (start.width === 0 || end.width === 0) return false;

  const size = options.size ?? 56;
  const duration = options.durationMs ?? 620;
  const lift = options.lift ?? 90;

  const ghost = document.createElement('div');
  ghost.setAttribute('aria-hidden', 'true');
  Object.assign(ghost.style, {
    position: 'fixed',
    left: `${start.left + start.width / 2 - size / 2}px`,
    top: `${start.top + start.height / 2 - size / 2}px`,
    width: `${size}px`,
    height: `${size}px`,
    borderRadius: '14px',
    overflow: 'hidden',
    pointerEvents: 'none',
    zIndex: '60',
    boxShadow: '0 12px 28px -8px rgb(16 26 44 / 0.45)',
    background: 'var(--accent)',
  } satisfies Partial<CSSStyleDeclaration>);

  if (options.imageSrc !== undefined) {
    const img = document.createElement('img');
    img.src = options.imageSrc;
    img.alt = '';
    Object.assign(img.style, {
      width: '100%',
      height: '100%',
      objectFit: 'cover',
      display: 'block',
    } satisfies Partial<CSSStyleDeclaration>);
    ghost.append(img);
  }

  document.body.append(ghost);

  const dx = end.left + end.width / 2 - (start.left + start.width / 2);
  const dy = end.top + end.height / 2 - (start.top + start.height / 2);

  const animation = ghost.animate(
    [
      { transform: 'translate3d(0,0,0) scale(1)', opacity: 1, offset: 0 },
      {
        transform: `translate3d(${dx * 0.5}px, ${dy * 0.5 - lift}px, 0) scale(0.72) rotate(-8deg)`,
        opacity: 0.95,
        offset: 0.55,
      },
      {
        transform: `translate3d(${dx}px, ${dy}px, 0) scale(0.16) rotate(4deg)`,
        opacity: 0.1,
        offset: 1,
      },
    ],
    { duration, easing: 'cubic-bezier(.4,.05,.3,1)', fill: 'forwards' },
  );

  animation.addEventListener('finish', () => {
    ghost.remove();
    pulse(target);
  });
  animation.addEventListener('cancel', () => ghost.remove());

  return true;
}

/** A short squash-and-stretch on the thing that just received something. */
export function pulse(el: Element | null): void {
  if (el === null || !canAnimate() || prefersReducedMotion()) return;
  el.animate(
    [
      { transform: 'scale(1)' },
      { transform: 'scale(1.14)', offset: 0.4 },
      { transform: 'scale(1)' },
    ],
    { duration: 380, easing: 'cubic-bezier(.3,1.4,.4,1)' },
  );
}
