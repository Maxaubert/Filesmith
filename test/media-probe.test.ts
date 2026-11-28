import { describe, expect, it } from 'vitest'
import { parseDimensions, parseDuration } from '../src/main/probe'

// Reports in the shape the bundled ffmpeg 9.0.2 prints for `ffmpeg -i <file>`
// (CRLF on Windows). The same values were compared with ffprobe on about 100
// generated files before ffprobe was removed.
const report = (...lines: string[]): string => lines.join('\r\n') + '\r\n'

const VIDEO =
  '  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709, progressive), 1920x1080 [SAR 1:1 DAR 16:9], 36 kb/s, 25 fps (default)'
const AUDIO =
  '  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 44100 Hz, mono, fltp (default)'
const clip = (...extra: string[]): string =>
  report(
    "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'C:\\v\\Duration 00.00, 9x9, Video .mp4':",
    '  Duration: 01:02:03.45, start: 0.000000, bitrate: 119 kb/s',
    VIDEO,
    ...extra,
    'At least one output file must be specified'
  )
const matrix = (deg: string): string[] => [
  '    Side data:',
  `      Display Matrix: rotation of ${deg} degrees`
]

describe('parseDuration', () => {
  it('reads hours, minutes, seconds and hundredths', () => {
    expect(parseDuration(clip())).toBeCloseTo(3723.45, 5)
  })

  it('is null when ffmpeg knows no duration', () => {
    const raw = report(
      "Input #0, h264, from 'a.h264':",
      '  Duration: N/A, bitrate: N/A',
      '  Stream #0:0: Video: h264 (High), yuv420p(progressive), 320x180, 25 fps'
    )
    expect(parseDuration(raw)).toBeNull()
    expect(parseDimensions(raw)).toEqual({ width: 320, height: 180 })
  })

  it('is null when the file did not open', () => {
    const bad = report('[mov,mp4 @ 0001] moov atom not found', 'Error opening input file a.mp4.')
    expect(parseDuration(bad)).toBeNull()
    expect(parseDimensions(bad)).toBeNull()
  })
})

describe('parseDimensions', () => {
  it('takes the frame size, not the codec tag', () => {
    expect(parseDimensions(clip(AUDIO))).toEqual({ width: 1920, height: 1080 })
  })

  it.each(['90.00', '-90.00', '270.00', '-270.00'])('swaps for a rotation of %s', (deg) => {
    expect(parseDimensions(clip(...matrix(deg)))).toEqual({ width: 1080, height: 1920 })
  })

  it.each(['180.00', '-180.00', '45.00', '0.00'])('keeps for a rotation of %s', (deg) => {
    expect(parseDimensions(clip(...matrix(deg)))).toEqual({ width: 1920, height: 1080 })
  })

  it("uses only the first video stream's own rotation", () => {
    const second = '  Stream #0:2: Video: h264, yuv420p, 640x360, 25 fps'
    expect(parseDimensions(clip(AUDIO, second, ...matrix('90.00')))).toEqual({
      width: 1920,
      height: 1080
    })
  })

  it('is null for audio only', () => {
    const song = report(
      "Input #0, mp3, from 'a.mp3':",
      '  Duration: 00:00:03.21, start: 0.025057, bitrate: 64 kb/s',
      '  Stream #0:0: Audio: mp3 (mp3float), 48000 Hz, mono, fltp, 64 kb/s'
    )
    expect(parseDimensions(song)).toBeNull()
    expect(parseDuration(song)).toBe(3.21)
  })

  it('ignores file tags that imitate the report', () => {
    const tagged = report(
      "Input #0, matroska,webm, from 'a.mkv':",
      '  Metadata:',
      '    title           : x',
      '                    :   Duration: 09:09:09.00',
      '                    :   Stream #0:0: Video: h264, yuv420p, 9x9',
      '                    :       Display Matrix: rotation of 90.00 degrees',
      '  Duration: 00:00:02.40, start: 0.000000, bitrate: 119 kb/s',
      VIDEO,
      '    Metadata:',
      '      title           : y, 7x7',
      '                      :   Display Matrix: rotation of 90.00 degrees'
    )
    expect(parseDuration(tagged)).toBe(2.4)
    expect(parseDimensions(tagged)).toEqual({ width: 1920, height: 1080 })
  })
})
