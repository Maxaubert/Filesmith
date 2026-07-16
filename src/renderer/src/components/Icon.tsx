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
  | 'logo'
  | 'x'
  | 'eye'
  | 'folder'
  | 'trash'
  | 'dots'
  | 'chevron-left'
  | 'chevron-right'
  | 'play'
  | 'pause'
  | 'volume'
  | 'volume-mute'
  | 'fullscreen'
  | 'expand'
  | 'music'

const PATHS: Record<IconName, JSX.Element> = {
  convert: (
    <>
      <path d="M4 7h13l-3-3" />
      <path d="M20 17H7l3 3" />
    </>
  ),
  compress: <path d="M9 3v6M15 21v-6M4 9h5M15 15h5M6 6 3 9l3 3M18 18l3-3-3-3" />,
  resize: <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />,
  upscale: <path d="M12 20V8M6 14l6-6 6 6M4 4h16" />,
  removebg: (
    <>
      <path d="M12 3a9 9 0 1 0 9 9" />
      <path d="M3 3l18 18" />
    </>
  ),
  pdf: (
    <>
      <path d="M14 3v4a1 1 0 0 0 1 1h4" />
      <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2Z" />
    </>
  ),
  upload: (
    <>
      <path d="M12 15V3M7 8l5-5 5 5" />
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    </>
  ),
  check: <path d="m5 13 4 4L19 7" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  min: <path d="M5 12h14" />,
  max: <rect x="5" y="5" width="14" height="14" rx="2" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  logo: (
    <>
      <path d="M14 3v4a1 1 0 0 0 1 1h4" />
      <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2Z" />
      <path d="m9 14 2 2 4-4" />
    </>
  ),
  x: <path d="M6 6l12 12M18 6 6 18" />,
  eye: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />,
  trash: <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />,
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
  ),
  music: (
    <>
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
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
