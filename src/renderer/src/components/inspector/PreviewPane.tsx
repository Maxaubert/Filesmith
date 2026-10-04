import { useEffect, useState, type JSX } from 'react'
import type { FileKind } from '@shared/types'
import { formatBytes } from '@shared/compress'
import type { QueueItem } from '../../state'
import { previewRows } from './infoModel'
import { Wipe } from './Wipe'

const ext = (p: string): string => (p.split('.').pop() ?? '').toLowerCase()

/** Keyed by item id in the parent, so its fetched images never leak between rows. */
export function PreviewPane({
  item,
  outKind,
  dims
}: {
  item: QueueItem
  outKind: FileKind | null
  dims: { width: number; height: number } | null
}): JSX.Element {
  const [srcImg, setSrcImg] = useState<string | null>(item.thumb)
  const [outImg, setOutImg] = useState<string | null>(null)
  const out = item.status === 'done' && item.outputSize != null ? item.outputPath : undefined
  useEffect(() => {
    let alive = true
    void window.filesmith
      .thumbnail(item.file.path, 640, item.file.kind)
      .then((t) => alive && t && setSrcImg(t))
    if (out && outKind)
      void window.filesmith.thumbnail(out, 640, outKind).then((t) => alive && setOutImg(t))
    return () => {
      alive = false
    }
  }, [item.file.path, item.file.kind, out, outKind])
  return (
    <>
      <Wipe
        left={srcImg}
        right={out ? outImg : null}
        leftTag={`${ext(item.file.name)} ${formatBytes(item.file.size)}`}
        rightTag={
          out && item.outputSize != null ? `${ext(out)} ${formatBytes(item.outputSize)}` : undefined
        }
      />
      <dl className="dgrid">
        {previewRows(item, dims).map((r) => (
          <div key={r.k}>
            <dt>{r.k}</dt>
            <dd>{r.v}</dd>
          </div>
        ))}
      </dl>
    </>
  )
}
