import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import { useTheme } from './useTheme';

/**
 * The toggle writes one attribute and remembers the choice. What matters
 * is that a browser which refuses localStorage still gets a working
 * toggle, just a forgetful one.
 */

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('useTheme', () => {
  it('follows the system by default and sets no attribute', () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.choice).toBe('system');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('writes data-theme when a theme is chosen', () => {
    const { result } = renderHook(() => useTheme());

    act(() => result.current.setChoice('dark'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    act(() => result.current.setChoice('light'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('removes the attribute again for system', () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setChoice('dark'));
    act(() => result.current.setChoice('system'));
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('remembers the choice across mounts', () => {
    const first = renderHook(() => useTheme());
    act(() => first.result.current.setChoice('dark'));
    first.unmount();

    const second = renderHook(() => useTheme());
    expect(second.result.current.choice).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('ignores a corrupt stored value', () => {
    localStorage.setItem('sob.theme.v1', 'neon');
    const { result } = renderHook(() => useTheme());
    expect(result.current.choice).toBe('system');
  });

  it('still toggles when localStorage refuses to read or write', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('private mode');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('private mode');
    });

    const { result } = renderHook(() => useTheme());
    expect(result.current.choice).toBe('system');

    act(() => result.current.setChoice('dark'));
    // The palette still changes; only the memory of it is lost.
    expect(result.current.choice).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });
});
