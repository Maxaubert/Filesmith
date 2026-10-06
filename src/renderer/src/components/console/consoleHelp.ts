import type { CompletionItem } from '@shared/consoleComplete'

export const HELP_LINES = (cwd: string): string[] => [
  `Commands run in ${cwd}, without the "filesmith" prefix:`,
  '  convert, compress, resize, upscale, removebg   the sidebar operations',
  '  generate "<prompt>"                            make an image with ComfyUI',
  '  pdf <tool>                                     merge, split, burst, extract-text, to-images',
  '  formats, doctor, setup, skill                  helpers',
  '  cd <folder>, history, clear                    console built-ins (Ctrl+L clears)',
  'Add --help to a command for its options. Other programs: use a terminal.'
]

export const BUILTIN_ITEMS: CompletionItem[] = [
  { value: 'cd', detail: 'change the console folder' },
  { value: 'clear', detail: 'clear the console (Ctrl+L)' },
  { value: 'help', detail: 'what this console runs' },
  { value: 'history', detail: 'past commands' }
]
