/**
 * Chrome and internal layout for zone content.
 *
 * Both the static renderer and the editable renderer use this, so a card looks
 * and measures identically whether it is being edited, presented or measured
 * offscreen.
 */

import { Fragment, type ReactNode } from 'react'
import {
  CARD_DIVIDER_COLOR,
  CARD_RADIUS,
  CARD_SHADOW,
  SUBFIELD_DIVIDER_THICKNESS,
} from '../../domain/constants'
import { themeMetrics } from '../../domain/metrics'
import { bestTextColor, dividerColorFor, textShadowFor, WHITE } from '../../domain/color'
import type { CardBody, Subfield, VerticalAlign, ZoneContent } from '../../domain/types'
import { useSlideRender } from './SlideRenderContext'

export interface ZoneContentFrameProps {
  content: ZoneContent
  renderTitle: (content: Extract<ZoneContent, { kind: 'titled-card' }>) => ReactNode
  renderField: (field: Subfield, index: number) => ReactNode
  /** Only for a container filled with a picture; its text goes through `renderField`. */
  renderAsset: (payload: { assetId: string; fit: 'contain' | 'cover' }) => ReactNode
}

/** Flexbox placement for a vertical alignment, defaulting to the top. */
export function justifyFor(align: VerticalAlign | undefined): string {
  if (align === 'middle') return 'center'
  if (align === 'bottom') return 'flex-end'
  return 'flex-start'
}

function SubfieldStack({
  body,
  dividerColor,
  gap,
  renderField,
}: {
  body: CardBody
  dividerColor: string
  gap: number
  renderField: (field: Subfield, index: number) => ReactNode
}) {
  const total = body.weights.reduce((sum, weight) => sum + weight, 0) || body.subfields.length
  return (
    <div
      className="subfields"
      style={{
        flexDirection: body.axis === 'x' ? 'row' : 'column',
        gap,
      }}
    >
      {body.subfields.map((field, index) => (
        <Fragment key={field.id}>
          {index > 0 && (
            <div
              className="subfield-divider"
              style={{
                background: dividerColor,
                borderRadius: SUBFIELD_DIVIDER_THICKNESS,
                ...(body.axis === 'x'
                  ? { width: SUBFIELD_DIVIDER_THICKNESS, alignSelf: 'stretch' }
                  : { height: SUBFIELD_DIVIDER_THICKNESS, alignSelf: 'stretch' }),
              }}
            />
          )}
          <div
            className="subfield"
            data-fit-scroll=""
            data-subfield-id={field.id}
            data-align={field.verticalAlign ?? 'top'}
            style={{
              flexGrow: (body.weights[index] ?? 1) / total,
              flexBasis: 0,
              justifyContent: justifyFor(field.verticalAlign),
            }}
          >
            {renderField(field, index)}
          </div>
        </Fragment>
      ))}
    </div>
  )
}

export function ZoneContentFrame({
  content,
  renderTitle,
  renderField,
  renderAsset,
}: ZoneContentFrameProps) {
  const { theme } = useSlideRender()
  const tokens = themeMetrics(theme)

  if (content.kind === 'container') {
    const color = bestTextColor(theme.backgroundColor)
    if (content.payload.type === 'asset') {
      return (
        <div
          className="zone-content zone-content--container"
          data-content-kind="container"
          data-fit-scroll=""
          data-align={content.verticalAlign ?? 'top'}
          style={{
            color,
            textShadow: textShadowFor(theme.backgroundColor),
            justifyContent: justifyFor(content.verticalAlign),
          }}
        >
          {renderAsset(content.payload)}
        </div>
      )
    }
    // A container is a card without the card: same subfields, same dividers,
    // but drawn on the slide background, so the divider follows the text colour
    // the background dictates rather than a card's own palette.
    return (
      <div
        className="zone-content zone-content--container"
        data-content-kind="container"
        style={{ color, textShadow: textShadowFor(theme.backgroundColor) }}
      >
        <SubfieldStack
          body={content.payload.body}
          dividerColor={dividerColorFor(theme.backgroundColor)}
          gap={tokens.subfieldGap}
          renderField={renderField}
        />
      </div>
    )
  }

  if (content.kind === 'untitled-card') {
    const color = bestTextColor(content.backgroundColor)
    return (
      <div
        className="zone-content zone-content--card"
        data-content-kind="untitled-card"
        style={{
          background: content.backgroundColor,
          color,
          borderRadius: CARD_RADIUS,
          boxShadow: CARD_SHADOW,
          padding: tokens.cardPadding,
          textShadow: textShadowFor(content.backgroundColor),
        }}
      >
        <SubfieldStack
          body={content.body}
          dividerColor={CARD_DIVIDER_COLOR}
          gap={tokens.subfieldGap}
          renderField={renderField}
        />
      </div>
    )
  }

  const headerText = bestTextColor(content.headerColor)
  return (
    /*
     * The card paints nothing itself: the header and the body each carry their
     * own colour and their own corners.
     *
     * A white card behind a coloured header is what put a pale hairline along
     * the top of the header. The header is clipped to the card's rounded
     * corner, and the clip is antialiased — so along that edge the header
     * colour was blended with the white *underneath* it, and the slide is drawn
     * at a fractional scale, which lands the straight top edge on a half pixel
     * and shows the same white the whole way across. With nothing painted
     * behind the header, the only thing left to blend with is the slide
     * background, which is what an edge is supposed to blend with.
     */
    <div
      className="zone-content zone-content--card zone-content--titled"
      data-content-kind="titled-card"
      style={{
        borderRadius: CARD_RADIUS,
        boxShadow: CARD_SHADOW,
        background: 'transparent',
        overflow: 'hidden',
      }}
    >
      <div
        className="card-header"
        data-fit-scroll=""
        style={{
          background: content.headerColor,
          color: headerText,
          height: tokens.cardHeaderHeight,
          padding: `0 ${tokens.cardPadding}px`,
          borderRadius: `${CARD_RADIUS}px ${CARD_RADIUS}px 0 0`,
          textShadow: textShadowFor(content.headerColor),
          fontFamily: theme.headingFontFamily,
        }}
      >
        {renderTitle(content)}
      </div>
      <div
        className="card-body"
        style={{
          background: WHITE,
          padding: tokens.cardPadding,
          borderRadius: `0 0 ${CARD_RADIUS}px ${CARD_RADIUS}px`,
          color: '#000',
        }}
      >
        <SubfieldStack
          body={content.body}
          dividerColor={CARD_DIVIDER_COLOR}
          gap={tokens.subfieldGap}
          renderField={renderField}
        />
      </div>
    </div>
  )
}
