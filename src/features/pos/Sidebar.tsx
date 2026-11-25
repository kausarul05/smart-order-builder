import { useState } from 'react';

import { Icon } from '@/components/ui/Icon';
import { iconFor } from '@/components/ui/iconFor';
import { useTheme, type ThemeChoice } from '@/components/ui/useTheme';
import { formatInZone } from '@/domain/time';
import type { Ingredient, IngredientId, Menu, MenuGroup, Selection } from '@/domain/types';
import { SERVER_TIME_ZONE } from '@/server/clock';

/**
 * The category rail.
 *
 * It scrolls to a group rather than filtering to it, because every group
 * here has a minimum or a maximum the customer must satisfy - hiding four
 * of them behind a tab would mean hunting for whatever is still wrong.
 *
 * So the rail does the job a tab bar cannot: each row shows how many units
 * are picked against what the group needs, a meter fills as it is
 * satisfied, and a tick replaces the count once it is. The banner at the
 * top says in one line whether the plate can be added yet.
 */
export function Sidebar(props: {
  readonly menu: Menu;
  readonly selection: Selection;
  readonly activeGroupId: string | null;
  readonly violationGroupIds: ReadonlySet<string>;
  readonly available: Readonly<Record<IngredientId, number>>;
  readonly now: Date;
  readonly issueCount: number;
  onJump(groupId: string): void;
}) {
  const { menu, selection, activeGroupId, violationGroupIds, issueCount } = props;
  const sections = groupBySection(menu.groups);
  const picked = totalPicked(selection, menu.groups);

  return (
    <div className="nav-surface flex h-full flex-col" style={{ color: 'var(--nav-text)' }}>
      {/* --------------------------------------------------------- brand */}
      <div
        className="flex items-center gap-2.5 px-4 py-4"
        style={{ borderBottom: '1px solid var(--nav-border)' }}
      >
        <span
          aria-hidden
          className="grid size-9 shrink-0 place-items-center rounded-xl"
          style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
        >
          <Icon name="dish" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">Smart Order</p>
          <p className="truncate text-[11px]" style={{ color: 'var(--nav-muted)' }}>
            {menu.productName}
          </p>
        </div>
      </div>

      {/* --------------------------------------------- what is left to do */}
      <div className="px-3 pt-3">
        <div
          className="rounded-xl px-3 py-2.5"
          style={{
            background: issueCount === 0 ? 'var(--ok-soft)' : 'var(--nav-active)',
            border: `1px solid ${issueCount === 0 ? 'var(--ok)' : 'transparent'}`,
          }}
        >
          <p
            className="text-xs font-semibold"
            style={{ color: issueCount === 0 ? 'var(--ok)' : 'var(--nav-text)' }}
          >
            {picked === 0
              ? 'Start a plate'
              : issueCount === 0
                ? 'Ready to add'
                : `${issueCount} thing${issueCount === 1 ? '' : 's'} to fix`}
          </p>
          <p className="mt-0.5 text-[11px] leading-snug" style={{ color: 'var(--nav-muted)' }}>
            {picked === 0
              ? 'Pick a bread, two eggs and a protein to begin.'
              : issueCount === 0
                ? `${picked} item${picked === 1 ? '' : 's'} chosen — the plate is valid.`
                : 'The marked categories below still need attention.'}
          </p>
        </div>
      </div>

      {/* ------------------------------------------------------ categories */}
      <nav aria-label="Menu categories" className="flex-1 overflow-y-auto px-3 py-3">
        {sections.map(([section, groups]) => (
          <div key={section} className="mb-4">
            <p
              className="px-1 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em]"
              style={{ color: 'var(--nav-muted)' }}
            >
              {section}
            </p>
            <ul className="space-y-0.5">
              {groups.map((group) => (
                <li key={group.id}>
                  <CategoryRow
                    group={group}
                    selection={selection}
                    active={group.id === activeGroupId}
                    broken={violationGroupIds.has(group.id)}
                    onJump={() => props.onJump(group.id)}
                  />
                </li>
              ))}
            </ul>
          </div>
        ))}

        <StockSection available={props.available} ingredients={menu.ingredients} />
      </nav>

      {/* ---------------------------------------------------------- footer */}
      <div
        className="space-y-2.5 px-3 py-3"
        style={{ borderTop: '1px solid var(--nav-border)' }}
      >
        <ThemeToggle />
        <div className="flex items-center gap-2.5 px-1">
          <span
            aria-hidden
            className="grid size-8 shrink-0 place-items-center rounded-full"
            style={{ background: 'var(--nav-active)', color: 'var(--nav-muted)' }}
          >
            <Icon name="clock" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[11px]" style={{ color: 'var(--nav-muted)' }}>
              Server clock · {SERVER_TIME_ZONE}
            </p>
            <p className="tnum truncate text-xs font-medium">
              {formatInZone(props.now, SERVER_TIME_ZONE)}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * One category. The meter is the useful part: it answers "how far through
 * this group am I" without opening it.
 */
function CategoryRow(props: {
  readonly group: MenuGroup;
  readonly selection: Selection;
  readonly active: boolean;
  readonly broken: boolean;
  onJump(): void;
}) {
  const { group, selection, active, broken } = props;
  const units = countIn(selection, group);
  const { min, max } = group.limits;

  // Satisfied means at or above any minimum and not over any maximum.
  const satisfied = units >= (min ?? 0) && (max === undefined || units <= max);
  const goal = max ?? min ?? 0;
  const fill = goal === 0 ? (units > 0 ? 100 : 0) : Math.min(100, (units / goal) * 100);
  const colour = broken
    ? 'var(--danger)'
    : satisfied && units > 0
      ? 'var(--ok)'
      : 'var(--accent)';

  return (
    <button
      type="button"
      className="nav-item !flex-col !items-stretch"
      aria-current={active}
      onClick={props.onJump}
    >
      <span className="flex w-full items-center gap-2.5">
        <Icon name={iconFor(group.icon)} />
        <span className="flex-1 truncate">{group.name}</span>

        {broken ? (
          <span
            aria-label="needs attention"
            className="grid size-4 place-items-center rounded-full text-[10px] font-bold"
            style={{ background: 'var(--danger)', color: '#fff' }}
          >
            !
          </span>
        ) : units > 0 && satisfied ? (
          <span
            aria-label="satisfied"
            className="grid size-4 place-items-center rounded-full text-[10px] font-bold"
            style={{ background: 'var(--ok)', color: '#fff' }}
          >
            ✓
          </span>
        ) : null}

        <span className="tnum text-[11px]" style={{ color: 'var(--nav-muted)' }}>
          {describeProgress(units, min, max)}
        </span>
      </span>

      <span className="meter mt-1.5 w-full">
        <span style={{ width: `${fill}%`, background: colour }} />
      </span>
    </button>
  );
}

function describeProgress(
  units: number,
  min: number | undefined,
  max: number | undefined,
): string {
  if (max !== undefined) return `${units}/${max}`;
  if (min !== undefined) return `${units}/${min}+`;
  return String(units);
}

/**
 * Live shared stock. It is reference material while building, not
 * something to act on, so it collapses out of the way - and it says how
 * many ingredients have run out without being opened.
 */
function StockSection(props: {
  readonly available: Readonly<Record<IngredientId, number>>;
  readonly ingredients: readonly Ingredient[];
}) {
  const [open, setOpen] = useState(true);
  const out = props.ingredients.filter(
    (ingredient) => (props.available[ingredient.id] ?? 0) === 0,
  ).length;

  return (
    <section className="mb-2">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-1 pb-1.5"
      >
        <h2
          className="text-[10px] font-semibold uppercase tracking-[0.08em]"
          style={{ color: 'var(--nav-muted)' }}
        >
          Shared stock
        </h2>
        {out > 0 && (
          <span
            className="tnum rounded-md px-1.5 text-[10px] font-semibold"
            style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}
          >
            {out} out
          </span>
        )}
        <span aria-hidden className="ml-auto text-[10px]" style={{ color: 'var(--nav-muted)' }}>
          {open ? '▾' : '▸'}
        </span>
      </button>

      {open && (
        <ul className="space-y-1 px-1">
          {props.ingredients.map((ingredient) => {
            const left = props.available[ingredient.id] ?? 0;
            const low = left > 0 && left <= 2;
            return (
              <li
                key={ingredient.id}
                className="tnum flex items-baseline justify-between gap-2 text-xs"
              >
                <span className="truncate" style={{ color: 'var(--nav-muted)' }}>
                  {ingredient.name}
                </span>
                <span
                  className="rounded px-1 font-medium"
                  style={
                    left === 0
                      ? { background: 'var(--danger-soft)', color: 'var(--danger)' }
                      : low
                        ? { color: 'var(--warn)' }
                        : { color: 'var(--nav-text)' }
                  }
                >
                  {left}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Light / dark / system, so the palette is not at the mercy of the OS. */
function ThemeToggle() {
  const { choice, setChoice } = useTheme();
  const options: readonly (readonly [ThemeChoice, string])[] = [
    ['light', 'Light'],
    ['dark', 'Dark'],
    ['system', 'Auto'],
  ];

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className="flex gap-0.5 rounded-lg p-0.5"
      style={{ background: 'var(--nav-active)' }}
    >
      {options.map(([value, label]) => {
        const picked = choice === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={picked}
            onClick={() => setChoice(value)}
            className="flex-1 rounded-md py-1 text-[11px] font-medium"
            style={
              picked
                ? { background: 'var(--accent)', color: 'var(--accent-ink)' }
                : { color: 'var(--nav-muted)' }
            }
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function groupBySection(
  groups: readonly MenuGroup[],
): readonly [string, readonly MenuGroup[]][] {
  const out = new Map<string, MenuGroup[]>();
  for (const group of groups) {
    const key = group.section ?? 'Menu';
    const bucket = out.get(key);
    if (bucket === undefined) out.set(key, [group]);
    else bucket.push(group);
  }
  return [...out.entries()];
}

function countIn(selection: Selection, group: MenuGroup): number {
  let total = 0;
  for (const option of group.options) total += selection[option.id] ?? 0;
  return total;
}

function totalPicked(selection: Selection, groups: readonly MenuGroup[]): number {
  let total = 0;
  for (const group of groups) total += countIn(selection, group);
  return total;
}
