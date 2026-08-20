import type { JSX } from 'react'

export type IconName =
  | 'convert'
  | 'compress'
  | 'resize'
  | 'upscale'
  | 'removebg'
  | 'pdf'
  | 'upload'
  | 'check'
  | 'clock'
  | 'min'
  | 'max'
  | 'close'
  | 'eye'
  | 'folder'
  | 'trash'
  | 'dots'
  | 'chevron-left'
  | 'chevron-down'
  | 'edit'
  | 'grip'
  | 'chevron-right'
  | 'play'
  | 'pause'
  | 'volume'
  | 'volume-mute'
  | 'fullscreen'
  | 'expand'
  | 'image'
  | 'video'
  | 'audio'
  | 'doc'
  | 'text'

const PATHS: Record<IconName, JSX.Element> = {
  convert: <path d="M4 8.5h13M14 5.5l3 3-3 3M20 15.5H7M10 12.5l-3 3 3 3" />,
  compress: <path d="M3.5 12h17M12 3v6M9 6.5l3 2.5 3-2.5M12 21v-6M9 17.5l3-2.5 3 2.5" />,
  image: (
    <path d="M3.5 3.5h17v17h-17zM9 9.5a1.4 1.4 0 1 1 0-.1M20.5 15l-4.6-4.6a1.6 1.6 0 0 0-2.3 0L4.5 19.5" />
  ),
  video: <path d="M2.5 6.5h13v11h-13zM15.5 12l6-3.5v7z" />,
  audio: <path d="M4 10v4M8 6.5v11M12 3.5v17M16 6.5v11M20 10v4" />,
  doc: (
    <path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5zM14 3.5v5h5M8.5 13.5h7M8.5 17h4.5" />
  ),
  text: <path d="M5 6.5h14M5 12h14M5 17.5h9" />,
  'chevron-down': <path d="m6 9 6 6 6-6" />,
  edit: <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />,
  grip: <path d="M4 7h16M4 12h16M4 17h16" />,
  resize: <path d="M15 3.5h5.5V9M9 20.5H3.5V15M20.5 3.5 14 10M3.5 20.5 10 14" />,
  upscale: <path d="M4 14.5h5.5V20H4zM12.5 11.5 20 4M14 4h6v6" />,
  removebg: (
    <>
      <path d="M3.5 3.5h17v17h-17z" strokeDasharray="2.6 2.8" />
      <path d="M12 7.5a3 3 0 1 1 0 6 3 3 0 0 1 0-6M7 19c1-2.6 2.8-4 5-4s4 1.4 5 4" />
    </>
  ),
  pdf: <path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5zM14 3.5v5h5" />,
  upload: <path d="M12 16V4M7.5 8.5 12 4l4.5 4.5M4 20h16" />,
  check: <path d="M4.5 12.5 9 17 19.5 6.5" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  min: <path d="M5 12h14" />,
  max: <rect x="5" y="5" width="14" height="14" rx="2" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  eye: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />,
  trash: (
    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
  ),
  dots: (
    <>
      <circle cx="12" cy="5" r="1.7" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none" />
      <circle cx="12" cy="19" r="1.7" fill="currentColor" stroke="none" />
    </>
  ),
  'chevron-left': <path d="M15 18l-6-6 6-6" />,
  'chevron-right': <path d="M9 6l6 6-6 6" />,
  play: <path d="M8 5v14l11-7z" fill="currentColor" stroke="none" />,
  pause: (
    <>
      <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" />
      <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" />
    </>
  ),
  volume: (
    <>
      <path d="M11 5 6 9H3v6h3l5 4V5z" />
      <path d="M16 9a3 3 0 0 1 0 6" />
    </>
  ),
  'volume-mute': (
    <>
      <path d="M11 5 6 9H3v6h3l5 4V5z" />
      <path d="M22 9l-5 6M17 9l5 6" />
    </>
  ),
  fullscreen: (
    <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3" />
  ),
  expand: (
    <>
      <path d="M15 3h6v6" />
      <path d="M21 3l-7 7" />
      <path d="M9 21H3v-6" />
      <path d="M3 21l7-7" />
    </>
  )
}

export function Icon({
  name,
  className,
  strokeWidth = 2
}: {
  name: IconName
  className?: string
  strokeWidth?: number
}): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {PATHS[name]}
    </svg>
  )
}
