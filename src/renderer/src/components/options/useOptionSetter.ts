import { useCallback, type Dispatch } from 'react'
import type { Action } from '../../state'
import type { SetOption } from './types'

/** A stable option setter for one options group. Memoized because the settings
 * panes list it as an effect dependency, and an inline arrow re-ran those
 * effects on every render (spec 4.2). A hook of its own so the React Compiler
 * sees the group as a plain argument. */
export function useOptionSetter(dispatch: Dispatch<Action>, group: string): SetOption {
  return useCallback(
    (k: string, v: string | number | boolean) =>
      dispatch({ type: 'setOption', group, key: k, value: v }),
    [dispatch, group]
  )
}
