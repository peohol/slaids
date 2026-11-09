/**
 * Compact inline icon set (24x24 stroke icons).
 *
 * The four content kinds that hold something are drawn as one system, so they
 * can be told apart at toolbar size: a **solid band** along the top always
 * means «has a title», **lines** mean text and a **hill under a sun** means a
 * picture. Untitled card, titled card, picture and titled picture card are the
 * four combinations of those two marks.
 */

export type IconName =
  | 'plus'
  | 'info'
  | 'minus'
  | 'menu'
  | 'arrow-up'
  | 'arrow-down'
  | 'target'
  | 'expand'
  | 'collapse'
  | 'sign-out'
  | 'trash'
  | 'copy'
  | 'split-x'
  | 'split-y'
  | 'edit'
  | 'eraser'
  | 'container'
  | 'negative-space'
  | 'note'
  | 'card'
  | 'card-titled'
  | 'card-image'
  | 'image'
  | 'image-add'
  | 'quote'
  | 'bullet-list'
  | 'ordered-list'
  | 'bold'
  | 'italic'
  | 'underline'
  | 'subscript'
  | 'superscript'
  | 'link'
  | 'table'
  | 'reference'
  | 'ideas'
  | 'category'
  | 'sandbox'
  | 'play'
  | 'share'
  | 'qr'
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
  | 'align-left'
  | 'align-center'
  | 'align-right'
  | 'align-top-v'
  | 'align-middle-v'
  | 'align-bottom-v'
  | 'interactive'
  | 'slide'
  | 'section'
  | 'optimize'
  | 'cut'
  | 'paste'
  | 'duplicate'
  | 'equalize'
  | 'more'
  | 'reset'
  | 'deck'
  | 'tools'
  | 'appearance'
  | 'moon'
  | 'sun'
  | 'text-shrunk'
  | 'users'

const PATHS: Record<IconName, React.ReactNode> = {
  plus: <path d="M12 5v14M5 12h14" />,
  info: <path d="M12 3a9 9 0 100 18 9 9 0 000-18zM12 11v6M12 7.5h.01" />,
  minus: <path d="M5 12h14" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  'arrow-up': <path d="M12 20V5M6 11l6-6 6 6" />,
  'arrow-down': <path d="M12 4v15M6 13l6 6 6-6" />,
  /* A place to drop something into: a ring around an aiming point. */
  target: <path d="M12 4a8 8 0 100 16 8 8 0 000-16zM12 9.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5z" />,
  expand: <path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" />,
  collapse: <path d="M4 9h5V4M20 9h-5V4M4 15h5v5M20 15h-5v5" />,
  trash: <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13M10 11v6M14 11v6" />,
  copy: <path d="M9 9h10v10H9zM5 15V5h10" />,
  'split-x': <path d="M4 4h16v16H4zM12 4v16" />,
  'split-y': <path d="M4 4h16v16H4zM4 12h16" />,
  edit: <path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4" />,
  eraser: <path d="M5 15l6-6 8 8-4 4H9zM4 21h16" />,
  /* A frame that holds zones rather than content: dashed, like a guide. */
  container: <path d="M4 5h16v14H4z" strokeDasharray="4 3" />,
  /* Deliberate air: the corners of a zone and nothing between them. */
  'negative-space': <path d="M4 8V5h3M17 5h3v3M20 16v3h-3M7 19H4v-3" />,
  /* Editorial text: a sheet with a folded corner and two written lines. */
  note: <path d="M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h4" />,
  /* Text on a card: lines, no band. */
  card: <path d="M6 5h12a2 2 0 012 2v10a2 2 0 01-2 2H6a2 2 0 01-2-2V7a2 2 0 012-2zM8 9.5h8M8 12.5h8M8 15.5h5" />,
  /* The same card with its title: the band across the top. */
  'card-titled': (
    <>
      <path d="M6 5h12a2 2 0 012 2v10a2 2 0 01-2 2H6a2 2 0 01-2-2V7a2 2 0 012-2zM8 13h8M8 16h5" />
      <path d="M4 7a2 2 0 012-2h12a2 2 0 012 2v2.6H4z" fill="currentColor" />
    </>
  ),
  /* A picture under a title band. */
  'card-image': (
    <>
      <path d="M6 5h12a2 2 0 012 2v10a2 2 0 01-2 2H6a2 2 0 01-2-2V7a2 2 0 012-2zM5 18.5l4.5-5 3 3 2-2 4.5 4" />
      <path d="M4 7a2 2 0 012-2h12a2 2 0 012 2v2.6H4z" fill="currentColor" />
    </>
  ),
  /* A picture: a hill under a sun, in a frame. */
  image: (
    <path d="M6 5h12a2 2 0 012 2v10a2 2 0 01-2 2H6a2 2 0 01-2-2V7a2 2 0 012-2zM5 18.5l5-5.5 3.5 3.5 2-2 4 4M15.5 8.5a1.5 1.5 0 100 3 1.5 1.5 0 000-3z" />
  ),
  /* Choosing a file for a picture, as opposed to making a zone a picture:
     the same frame, opened at the corner by a plus. */
  'image-add': (
    <path d="M13 5H6a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2v-5M5 18.5l5-5.5 3.5 3.5 2-2 4 4M18 3v6M15 6h6" />
  ),
  quote: <path d="M8 7C5 8 5 12 5 12h4v5H4V9M18 7c-3 1-3 5-3 5h4v5h-5V9" />,
  'bullet-list': <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />,
  'ordered-list': <path d="M9 6h11M9 12h11M9 18h11M4 5h1v3M4 11h2v1l-2 2h2M4 17h2v3H4" />,
  bold: <path d="M7 5h6a3.5 3.5 0 010 7H7zM7 12h7a3.5 3.5 0 010 7H7z" />,
  italic: <path d="M10 5h7M7 19h7M14 5l-4 14" />,
  underline: <path d="M7 5v6a5 5 0 0010 0V5M5 20h14" />,
  subscript: <path d="M4 7l7 10M11 7l-7 10M14.5 15.3c0-1 .9-1.8 2-1.8s2 .7 2 1.6c0 .9-.9 1.5-2.1 2.6-.5.5-1 .9-1.4 1.3h3.5" />,
  superscript: <path d="M4 9l7 10M11 9l-7 10M14.5 6.3c0-1 .9-1.8 2-1.8s2 .7 2 1.6c0 .9-.9 1.5-2.1 2.6-.5.5-1 .9-1.4 1.3h3.5" />,
  link: <path d="M10 13a4 4 0 006 .5l2-2a4 4 0 10-6-6l-1 1M14 11a4 4 0 00-6-.5l-2 2a4 4 0 106 6l1-1" />,
  table: <path d="M4 5h16v14H4zM4 10h16M4 15h16M10 5v14" />,
  reference: <path d="M6 4h9l4 4v12H6zM15 4v4h4M9 13h7M9 16h5" />,
  ideas: <path d="M9 18h6M10 21h4M12 3a6 6 0 00-4 10.5V16h8v-2.5A6 6 0 0012 3z" />,
  category: <path d="M8 4.5H6.5a2 2 0 00-2 2v11a2 2 0 002 2H8M12 8h7.5M12 12h7.5M12 16h7.5" />,
  sandbox: <path d="M4 8l8-4 8 4-8 4zM4 8v8l8 4 8-4V8" />,
  play: <path d="M8 5l11 7-11 7z" />,
  share: (
    <path d="M18 8a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM6 14.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM18 21a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM8.2 10.8l7.6-4.1M8.2 13.2l7.6 4.1" />
  ),
  qr: (
    <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2.5v2.5H14zM19.5 14H20v2.5M14 19.5V20h2.5M19.5 19.5H20" />
  ),
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
  /* How the interface looks: a disc, half dark and half light. */
  appearance: (
    <>
      <path d="M12 3a9 9 0 100 18 9 9 0 000-18z" />
      <path d="M12 3a9 9 0 000 18z" fill="currentColor" />
    </>
  ),
  moon: <path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z" />,
  sun: (
    <path d="M12 8a4 4 0 100 8 4 4 0 000-8zM12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4" />
  ),
  /* Two letters, the second smaller, and arrows pressing in: text drawn smaller to fit. */
  'text-shrunk': <path d="M3 18l3.5-10L10 18M4.3 14.5h4.4M13 18l2-5.5 2 5.5M13.7 16.4h2.6M20 7l-3 3M20 10V7h-3" />,
  heading: <path d="M6 5v14M18 5v14M6 12h12" />,
  move: <path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3" />,
  code: <path d="M9 8l-4 4 4 4M15 8l4 4-4 4" />,
  /* A window with a prompt in it: a page that runs. */
  interactive: <path d="M4 5h16v14H4zM4 9h16M8 12.5l2 2-2 2M12.5 16.5H16" />,
  /* A screen on its stand: a page to be shown. */
  slide: <path d="M3 4h18M5 4v10h14V4M12 14v3M8 20l4-3 4 3" />,
  /* A page break: where one part of the deck ends and the next begins. */
  section: <path d="M6 3v5h12V3M6 21v-5h12v5M3 12h3M10.5 12h3M18 12h3" />,
  optimize: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5M10 10L5 5M14 10l5-5M10 14l-5 5M14 14l5 5" />,
  'align-left': <path d="M4 6h16M4 12h10M4 18h13" />,
  'align-center': <path d="M4 6h16M7 12h10M6 18h12" />,
  'align-right': <path d="M4 6h16M10 12h10M7 18h13" />,
  'align-top-v': <path d="M4 4h16M8 8v12M12 8v8M16 8v12" />,
  'align-middle-v': <path d="M4 12h16M8 5v4M8 15v4M12 3v6M12 15v6M16 5v4M16 15v4" />,
  'align-bottom-v': <path d="M4 20h16M8 4v12M12 8v8M16 4v12" />,
  'sign-out': <path d="M13 5H6v14h7M21 12H10m4-4l4 4-4 4" />,
  /* Two blades crossing, and the rings they are held by. */
  cut: <path d="M7 6.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5zM7 13a2.5 2.5 0 100 5 2.5 2.5 0 000-5zM9 10.5L20 18M9 14L20 6" />,
  /* A clipboard with a sheet on it. */
  paste: <path d="M9 5H6v15h12V5h-3M9 3h6v4H9zM9 12h6M9 16h4" />,
  /* The zone and its copy beside it. */
  duplicate: <path d="M3 6h8v12H3zM13 6h8v12h-8zM17 10v4M15 12h4" />,
  /* Three columns of the same width. */
  equalize: <path d="M4 5h16v14H4zM9.33 5v14M14.67 5v14" />,
  more: <path d="M6 12h.01M12 12h.01M18 12h.01" />,
  /* The whole presentation: a stack of pages, the front one in full. */
  deck: <path d="M8 4h12v9M5 7h12v9M3 10h11v10H3z" />,
  /* Aids to the work: a wrench. */
  users: <path d="M9 11a4 4 0 100-8 4 4 0 000 8zM2 20a7 7 0 0114 0M16 3.5a4 4 0 010 7.5M18 13.5a7 7 0 014 6.5" />,
  tools: <path d="M14.7 6.3a4 4 0 015 5l-2.2-2.2-2.3.5-.5 2.3 2.2 2.2a4 4 0 01-5-5zM12.8 11.2L4.5 19.5" />,
  /* Round and back to where it started. */
  reset: <path d="M4 12a8 8 0 108-8 8 8 0 00-6.3 3M4 4v4h4" />,
}

/**
 * The families of tools that carry a colour of their own; see
 * docs/UX_DESIGN_SYSTEM.md. Deliberately few: presentation-wide tools, history
 * and navigation stay untinted, and selection, danger and status are states,
 * not families.
 */
export type IconTone = 'content' | 'zone' | 'media'

export function Icon({
  name,
  size = 18,
  className,
  tone,
}: {
  name: IconName
  size?: number
  className?: string
  /** Tint the icon with its function family's ink. Untinted when absent. */
  tone?: IconTone
}) {
  return (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      data-tone={tone}
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
