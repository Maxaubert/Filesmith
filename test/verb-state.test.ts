import { describe, expect, it } from 'vitest'
import { convertGroup } from '@shared/convert'
import {
  emptyQueue,
  initialState,
  optionsKey,
  queueKey,
  reducer,
  type AppState
} from '../src/renderer/src/state'
import type { FileInfo } from '@shared/types'

const file = (name: string, kind: FileInfo['kind'], ext: string): FileInfo => ({
  path: `C:\\${name}`,
  name,
  ext,
  kind,
  size: 1
})

function seeded(): AppState {
  const s: AppState = {
    ...initialState,
    tab: 'convert',
    activeTool: null,
    queues: {
      convert: {
        ...emptyQueue(),
        items: [
          {
            id: 'a',
            file: file('a.png', 'image', '.png'),
            thumb: null,
            status: 'ready',
            percent: 0
          },
          {
            id: 'b',
            file: file('b.png', 'image', '.png'),
            thumb: null,
            status: 'ready',
            percent: 0
          },
          {
            id: 'v',
            file: file('v.mp4', 'video', '.mp4'),
            thumb: null,
            status: 'ready',
            percent: 0
          }
        ]
      }
    }
  }
  return s
}

describe('keys', () => {
  it('keys a plain tab queue by the tab id', () => {
    expect(queueKey('convert', null)).toBe('convert')
  })

  it('keys a tool workspace by its tool card', () => {
    expect(queueKey('tools', 'pdf-merge')).toBe('tools:pdf-merge')
  })

  it('keys options by queue and convert group', () => {
    expect(optionsKey('convert', null, 'image')).toBe('convert:image')
    expect(optionsKey('convert', null, 'video')).toBe('convert:video')
    // A pdf and a docx share the 'doc' group, so they share one option set.
    expect(optionsKey('convert', null, 'doc')).toBe('convert:doc')
    expect(optionsKey('tools', 'pdf-merge', 'doc')).toBe('tools:pdf-merge:doc')
  })
})

describe('convertGroup', () => {
  it('keeps pdf, document and text in one batch, as today', () => {
    expect(convertGroup('pdf', '.pdf')).toBe('doc')
    expect(convertGroup('document', '.docx')).toBe('doc')
    expect(convertGroup('text', '.txt')).toBe('doc')
  })

  it('gives archives their own group instead of falling through to doc', () => {
    expect(convertGroup('archive', '.cbz')).toBe('archive')
    expect(convertGroup('archive', '.rar')).toBe('archive')
  })
})

describe('one-group selection', () => {
  it('extends the selection within a group', () => {
    let s = seeded()
    s = reducer(s, { type: 'select', id: 'a', mode: 'single' })
    s = reducer(s, { type: 'select', id: 'b', mode: 'toggle' })
    expect([...s.queues.convert!.selected].sort()).toEqual(['a', 'b'])
  })

  it('replaces the selection when a different group is toggled in', () => {
    let s = seeded()
    s = reducer(s, { type: 'select', id: 'a', mode: 'single' })
    s = reducer(s, { type: 'select', id: 'b', mode: 'toggle' })
    s = reducer(s, { type: 'select', id: 'v', mode: 'toggle' })
    // Ctrl+clicking a video does not append it to an image selection: it
    // becomes the selection, because one options panel cannot describe both.
    expect(s.queues.convert!.selected).toEqual(['v'])
  })

  it('still lets a toggle deselect within the same group', () => {
    let s = seeded()
    s = reducer(s, { type: 'select', id: 'a', mode: 'single' })
    s = reducer(s, { type: 'select', id: 'b', mode: 'toggle' })
    s = reducer(s, { type: 'select', id: 'b', mode: 'toggle' })
    expect(s.queues.convert!.selected).toEqual(['a'])
  })

  it('never lets a range selection span groups', () => {
    let s = seeded()
    s = reducer(s, { type: 'select', id: 'a', mode: 'single' })
    // Shift-clicking the video extends through the range but keeps only the
    // anchor's group, so the two images come along and the video does not.
    s = reducer(s, { type: 'select', id: 'v', mode: 'range' })
    expect(s.queues.convert!.selected).toEqual(['a', 'b'])
  })
})

describe('tab switching', () => {
  it('creates the tab queue and its options on first visit', () => {
    const s = reducer(initialState, { type: 'setTab', tab: 'compress' })
    expect(s.tab).toBe('compress')
    expect(s.queues.compress).toBeDefined()
  })

  it('clears the open tool when leaving Tools', () => {
    let s = reducer(initialState, { type: 'setTab', tab: 'tools' })
    s = reducer(s, { type: 'setActiveTool', tool: 'pdf-merge' })
    expect(s.activeTool).toBe('pdf-merge')
    s = reducer(s, { type: 'setTab', tab: 'convert' })
    expect(s.activeTool).toBeNull()
  })
})
