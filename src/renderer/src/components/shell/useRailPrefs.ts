import { useCallback, useState } from 'react'
import { TABS, type TabId } from '@shared/tabs'
import { HIDDEN_KEY, normalizeOrder, ORDER_KEY } from './railPrefs'

const ALL = TABS.map((t) => t.id)

function read(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null')
  } catch {
    return null
  }
}
function write(key: string, v: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(v))
  } catch {
    /* storage blocked: keep the in-memory value */
  }
}

export function useRailPrefs(): {
  order: TabId[]
  hidden: TabId[]
  setOrder: (o: TabId[]) => void
  toggleHidden: (id: TabId) => void
} {
  const [order, setOrderState] = useState<TabId[]>(() => normalizeOrder(read(ORDER_KEY), ALL))
  const [hidden, setHidden] = useState<TabId[]>(() => {
    const h = read(HIDDEN_KEY)
    return Array.isArray(h) ? h.filter((id): id is TabId => ALL.includes(id as TabId)) : []
  })
  const setOrder = useCallback((o: TabId[]) => {
    setOrderState(o)
    write(ORDER_KEY, o)
  }, [])
  const toggleHidden = useCallback((id: TabId) => {
    setHidden((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
      write(HIDDEN_KEY, next)
      return next
    })
  }, [])
  return { order, hidden, setOrder, toggleHidden }
}
