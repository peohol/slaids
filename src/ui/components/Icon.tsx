/** Compact inline icon set (24x24 stroke icons). */

export type IconName =
  | 'plus'
  | 'trash'
  | 'copy'
  | 'split-x'
  | 'split-y'
  | 'edit'
  | 'eraser'
  | 'container'
  | 'card'
  | 'card-titled'
  | 'image'
  | 'shapes'
  | 'quote'
  | 'bullet-list'
  | 'ordered-list'
  | 'bold'
  | 'italic'
  | 'underline'
  | 'link'
  | 'table'
  | 'reference'
  | 'ideas'
  | 'sandbox'
  | 'play'
  | 'undo'
  | 'redo'
  | 'folder'
  | 'download'
  | 'upload'
  | 'close'
  | 'grip'
  | 'palette'
  | 'zones'
  | 'text'
  | 'template'
  | 'chevron-left'
  | 'chevron-right'
  | 'chevron-up'
  | 'chevron-down'
  | 'check'
  | 'heading'
  | 'move'
  | 'code'

const PATHS: Record<IconName, React.ReactNode> = {
  plus: <path d="M12 5v14M5 12h14" />,
  trash: <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13M10 11v6M14 11v6" />,
  copy: <path d="M9 9h10v10H9zM5 15V5h10" />,
  'split-x': <path d="M4 4h16v16H4zM12 4v16" />,
  'split-y': <path d="M4 4h16v16H4zM4 12h16" />,
  edit: <path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4" />,
  eraser: <path d="M5 15l6-6 8 8-4 4H9zM4 21h16" />,
  container: <path d="M4 5h16v14H4z" strokeDasharray="4 3" />,
  card: <path d="M4 5h16v14H4z" />,
  'card-titled': <path d="M4 5h16v14H4zM4 10h16" />,
  image: <path d="M4 5h16v14H4zM8 11l3 3 3-4 3 5H7z" />,
  shapes: <path d="M5 14h8v6H5zM15 4l5 8h-9z" />,
  quote: <path d="M8 7C5 8 5 12 5 12h4v5H4V9M18 7c-3 1-3 5-3 5h4v5h-5V9" />,
  'bullet-list': <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />,
  'ordered-list': <path d="M9 6h11M9 12h11M9 18h11M4 5h1v3M4 11h2v1l-2 2h2M4 17h2v3H4" />,
  bold: <path d="M7 5h6a3.5 3.5 0 010 7H7zM7 12h7a3.5 3.5 0 010 7H7z" />,
  italic: <path d="M10 5h7M7 19h7M14 5l-4 14" />,
  underline: <path d="M7 5v6a5 5 0 0010 0V5M5 20h14" />,
  link: <path d="M10 13a4 4 0 006 .5l2-2a4 4 0 10-6-6l-1 1M14 11a4 4 0 00-6-.5l-2 2a4 4 0 106 6l1-1" />,
  table: <path d="M4 5h16v14H4zM4 10h16M4 15h16M10 5v14" />,
  reference: <path d="M6 4h9l4 4v12H6zM15 4v4h4M9 13h7M9 16h5" />,
  ideas: <path d="M9 18h6M10 21h4M12 3a6 6 0 00-4 10.5V16h8v-2.5A6 6 0 0012 3z" />,
  sandbox: <path d="M4 8l8-4 8 4-8 4zM4 8v8l8 4 8-4V8" />,
  play: <path d="M8 5l11 7-11 7z" />,
  undo: <path d="M9 7L4 12l5 5M4 12h9a6 6 0 010 12h-2" />,
  redo: <path d="M15 7l5 5-5 5M20 12h-9a6 6 0 000 12h2" />,
  folder: <path d="M4 7h6l2 2h8v10H4z" />,
  download: <path d="M12 4v10M8 11l4 4 4-4M4 19h16" />,
  upload: <path d="M12 20V10M8 13l4-4 4 4M4 5h16" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  grip: <path d="M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01" />,
  palette: <path d="M12 3a9 9 0 100 18c1.5 0 2-1 1.4-2-.7-1.2.2-2.5 1.6-2.5H18a3 3 0 003-3A9 9 0 0012 3zM7.5 10.5h.01M11 7.5h.01M15.5 9h.01" />,
  zones: <path d="M4 4h16v16H4zM4 12h16M12 4v8" />,
  text: <path d="M5 6h14M12 6v13M9 19h6" />,
  template: <path d="M4 4h16v4H4zM4 10h7v10H4zM13 10h7v10h-7z" />,
  'chevron-left': <path d="M15 6l-6 6 6 6" />,
  'chevron-right': <path d="M9 6l6 6-6 6" />,
  'chevron-up': <path d="M6 15l6-6 6 6" />,
  'chevron-down': <path d="M6 9l6 6 6-6" />,
  check: <path d="M5 12l5 5L19 7" />,
  heading: <path d="M6 5v14M18 5v14M6 12h12" />,
  move: <path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3" />,
  code: <path d="M9 8l-4 4 4 4M15 8l4 4-4 4" />,
}

export function Icon({
  name,
  size = 18,
  className,
}: {
  name: IconName
  size?: number
  className?: string
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  )
}
