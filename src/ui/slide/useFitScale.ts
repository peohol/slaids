/**
 * Uniform scale factor that fits the logical slide inside a container.
 *
 * Shared by the editor stage, the read-only stage and presentation mode so all
 * three scale identically.
 */

import { useLayoutEffect, useState, type RefObject } from 'react'
import { fitScale } from '../../domain/geometry'

export interface ContainerBox {
  width: number
  height: number
}

const EMPTY: ContainerBox = { width: 0, height: 0 }

/**
 * The usable area inside `ref`, kept up to date as it changes.
 *
 * The one measurement of a stage container there is: `useFitScale` is derived
 * from it, and so is the zoomed view a compact workspace uses to make a small
 * zone big enough to touch. Two observers on the same element would be two
 * answers to one question.
 */
export function useContainerBox(ref: RefObject<HTMLElement | null>): ContainerBox {
  const [box, setBox] = useState<ContainerBox>(EMPTY)

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const update = (): void => {
      // clientWidth/Height include padding, which is not usable area.
      const styles = getComputedStyle(element)
      setBox((current) => {
        const width =
          element.clientWidth -
          parseFloat(styles.paddingLeft || '0') -
          parseFloat(styles.paddingRight || '0')
        const height =
          element.clientHeight -
          parseFloat(styles.paddingTop || '0') -
          parseFloat(styles.paddingBottom || '0')
        return current.width === width && current.height === height ? current : { width, height }
      })
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])

  return box
}

export function useFitScale(ref: RefObject<HTMLElement | null>, initial = 0.5): number {
  const box = useContainerBox(ref)
  return box.width > 0 && box.height > 0 ? fitScale(box.width, box.height) : initial
}
