import { useCallback, useEffect, useRef, useState } from 'react'
import type { Folder } from '../../domain/types'
import { Icon } from '../components/Icon'

export function FolderSelect({
  value,
  folders,
  ariaLabel,
  onChange,
}: {
  value: string | null
  folders: Folder[]
  ariaLabel: string
  onChange: (folderId: string | null) => void
}) {
  const labelRef = useRef<HTMLSpanElement>(null)
  const [overflowing, setOverflowing] = useState(false)
  const label = value ? folders.find((folder) => folder.id === value)?.name ?? 'Ingen mappe' : 'Ingen mappe'

  const measureOverflow = useCallback(() => {
    const node = labelRef.current
    if (!node) return
    setOverflowing(node.scrollWidth > node.clientWidth + 1)
  }, [])

  useEffect(() => {
    measureOverflow()
    const node = labelRef.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measureOverflow)
    observer.observe(node)
    return () => observer.disconnect()
  }, [label, measureOverflow])

  return (
    <div
      className="folder-select"
      data-testid="folder-select-shell"
      data-overflow={overflowing ? 'true' : 'false'}
    >
      <span ref={labelRef} className="folder-select__label" aria-hidden="true">
        {label}
      </span>
      <span className="folder-select__fade" aria-hidden="true" />
      <span className="folder-select__chevron" aria-hidden="true">
        <Icon name="chevron-down" size={14} />
      </span>
      <select
        className="folder-select__native"
        value={value ?? ''}
        aria-label={ariaLabel}
        data-testid="folder-select"
        onChange={(event) => onChange(event.target.value || null)}
      >
        <option value="">Ingen mappe</option>
        {folders.map((folder) => (
          <option key={folder.id} value={folder.id}>
            {folder.name}
          </option>
        ))}
      </select>
    </div>
  )
}
