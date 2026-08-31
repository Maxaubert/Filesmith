import { describe, expect, it } from 'vitest'
import { acceptsKind, defaultOperation, findOperation, operationsFor } from '@shared/catalog'
import { defaultOptionsFor } from '../src/renderer/src/state'

describe('archives category', () => {
  it('accepts archive files and nothing else', () => {
    expect(acceptsKind('archives', 'archive')).toBe(true)
    expect(acceptsKind('archives', 'image')).toBe(false)
  })

  it('lands on Convert', () => {
    expect(defaultOperation('archives')).toBe('convert')
  })

  it('offers convert, extract and to-pdf', () => {
    expect(operationsFor('archives').map((o) => o.id)).toEqual(['convert', 'extract', 'to-pdf'])
  })

  it('routes every archives operation to the archive tool', () => {
    for (const o of operationsFor('archives')) expect(o.tool).toBe('archive')
  })

  it('adds a To CBZ card under PDF that runs the archive tool', () => {
    const card = findOperation('pdf', 'to-cbz')
    expect(card?.tool).toBe('archive')
    expect(card?.opKey).toBe('from-pdf')
  })

  it('seeds each archive workspace with its own op', () => {
    expect(defaultOptionsFor('archives', 'extract').op).toBe('extract')
    expect(defaultOptionsFor('archives', 'to-pdf').op).toBe('to-pdf')
    expect(defaultOptionsFor('pdf', 'to-cbz').op).toBe('from-pdf')
  })
})
