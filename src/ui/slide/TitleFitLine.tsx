/**
 * Boksen en tittellinje står i: slidetittelen, eller en pille på en
 * inndelingsside. Linjen settes mindre når den ikke får plass (`titleFit.ts`),
 * og editoren kan tegne en markering rundt boksen så lenge den er det.
 *
 * Markeringen er et søsken av boksen, ikke et barn: boksen klipper alt som
 * stikker ut, og markeringen står i gapet utenfor. Den plasseres i sliden, som
 * er det nærmeste posisjonerte elementet.
 */

import { useCallback, useRef, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react'
import { useTitleFit, type TitleFitBox } from './titleFit'

export type TitleFitLineProps = Omit<HTMLAttributes<HTMLDivElement>, 'style'> & {
  /** Boksens stil, uten skriftstørrelsen. */
  style: CSSProperties
  /** Linjens skriftstørrelse i normal størrelse, i slidens piksler. */
  fontSize: number
  boxRef?: (element: HTMLDivElement | null) => void
  /** Tegnes rundt boksen mens linjen er forminsket; bare editoren gir en. */
  marker?: (box: TitleFitBox) => ReactNode
  children?: ReactNode
}

export function TitleFitLine({ style, fontSize, boxRef, marker, children, ...rest }: TitleFitLineProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  const setRef = useCallback(
    (element: HTMLDivElement | null) => {
      ref.current = element
      boxRef?.(element)
    },
    [boxRef],
  )
  const fit = useTitleFit(ref)
  return (
    <>
      <div
        {...rest}
        ref={setRef}
        data-title-fit={fit.box ? fit.scale.toFixed(3) : undefined}
        style={{ ...style, fontSize: `calc(${fontSize}px * var(--slaids-title-fit, 1))` }}
      >
        {children}
      </div>
      {marker && fit.box && (
        <div
          className="zone-fit__mark"
          style={{ left: fit.box.x, top: fit.box.y, width: fit.box.width, height: fit.box.height }}
        >
          {marker(fit.box)}
        </div>
      )}
    </>
  )
}
