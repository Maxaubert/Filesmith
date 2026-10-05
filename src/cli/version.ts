// Replaced at build time by electron-vite (main build) and Vitest (tests) with
// the package.json version. The fallback only shows if a third bundler forgets
// the define, which makes the mistake visible instead of silent.
declare const __APP_VERSION__: string | undefined

export const VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-dev'
