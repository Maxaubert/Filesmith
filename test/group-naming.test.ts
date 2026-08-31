import { describe, expect, it } from 'vitest'
import { GROUP_COLOR, groupNoun } from '../src/renderer/src/components/queueGroups'

// The options panel and the Run button both describe a CONVERT GROUP, not a
// file kind. Naming by kind said "2 PDFs" for a pdf-plus-txt selection that
// actually runs as one document batch, and the Run button said "2 files",
// which in a mixed queue hides which two.

describe('groupNoun', () => {
  it('names a document batch by its group, not by the first file kind', () => {
    expect(groupNoun('doc', 2)).toBe('2 documents')
    expect(groupNoun('doc', 1)).toBe('1 document')
  })

  it('gets every plural right, including the one that is not a plural', () => {
    expect(groupNoun('image', 1)).toBe('1 image')
    expect(groupNoun('image', 4)).toBe('4 images')
    expect(groupNoun('video', 1)).toBe('1 video')
    expect(groupNoun('video', 2)).toBe('2 videos')
    // "2 audios" is not English; the noun carries the word "file".
    expect(groupNoun('audio', 2)).toBe('2 audio files')
    expect(groupNoun('archive', 3)).toBe('3 archives')
    expect(groupNoun('sheet', 2)).toBe('2 spreadsheets')
    expect(groupNoun('slide', 1)).toBe('1 slide deck')
  })

  it('falls back to a plain file count for an unknown group', () => {
    expect(groupNoun('mystery', 1)).toBe('1 file')
    expect(groupNoun('mystery', 3)).toBe('3 files')
  })
})

describe('GROUP_COLOR', () => {
  it('colours every group the queue can produce', () => {
    for (const g of ['image', 'video', 'audio', 'doc', 'sheet', 'slide', 'archive']) {
      expect(GROUP_COLOR[g], g).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })
})
