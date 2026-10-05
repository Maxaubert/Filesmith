import { describe, expect, it } from 'vitest'
import { gridNeighbor, moveFor } from '../src/renderer/src/components/queue/gridKeys'

// Two groups in a 4-column grid:
//   a b c d       (group 1)
//   e f g
//   h i           (group 2)
const G = [
  ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
  ['h', 'i']
]

describe('gridNeighbor', () => {
  it('walks left and right in visual order, across groups', () => {
    expect(gridNeighbor(G, 'd', 'right', 4)).toBe('e')
    expect(gridNeighbor(G, 'g', 'right', 4)).toBe('h')
    expect(gridNeighbor(G, 'h', 'left', 4)).toBe('g')
    expect(gridNeighbor(G, 'a', 'left', 4)).toBeUndefined()
    expect(gridNeighbor(G, 'i', 'right', 4)).toBeUndefined()
  })
  it('moves one visual row in the same column', () => {
    expect(gridNeighbor(G, 'a', 'down', 4)).toBe('e')
    expect(gridNeighbor(G, 'c', 'down', 4)).toBe('g')
    expect(gridNeighbor(G, 'f', 'up', 4)).toBe('b')
  })
  it('reaches a short last row from the column above it', () => {
    expect(gridNeighbor(G, 'd', 'down', 4)).toBe('g')
  })
  it('crosses group headers at the nearest column', () => {
    expect(gridNeighbor(G, 'e', 'down', 4)).toBe('h')
    expect(gridNeighbor(G, 'g', 'down', 4)).toBe('i')
    expect(gridNeighbor(G, 'h', 'up', 4)).toBe('e')
    expect(gridNeighbor(G, 'i', 'up', 4)).toBe('f')
    expect(gridNeighbor(G, 'a', 'up', 4)).toBeUndefined()
    expect(gridNeighbor(G, 'i', 'down', 4)).toBeUndefined()
  })
  it('is the plain list order with one column (Details), where Left/Right do nothing', () => {
    expect(gridNeighbor(G, 'g', 'down', 1)).toBe('h')
    expect(gridNeighbor(G, 'h', 'up', 1)).toBe('g')
    expect(gridNeighbor(G, 'b', 'up', 1)).toBe('a')
    expect(gridNeighbor(G, 'b', 'right', 1)).toBeUndefined()
  })
  it('returns nothing for an unknown id', () => {
    expect(gridNeighbor(G, 'zz', 'down', 4)).toBeUndefined()
  })
})

describe('moveFor', () => {
  it('maps arrow keys to a direction and whether Shift extends', () => {
    expect(moveFor('up')).toEqual({ dir: 'up', extend: false })
    expect(moveFor('extendDown')).toEqual({ dir: 'down', extend: true })
    expect(moveFor('left')).toEqual({ dir: 'left', extend: false })
    expect(moveFor('extendRight')).toEqual({ dir: 'right', extend: true })
    expect(moveFor('toggle')).toBeNull()
    expect(moveFor('menu')).toBeNull()
  })
})
