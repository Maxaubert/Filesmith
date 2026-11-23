import { describe, expect, it } from 'vitest'
import { renderOutputName } from '../src/shared/outputNaming'
import { extOf } from '../src/renderer/src/components/inspector/infoModel'

const now = new Date(2026, 10, 23)

describe('renderOutputName', () => {
  it('keeps dollar signs in the name literal', () => {
    expect(renderOutputName('{name}-web', 'Cash$$', 1, now)).toBe('Cash$$-web')
    expect(renderOutputName('{name}', 'a$&b', 1, now)).toBe('a$&b')
  })
  it('does not expand tokens that appear inside the name', () => {
    expect(renderOutputName('{name}', 'x{n}y{date}', 3, now)).toBe('x{n}y{date}')
  })
  it('handles mixed-case tokens', () => {
    expect(renderOutputName('{NAME}_{N}_{Date}', 'pic', 2, now)).toBe('pic_2_2026-11-23')
  })
  it('falls back to the name when the result is empty', () => {
    expect(renderOutputName('', 'pic', 1, now)).toBe('pic')
    expect(renderOutputName('...', 'pic', 1, now)).toBe('pic')
  })
})

describe('extOf', () => {
  it('reads a normal file', () => {
    expect(extOf('C:\\a\\photo.jpg')).toBe('jpg')
    expect(extOf('PHOTO.JPG')).toBe('jpg')
  })
  it('ignores dots in folders and names without a dot', () => {
    expect(extOf('C:\\a.b\\file')).toBe('')
    expect(extOf('README')).toBe('')
  })
})
