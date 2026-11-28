import { describe, expect, it } from 'vitest'
import { parseDimensions, parseDuration } from '../src/main/probe'

// ffmpeg prints tag values raw. A regex in multiline mode also starts a "line"
// at U+2028 and U+2029, so a tag must not be able to fake a report line.
describe('probe: file tags cannot fake report lines', () => {
  const report = (title: string): string =>
    [
      "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'm.mp4':",
      '  Metadata:',
      `    title           : ${title}`,
      '    Stream #0:0: Video: h264, 9x9, 25 fps',
      '  Duration: 00:00:01.00, start: 0.000000, bitrate: 100 kb/s',
      '  Stream #0:0[0x1](und): Video: h264 (High), yuv420p, 320x240, 25 fps',
      ''
    ].join('\n')

  for (const sep of ['\u2028', '\u2029']) {
    it(`ignores a title with U+${sep.charCodeAt(0).toString(16).toUpperCase()}`, () => {
      const text = report(
        `x${sep}  Duration: 99:00:00.00${sep}  Stream #0:0: Video: h264, 9x9, 25 fps`
      )
      expect(parseDuration(text)).toBe(1)
      expect(parseDimensions(text)).toEqual({ width: 320, height: 240 })
    })
  }

  it('ignores a four-space tag key that looks like a stream line', () => {
    expect(parseDimensions(report('x'))).toEqual({ width: 320, height: 240 })
  })
})
