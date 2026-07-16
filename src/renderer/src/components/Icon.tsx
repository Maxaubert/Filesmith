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
  x: <path d="M6 6l12 12M18 6 6 18" />
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
