import { useEffect, useRef, useState } from 'react';

import { Icon } from '@/components/ui/Icon';
import { formatPoisha } from '@/domain/money';
import type { Menu, MenuGroup, MenuOption } from '@/domain/types';
import { flyTo } from '@/lib/flyTo';
import { stagger } from '@/lib/motion';

export type GridDensity = 'grid' | 'list';

/**
 * The product grid: one section per group, cards with the artwork on top.
 *
 * Accessible names are deliberate - "Add one Toast" / "Remove one Toast" -
 * because that is what the acceptance tests drive, and it is what a screen
 * reader needs anyway.
 */
export function ProductGrid(props: {
  readonly menu: Menu;
  readonly selection: Readonly<Record<string, number>>;
  readonly headroom: Readonly<Record<string, number>>;
  readonly density: GridDensity;
  readonly query: string;
  readonly disabled: boolean;
  onChange(optionId: string, delta: number): void;
}) {
  const { menu, selection, headroom, density, query, disabled } = props;
  const needle = query.trim().toLowerCase();

  // A short staggered fade-up the first time the grid paints, and again
  // whenever a search narrows it to a different set.
  const gridRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = gridRef.current;
    if (root === null) return;
    stagger([...root.querySelectorAll<HTMLElement>('[data-tile]')]);
  }, [needle, density]);

  const sections = menu.groups
    .map((group) => ({
      group,
      options:
        needle === ''
          ? group.options
          : group.options.filter((option) =>
              option.name.toLowerCase().includes(needle),
            ),
    }))
    .filter((section) => section.options.length > 0);

  if (sections.length === 0) {
    return (
      <p className="py-10 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
        Nothing on the menu matches “{query}”.
      </p>
    );
  }

  return (
    <div ref={gridRef} className="space-y-7">
      {sections.map(({ group, options }) => (
        <section key={group.id} id={`group-${group.id}`} aria-labelledby={`h-${group.id}`}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <h3 id={`h-${group.id}`} className="text-[15px] font-semibold">
              {group.name}
            </h3>
            <p className="tnum text-xs" style={{ color: 'var(--text-muted)' }}>
              {describeLimits(group)}
            </p>
          </div>

          <ul
            className={
              density === 'grid'
                ? 'mt-3 grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-4'
                : 'mt-3 space-y-2'
            }
          >
            {options.map((option) => (
              <OptionCard
                key={option.id}
                option={option}
                units={selection[option.id] ?? 0}
                headroom={headroom[option.id] ?? 0}
                density={density}
                disabled={disabled}
                onChange={(delta) => props.onChange(option.id, delta)}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function OptionCard(props: {
  readonly option: MenuOption;
  readonly units: number;
  readonly headroom: number;
  readonly density: GridDensity;
  readonly disabled: boolean;
  onChange(delta: number): void;
}) {
  const { option, units, headroom, density, disabled } = props;
  const soldOut = headroom <= 0;

  const thumbRef = useRef<HTMLDivElement>(null);
  const countRef = useRef<HTMLSpanElement>(null);
  const previous = useRef(units);

  // A count that changed gets a short bump, so the eye follows it.
  useEffect(() => {
    const node = countRef.current;
    if (node === null || previous.current === units) return;
    previous.current = units;
    node.classList.remove('bump');
    // Force a reflow so the animation restarts on a repeated press.
    void node.offsetWidth;
    node.classList.add('bump');
  }, [units]);

  const add = (): void => {
    props.onChange(1);
    // A ghost of this dish flies into the Add to Cart button: it shows
    // where the thing you just picked went.
    if (thumbRef.current !== null) {
      flyTo('draft', thumbRef.current, {
        imageSrc: option.image,
        size: 44,
        lift: 48,
        durationMs: 480,
      });
    }
  };

  const stepper = (
    <div className="flex items-center gap-1.5">
      {units > 0 && (
        <>
          <button
            type="button"
            aria-label={`Remove one ${option.name}`}
            disabled={disabled}
            onClick={() => props.onChange(-1)}
            className="stepper"
          >
            <Icon name="minus" className="size-4" />
          </button>
          <span ref={countRef} className="tnum inline-block w-5 text-center text-sm font-semibold">
            {units}
          </span>
        </>
      )}
      <button
        type="button"
        aria-label={`Add one ${option.name}`}
        disabled={disabled || soldOut}
        onClick={add}
        className={soldOut || disabled ? 'stepper' : 'stepper stepper-primary'}
      >
        <Icon name="plus" className="size-4" />
      </button>
    </div>
  );

  // The headroom pill earns its colour: red at zero, amber when it is
  // nearly gone, quiet otherwise.
  const tone = soldOut
    ? { background: 'var(--danger-soft)', color: 'var(--danger)' }
    : Number.isFinite(headroom) && headroom <= 2
      ? { background: 'var(--warn-soft)', color: 'var(--warn)' }
      : { background: 'var(--surface-muted)', color: 'var(--text-muted)' };

  const headroomLine = (
    <span className="chip tnum" style={tone}>
      {Number.isFinite(headroom) ? `${headroom} more can be added` : 'unlimited'}
    </span>
  );

  if (density === 'list') {
    return (
      <li
        data-tile
        className="tile group flex items-center gap-3 p-2.5"
        data-selected={units > 0}
        data-disabled={soldOut && units === 0}
      >
        <Thumb
          ref={thumbRef}
          option={option}
          className="size-14 rounded-xl"
          soldOut={soldOut && units === 0}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{option.name}</p>
          <p className="tnum text-sm font-semibold">{priceLabel(option)}</p>
          <div className="mt-0.5">{headroomLine}</div>
        </div>
        {stepper}
      </li>
    );
  }

  return (
    <li
      data-tile
      className="tile group relative flex flex-col overflow-hidden"
      data-selected={units > 0}
      data-disabled={soldOut && units === 0}
    >
      <div className="relative">
        <Thumb
          ref={thumbRef}
          option={option}
          className="aspect-[4/3] w-full rounded-none"
          soldOut={soldOut && units === 0}
        />
        {units > 0 && (
          <span
            className="tnum absolute left-2 top-2 grid min-w-6 place-items-center rounded-lg px-1.5 py-0.5 text-xs font-bold shadow"
            style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
          >
            {units}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1 p-3">
        <p className="line-clamp-2 text-sm font-medium leading-snug">{option.name}</p>
        <div>{headroomLine}</div>
        <div className="mt-auto flex items-center justify-between gap-2 pt-1.5">
          <p className="tnum text-base font-bold">{priceLabel(option)}</p>
          {stepper}
        </div>
      </div>
    </li>
  );
}

function priceLabel(option: MenuOption): string {
  return option.price === 0 ? 'Free' : formatPoisha(option.price);
}

/**
 * The artwork comes from the menu, so a different fixture brings its own -
 * or photographs - with no code change. A fixture without one shows the
 * option's initials rather than a broken image.
 */
function Thumb(props: {
  readonly ref?: React.Ref<HTMLDivElement>;
  readonly option: MenuOption;
  readonly className: string;
  readonly soldOut: boolean;
}) {
  const { option, soldOut } = props;
  const [failed, setFailed] = useState(false);
  const show = option.image !== undefined && !failed;

  return (
    <div
      ref={props.ref}
      className={`thumb relative grid shrink-0 place-items-center overflow-hidden ${props.className}`}
    >
      {show ? (
        <img
          src={option.image}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="size-full object-cover transition-transform duration-300 group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
        />
      ) : (
        <span
          aria-hidden
          className="text-sm font-semibold"
          style={{ color: 'var(--text-muted)' }}
        >
          {initials(option.name)}
        </span>
      )}

      {soldOut && (
        <span
          className="absolute inset-0 grid place-items-center text-[11px] font-semibold uppercase tracking-wide backdrop-blur-[1px]"
          style={{ background: 'var(--surface-raised)', color: 'var(--danger)' }}
        >
          Out of stock
        </span>
      )}
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0] ?? '')
    .join('')
    .toUpperCase();
}

function describeLimits(group: MenuGroup): string {
  const { limits } = group;
  const parts: string[] = [];
  if (limits.min !== undefined) parts.push(`min ${limits.min}`);
  if (limits.max !== undefined) parts.push(`max ${limits.max}`);
  if (limits.step !== undefined) parts.push(`step ${limits.step}`);
  if (limits.maxDistinct !== undefined) parts.push(`max ${limits.maxDistinct} distinct`);
  if (limits.maxPerOption !== undefined) parts.push(`max ${limits.maxPerOption} each`);
  return parts.length === 0 ? 'no limits' : parts.join(' · ');
}
