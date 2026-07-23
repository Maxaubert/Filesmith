import type { JSX } from 'react'

// Replaces the drop zone in the Generate workspace: there's no file to drop, so
// the central target becomes the prompt input. Same compact footprint as the
// drop box (it does not grow to fill the page).
export function PromptBox({
  value,
  onChange
}: {
  value: string
  onChange: (v: string) => void
}): JSX.Element {
  return (
    <div className="no-drag flex min-h-[212px] shrink-0 flex-col rounded-[18px] border-[1.5px] border-[#d8d8e2] bg-white/60 p-4 transition focus-within:border-accent">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Describe the image you want to generate…"
        className="flex-1 resize-none bg-transparent text-[15px] leading-relaxed text-ink outline-none placeholder:text-muted"
      />
    </div>
  )
}
