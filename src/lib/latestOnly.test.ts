/**
 * The mechanism behind TC-12. Tested here in isolation, where a superseded
 * response can be made to land LAST on purpose - which is the case the
 * brief cares about and the hardest one to arrange through the UI.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { LatestOnly, debounce } from './latestOnly';

/** A promise plus the handles to settle it whenever the test likes. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('LatestOnly', () => {
  it('delivers a lone request', async () => {
    const latest = new LatestOnly();
    const result = await latest.run(() => Promise.resolve('price-1'));
    expect(result).toEqual({ fresh: true, value: 'price-1' });
  });

  it('drops an older response that lands AFTER a newer one', async () => {
    const latest = new LatestOnly();
    const slow = deferred<string>();
    const fast = deferred<string>();

    const first = latest.run(() => slow.promise); // the 1500 ms one
    const second = latest.run(() => fast.promise); // the 200 ms one

    // The newer request answers first...
    fast.resolve('price-for-newer-config');
    await expect(second).resolves.toEqual({
      fresh: true,
      value: 'price-for-newer-config',
    });

    // ...and the older one answers afterwards. It must be discarded, not
    // painted over the newer price.
    slow.resolve('price-for-older-config');
    await expect(first).resolves.toEqual({ fresh: false });
  });

  it('aborts the superseded request', async () => {
    const latest = new LatestOnly();
    const signals: AbortSignal[] = [];
    const held = deferred<string>();

    const first = latest.run((signal) => {
      signals.push(signal);
      return held.promise;
    });
    expect(signals[0]?.aborted).toBe(false);

    const second = latest.run((signal) => {
      signals.push(signal);
      return Promise.resolve('newer');
    });

    // The first request's signal is aborted the moment a newer one starts.
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);

    held.resolve('older');
    await expect(first).resolves.toEqual({ fresh: false });
    await expect(second).resolves.toEqual({ fresh: true, value: 'newer' });
  });

  it('keeps only the last of several rapid requests', async () => {
    const latest = new LatestOnly();
    const pending = [deferred<number>(), deferred<number>(), deferred<number>()];
    const runs = pending.map((entry) => latest.run(() => entry.promise));

    // They come back in the worst possible order: newest first.
    pending[2]!.resolve(3);
    pending[0]!.resolve(1);
    pending[1]!.resolve(2);

    const results = await Promise.all(runs);
    expect(results).toEqual([{ fresh: false }, { fresh: false }, { fresh: true, value: 3 }]);
  });

  it('cancel() discards an in-flight request', async () => {
    const latest = new LatestOnly();
    const held = deferred<string>();
    const run = latest.run(() => held.promise);

    latest.cancel();
    held.resolve('too late');

    await expect(run).resolves.toEqual({ fresh: false });
    expect(latest.isBusy).toBe(false);
  });

  it('lets a rejection through so the caller can offer Retry', async () => {
    const latest = new LatestOnly();
    await expect(
      latest.run(() => Promise.reject(new Error('503 from /price'))),
    ).rejects.toThrow('503 from /price');
  });

  it('reports whether a request is in flight', async () => {
    const latest = new LatestOnly();
    const held = deferred<string>();
    const run = latest.run(() => held.promise);
    expect(latest.isBusy).toBe(true);
    held.resolve('done');
    await run;
    expect(latest.isBusy).toBe(false);
  });
});

describe('debounce', () => {
  afterEach(() => vi.useRealTimers());

  it('fires once, after the wait, for a burst of calls', () => {
    vi.useFakeTimers();
    const spy = vi.fn();
    const debounced = debounce(spy, 300);

    debounced('a');
    debounced('b');
    debounced('c');
    expect(spy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(299);
    expect(spy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(spy).toHaveBeenCalledTimes(1);
    // The LAST configuration wins, not the first.
    expect(spy).toHaveBeenCalledWith('c');
  });

  it('fires again for a separate burst', () => {
    vi.useFakeTimers();
    const spy = vi.fn();
    const debounced = debounce(spy, 300);

    debounced(1);
    vi.advanceTimersByTime(300);
    debounced(2);
    vi.advanceTimersByTime(300);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('cancel() stops a pending call', () => {
    vi.useFakeTimers();
    const spy = vi.fn();
    const debounced = debounce(spy, 300);

    debounced('dropped');
    debounced.cancel();
    vi.advanceTimersByTime(1000);
    expect(spy).not.toHaveBeenCalled();
  });
});
