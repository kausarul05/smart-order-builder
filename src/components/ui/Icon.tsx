/**
 * A tiny inline icon set. Inline rather than a dependency: twelve glyphs
 * are cheaper to keep than an icon package, and they inherit `currentColor`
 * so a single CSS variable drives them.
 *
 * Every icon is decorative — the control around it carries the accessible
 * name — so each one is `aria-hidden`.
 */

export type IconName =
  | 'bread'
  | 'egg'
  | 'protein'
  | 'extras'
  | 'sauce'
  | 'dish'
  | 'search'
  | 'grid'
  | 'list'
  | 'clock'
  | 'lock'
  | 'edit'
  | 'close'
  | 'chat'
  | 'box'
  | 'receipt'
  | 'download'
  | 'trash'
  | 'plus'
  | 'minus'
  | 'cart';

const PATHS: Record<IconName, string> = {
  bread: 'M4 10a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM8 10h8',
  egg: 'M12 3c3.5 0 6 4.5 6 9a6 6 0 0 1-12 0c0-4.5 2.5-9 6-9z',
  protein: 'M4 12a4 4 0 0 1 4-4h8a4 4 0 0 1 0 8H8a4 4 0 0 1-4-4zM9 9l1.5 6M14 9l1.5 6',
  extras: 'M12 4l2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4L7.5 17.8l.9-5L4.8 9.3l5-.7z',
  sauce: 'M10 3h4v3l2 3v9a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V9l2-3zM9 13h6',
  dish: 'M3 15h18M5 15a7 7 0 0 1 14 0M12 5v3',
  search: 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM20 20l-4-4',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  list: 'M4 6h16M4 12h16M4 18h16',
  clock: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 7v5l3 2',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M5 11h14v9H5z',
  edit: 'M4 20h4L19 9a2.5 2.5 0 0 0-3.5-3.5L4 16.5zM14.5 6.5L17.5 9.5',
  close: 'M6 6l12 12M18 6L6 18',
  chat: 'M4 5h16v11H9l-5 4z',
  box: 'M3 8l9-4 9 4v8l-9 4-9-4zM3 8l9 4 9-4M12 12v8',
  receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6',
  download: 'M12 3v11M7 10l5 5 5-5M4 20h16',
  trash: 'M4 7h16M9 7V5h6v2M7 7l1 13h8l1-13',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  cart: 'M3 4h2l2.5 11h10L20 7H6M9 19a1 1 0 1 0 2 0 1 1 0 0 0-2 0M16 19a1 1 0 1 0 2 0 1 1 0 0 0-2 0',
};

export function Icon(props: {
  readonly name: IconName;
  readonly className?: string;
  readonly strokeWidth?: number;
}) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={props.strokeWidth ?? 1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={props.className ?? 'size-[18px] shrink-0'}
    >
      <path d={PATHS[props.name]} />
    </svg>
  );
}

