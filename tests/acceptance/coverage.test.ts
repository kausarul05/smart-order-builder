/**
 * Section 9 coverage map, as a test rather than as a comment.
 *
 * Every acceptance test id from the brief (TC-01 .. TC-20) must be named by
 * a real test file. A comment claiming coverage drifts; this fails the
 * suite if a test case is ever renamed or deleted out from under its id.
 *
 *   TC-01 .. TC-04   rules.test.ts
 *   TC-05 .. TC-07   pricing.test.ts
 *   TC-08 .. TC-11   stock.test.ts            (+ cart.test.ts on the server)
 *   TC-12            price-preview.test.tsx   (+ src/lib/latestOnly.test.ts)
 *   TC-13 .. TC-15   cart.test.ts
 *   TC-16 .. TC-17   orders.test.ts
 *   TC-18 .. TC-20   assistant.test.ts
 *   Part G           part-g.test.ts, part-g-draft.test.tsx
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Vitest runs with the project root as cwd, so this holds on every OS. */
const HERE = join(process.cwd(), 'tests', 'acceptance');

/** Every test file in this folder, read once. */
const SOURCES: readonly { readonly name: string; readonly text: string }[] = readdirSync(HERE)
  .filter((name) => /\.test\.tsx?$/.test(name) && name !== 'coverage.test.ts')
  .map((name) => ({ name, text: readFileSync(join(HERE, name), 'utf8') }));

const ids = Array.from({ length: 20 }, (_, index) => `TC-${String(index + 1).padStart(2, '0')}`);

describe('Section 9 - every acceptance test id has a test', () => {
  it.each(ids)('%s is covered', (id) => {
    const owners = SOURCES.filter((source) => source.text.includes(id)).map(
      (source) => source.name,
    );
    expect(owners, `${id} is not named by any acceptance test file`).not.toHaveLength(0);
  });
});

describe('Part G - the bonus has real tests, not placeholders', () => {
  it('covers all three bonus requirements', () => {
    const names = SOURCES.map((source) => source.name);
    expect(names).toContain('part-g.test.ts');
    expect(names).toContain('part-g-draft.test.tsx');
  });

  it('leaves no placeholder tests behind', () => {
    const pending = SOURCES.filter((source) => /\bit\.todo\b|\bit\.skip\b/.test(source.text));
    expect(pending.map((source) => source.name)).toEqual([]);
  });
});
