import { contextBridge } from 'electron'

// The typed bridge the renderer talks to. This grows as the engine lands
// (runJob / cancelJob / onProgress / pickFiles / checkTool / installTool);
// for now it only proves the main <-> renderer channel is wired.
const api = {
  ping: (): string => 'pong'
}

contextBridge.exposeInMainWorld('filesmith', api)

export type FilesmithApi = typeof api
