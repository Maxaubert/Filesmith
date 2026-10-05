import { useCallback, useState } from 'react'
import { pushHistory } from './consoleHistory'
import { parseHeight } from './consoleHeight'
import { pushRecent } from './consoleFolders'

const K = {
  open: 'filesmith.console.open',
  height: 'filesmith.console.height',
  history: 'filesmith.console.history',
  cwd: 'filesmith.console.cwd',
  recent: 'filesmith.console.recent'
}

const read = (k: string): string | null => {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}
const write = (k: string, v: string): void => {
  try {
    localStorage.setItem(k, v)
  } catch {
    /* storage blocked: works for this session */
  }
}
const readList = (k: string): string[] => {
  try {
    const v = JSON.parse(read(k) ?? '[]') as unknown
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/** Open state, height, history and folder of the console, per app (spec 3-5, 8). */
export function useConsolePanel(): {
  open: boolean
  toggle: () => void
  setOpen: (v: boolean) => void
  height: number
  setHeight: (h: number) => void
  history: string[]
  addHistory: (l: string) => void
  cwd: string | null
  setCwd: (d: string) => void
  recent: string[]
} {
  const [open, setOpenState] = useState(() => read(K.open) === '1')
  const [height, setHeightState] = useState(() => parseHeight(read(K.height)))
  const [history, setHistory] = useState(() => readList(K.history))
  const [cwd, setCwdState] = useState<string | null>(() => read(K.cwd))
  const [recent, setRecent] = useState(() => readList(K.recent))

  const setOpen = useCallback((v: boolean) => {
    setOpenState(v)
    write(K.open, v ? '1' : '0')
  }, [])
  const toggle = useCallback(() => {
    setOpenState((o) => {
      write(K.open, o ? '0' : '1')
      return !o
    })
  }, [])
  const setHeight = useCallback((h: number) => {
    setHeightState(h)
    write(K.height, String(h))
  }, [])
  const addHistory = useCallback((l: string) => {
    setHistory((h) => {
      const next = pushHistory(h, l)
      write(K.history, JSON.stringify(next))
      return next
    })
  }, [])
  const setCwd = useCallback((d: string) => {
    setCwdState(d)
    write(K.cwd, d)
    setRecent((r) => {
      const next = pushRecent(r, d)
      write(K.recent, JSON.stringify(next))
      return next
    })
  }, [])
  return { open, toggle, setOpen, height, setHeight, history, addHistory, cwd, setCwd, recent }
}
