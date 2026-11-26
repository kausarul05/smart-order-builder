import { Icon } from '@/components/ui/Icon';
import { iconFor } from '@/components/ui/iconFor';
import type { GroupId, Menu, Violation } from '@/domain/types';

/**
 * What is still wrong, and where to fix it.
 *
 * This replaces two dead ends: a flat red list of messages, and the line
 * "Finish a valid configuration to see the price", which said that
 * something was missing without saying what or where.
 *
 * Two things make it useful instead:
 *
 *   It separates UNFINISHED from WRONG. An empty Bread group is not a
 *   mistake, it is a step not taken yet - so it reads as a to-do in the
 *   accent colour. Tofu together with Beef Bacon is genuinely wrong, and
 *   only that gets the red treatment. Showing both as errors teaches
 *   people to ignore the colour.
 *
 *   Every row is a button that scrolls to the group it belongs to, so the
 *   message and the fix are one click apart.
 */

/** Codes that mean "not finished yet" rather than "this is wrong". */
const UNFINISHED = new Set(['min', 'step']);

export interface ValidationPanelProps {
  readonly menu: Menu;
  readonly violations: readonly Violation[];
  /** Groups whose limits are currently satisfied, for the progress bar. */
  readonly satisfiedGroups: number;
  onJump(groupId: GroupId): void;
}

export function ValidationPanel(props: ValidationPanelProps) {
  const { menu, violations, satisfiedGroups } = props;

  const todo = violations.filter((violation) => UNFINISHED.has(violation.code));
  const conflicts = violations.filter((violation) => !UNFINISHED.has(violation.code));
  const total = menu.groups.length;
  const percent = total === 0 ? 0 : Math.round((satisfiedGroups / total) * 100);

  return (
    <section
      className="mt-5 overflow-hidden rounded-2xl border"
      style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
      aria-live="polite"
    >
      <header
        className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-4 py-3"
        style={{ borderColor: 'var(--border)', background: 'var(--surface-muted)' }}
      >
        <span
          aria-hidden
          className="grid size-7 shrink-0 place-items-center rounded-lg"
          style={{
            background: conflicts.length > 0 ? 'var(--danger-soft)' : 'var(--accent-soft)',
            color: conflicts.length > 0 ? 'var(--danger)' : 'var(--accent)',
          }}
        >
          <Icon name={conflicts.length > 0 ? 'close' : 'list'} className="size-4" />
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{headline(todo.length, conflicts.length)}</p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {satisfiedGroups} of {total} categories ready
          </p>
        </div>

        <div className="w-full sm:w-32">
          <div
            className="h-1.5 overflow-hidden rounded-full"
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Categories ready"
            style={{ background: 'var(--border)' }}
          >
            <div
              className="h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none"
              style={{ width: `${percent}%`, background: 'var(--accent)' }}
            />
          </div>
        </div>
      </header>

      <ul>
        {conflicts.map((violation, index) => (
          <Row
            key={`c-${index}`}
            menu={menu}
            violation={violation}
            kind="conflict"
            onJump={props.onJump}
          />
        ))}
        {todo.map((violation, index) => (
          <Row
            key={`t-${index}`}
            menu={menu}
            violation={violation}
            kind="todo"
            onJump={props.onJump}
          />
        ))}
      </ul>
    </section>
  );
}

function headline(todo: number, conflicts: number): string {
  if (conflicts > 0) {
    return conflicts === 1
      ? 'One combination does not work'
      : `${conflicts} combinations do not work`;
  }
  return todo === 1 ? 'One step left' : `${todo} steps left`;
}

function Row(props: {
  readonly menu: Menu;
  readonly violation: Violation;
  readonly kind: 'todo' | 'conflict';
  onJump(groupId: GroupId): void;
}) {
  const { menu, violation, kind } = props;
  const group = groupFor(menu, violation);
  const conflict = kind === 'conflict';

  return (
    <li style={{ borderTop: '1px solid var(--border)' }}>
      <button
        type="button"
        onClick={() => {
          if (group !== undefined) props.onJump(group.id);
        }}
        disabled={group === undefined}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[var(--surface-muted)] disabled:cursor-default motion-reduce:transition-none"
      >
        <span
          aria-hidden
          className="grid size-6 shrink-0 place-items-center rounded-md"
          style={{
            background: conflict ? 'var(--danger-soft)' : 'var(--accent-soft)',
            color: conflict ? 'var(--danger)' : 'var(--accent)',
          }}
        >
          <Icon name={iconFor(group?.icon)} className="size-3.5" />
        </span>

        <span className="min-w-0 flex-1">
          <span className="block text-sm">{violation.message}</span>
          <span className="block text-[11px]" style={{ color: 'var(--text-muted)' }}>
            {conflict ? 'Conflict' : 'To do'}
            {violation.viaOverride !== undefined && ` · rule ${violation.viaOverride}`}
            {group !== undefined && ` · ${group.name}`}
          </span>
        </span>

        {group !== undefined && (
          <span
            aria-hidden
            className="shrink-0 text-xs font-medium"
            style={{ color: 'var(--text-muted)' }}
          >
            Fix →
          </span>
        )}
      </button>
    </li>
  );
}

/**
 * The group a violation belongs to. A group-scoped one names it directly;
 * a cross-group rule is traced back through the option that triggered it,
 * so "Hollandaise requires Scrambled or Omelette" jumps to Sauce.
 */
function groupFor(menu: Menu, violation: Violation) {
  const { scope } = violation;
  if (scope.kind === 'group') {
    return menu.groups.find((group) => group.id === scope.groupId);
  }
  const rule = menu.rules.find((candidate) => candidate.id === scope.ruleId);
  if (rule === undefined) return undefined;
  return menu.groups.find((group) =>
    group.options.some((option) => option.id === rule.option),
  );
}
