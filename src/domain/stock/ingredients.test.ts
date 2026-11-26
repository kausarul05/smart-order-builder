import { describe, expect, it } from 'vitest';

import { minusUsage, usageOfSelection } from './ingredients';
import { DEFAULT_MENU } from '@/fixtures/menu.default';

describe('minusUsage - what the plate being built has already claimed', () => {
  it('takes the draft off the shelf before anything is offered', () => {
    expect(minusUsage({ egg: 10, cheese: 4 }, { egg: 4 })).toEqual({ egg: 6, cheese: 4 });
  });

  it('floors at zero rather than going negative', () => {
    // A draft can out-claim the shelf while it is still only a draft; the
    // answer is "none left", never "-2 left".
    expect(minusUsage({ egg: 2 }, { egg: 5 })).toEqual({ egg: 0 });
  });

  it('leaves an unlimited ingredient unlimited', () => {
    const out = minusUsage({ chili: Number.POSITIVE_INFINITY }, { chili: 3 });
    expect(out.chili).toBe(Number.POSITIVE_INFINITY);
  });

  it('reports an ingredient the shelf never had as zero', () => {
    expect(minusUsage({}, { caviar: 1 })).toEqual({ caviar: 0 });
  });

  it('does not mutate the map it was given', () => {
    const available = { egg: 10 };
    minusUsage(available, { egg: 4 });
    expect(available).toEqual({ egg: 10 });
  });

  it('matches what a real draft consumes', () => {
    // Omelette uses 2 eggs each, Fried 1: four eggs off a shelf of ten.
    const draft = usageOfSelection({ omelette: 1, fried: 2 }, DEFAULT_MENU.groups);
    expect(draft.egg).toBe(4);
    expect(minusUsage({ egg: 10 }, draft).egg).toBe(6);
  });
});
