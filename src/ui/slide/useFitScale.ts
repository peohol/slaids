/**
 * Uniform scale factor that fits the logical slide inside a container.
 *
 * Shared by the editor stage, the read-only stage and presentation mode so all
 * three scale identically.
 */

import { useLayoutEffect, useState, type RefObject } from 'react'
import { fitScale } from '../../domain/geometry'

export function useFitScale(ref: RefObject<HTMLElement | null>, initial = 0.5): number {
  const [scale, setScale] = useState(initial)

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const update = (): void => {
      // clientWidth/Height include padding, which is not usable area.
      const styles = getComputedStyle(element)
      const width =
        element.clientWidth -
        parseFloat(styles.paddingLeft || '0') -
        parseFloat(styles.paddingRight || '0')
      const height =
        element.clientHeight -
        parseFloat(styles.paddingTop || '0') -
        parseFloat(styles.paddingBottom || '0')
      setScale(fitScale(width, height))
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])

  return scale
}
