import type { IconName } from '@shared/icons'

export type Prim =
  ['path', string] | ['rect', number, number, number, number] | ['circle', number, number, number]

const page = 'M3.5 1.5h6l3 3v10h-9z M9.5 1.5v3h3'
const box = 'M2 2.5h12v3H2z M3 5.5v8h10v-8'

export const ICON_SHAPES: Record<IconName, Prim[]> = {
  convert: [['path', 'M2.5 5.5h10.5M10.5 3l2.5 2.5-2.5 2.5M13.5 10.5H3M5.5 8L3 10.5 5.5 13']],
  compress: [['path', 'M8 1.5V6M5.5 3.5L8 6l2.5-2.5M8 14.5V10M5.5 12.5L8 10l2.5 2.5M2.5 8h11']],
  resize: [['path', 'M2.5 6V2.5H6M13.5 10v3.5H10M3 3l10 10']],
  upscale: [
    ['rect', 2.5, 8.5, 5, 5],
    ['path', 'M9 2.5h4.5V7M13.5 2.5L8.5 7.5']
  ],
  removebg: [['path', 'M9.5 2.5l4 4-6 6H4.5l-2-2 7-8zM6 6l4 4M8 13.5h5.5']],
  generate: [
    ['path', 'M7 2l1.2 3.3L11.5 6.5 8.2 7.7 7 11 5.8 7.7 2.5 6.5l3.3-1.2zM12.5 10v4M10.5 12h4']
  ],
  tools: [
    ['rect', 2.5, 2.5, 4.5, 4.5],
    ['rect', 9, 2.5, 4.5, 4.5],
    ['rect', 2.5, 9, 4.5, 4.5],
    ['rect', 9, 9, 4.5, 4.5]
  ],
  completed: [
    ['circle', 8, 8, 5.5],
    ['path', 'M5.5 8.25l1.75 1.75L10.75 6.5']
  ],
  settings: [
    ['path', 'M2.5 5h5M10.5 5h3M2.5 11h2M7.5 11h6'],
    ['circle', 9, 5, 1.5],
    ['circle', 6, 11, 1.5]
  ],
  addfile: [['path', 'M3.5 1.5h6l3 3v10h-9z M9.5 1.5v3h3M8 7v5M5.5 9.5h5']],
  folder: [['path', 'M1.5 3.5h4.5l1.5 1.5h7v8h-13z']],
  play: [['path', 'M5 3.5v9l7.5-4.5z']],
  stop: [['rect', 4, 4, 8, 8]],
  retry: [['path', 'M3 3v3h3M3.3 6A5 5 0 1 1 3 9.5']],
  close: [['path', 'M4 4l8 8M12 4l-8 8']],
  check: [['path', 'M3 8.5l3 3 7-7']],
  warning: [['path', 'M8 2l6.5 11.5h-13zM8 6.5v3M8 11.5v.5']],
  clock: [
    ['circle', 8, 8, 5.5],
    ['path', 'M8 5v3l2 1.5']
  ],
  sync: [['path', 'M13.5 8A5.5 5.5 0 1 1 8 2.5']],
  'chev-r': [['path', 'M6 4l4 4-4 4']],
  'chev-d': [['path', 'M4 6l4 4 4-4']],
  cleardone: [['path', 'M2 4.5l1.25 1.25L5.5 3.5M2 10.5l1.25 1.25L5.5 9.5M7.5 4.5H14M7.5 10.5H14']],
  trash: [['path', 'M3 4.5h10M6 4.5V2.5h4v2M4.5 4.5l.5 9h6l.5-9']],
  eye: [
    ['path', 'M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8s-2.5 4.5-6.5 4.5S1.5 8 1.5 8z'],
    ['circle', 8, 8, 2]
  ],
  info: [
    ['circle', 8, 8, 5.5],
    ['path', 'M8 7.5v3.5M8 5v.5']
  ],
  arrow: [['path', 'M3 8h10M10 5l3 3-3 3']],
  sidebar: [
    ['rect', 2, 2.5, 12, 11],
    ['path', 'M6 2.5v11M10.5 6.5L9 8l1.5 1.5']
  ],
  anvil: [['path', 'M1.5 4.5h10c0 2 1.5 3 3 3v1h-5l-1 2h2v2h-6v-2h2l-1-2c-2.5 0-4-1.5-4-4z']],
  image: [
    ['rect', 2.5, 2.5, 11, 11],
    ['path', 'M2.5 11l3.5-3.5 3 3 2-2 2.5 2.5'],
    ['circle', 10.5, 5.5, 1]
  ],
  pdf: [['path', `${page}M5.5 9h5M5.5 11.5h3`]],
  text: [['path', 'M3 4h10M3 7h10M3 10h10M3 13h6']],
  merge: [['path', 'M2.5 3l5.5 5M13.5 3L8 8v6M5.5 11.5L8 14l2.5-2.5']],
  split: [['path', 'M8 2v6l-5.5 5.5M8 8l5.5 5.5M5.5 4.5L8 2l2.5 2.5']],
  burst: [
    ['rect', 2.5, 3.5, 5, 6],
    ['rect', 8.5, 6.5, 5, 6]
  ],
  pull: [['path', 'M2.5 6.5v7h11v-7M8 2v8M5.5 7.5L8 10l2.5-2.5']],
  archive: [['path', `${box}M6.5 8.5h3`]],
  video: [
    ['rect', 1.5, 3.5, 9, 9],
    ['path', 'M10.5 7l4-2.5v7l-4-2.5']
  ],
  audio: [
    ['path', 'M6 12V3.5l7.5-1.5V10.5'],
    ['circle', 4.5, 12, 1.5],
    ['circle', 12, 10.5, 1.5]
  ],
  doc: [['path', `${page}M5.5 8h5M5.5 10.5h5M5.5 13h3`]],
  unpack: [['path', `${box}M8 7v5M5.5 9.5L8 12l2.5-2.5`]],
  topdf: [['path', 'M5.5 1.5h5l3 3v10h-8v-4M10.5 1.5v3h3M1.5 8h6M5 5.5L7.5 8 5 10.5']],
  tocbz: [
    ['rect', 6.5, 6.5, 8, 7],
    ['path', 'M1.5 4h7M6 1.5L8.5 4 6 6.5']
  ],
  edit: [['path', 'M10.5 2.5l3 3-8 8h-3v-3zM9 4l3 3']],
  grip: [
    ['circle', 6, 4, 0.75],
    ['circle', 10, 4, 0.75],
    ['circle', 6, 8, 0.75],
    ['circle', 10, 8, 0.75],
    ['circle', 6, 12, 0.75],
    ['circle', 10, 12, 0.75]
  ],
  dots: [
    ['circle', 8, 3.5, 0.75],
    ['circle', 8, 8, 0.75],
    ['circle', 8, 12.5, 0.75]
  ]
}
