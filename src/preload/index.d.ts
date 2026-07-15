import type { FilesmithApi } from './index'

declare global {
  interface Window {
    filesmith: FilesmithApi
  }
}
