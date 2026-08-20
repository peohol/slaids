/**
 * Chrome and internal layout for zone content.
 *
 * Both the static renderer and the editable renderer use this, so a card looks
 * and measures identically whether it is being edited, presented or measured
 * offscreen.
 */

import { Fragment, type ReactNode } from 'react'
import {
  CARD_HEADER_HEIGHT,
  CARD_PADDING,
  CARD_RADIUS,
  CARD_SHADOW,
  SUBFIELD_DIVIDER_THICKNESS,
  SUBFIELD_GAP,
} from '../../domain/constants'
import { bestTextColor, dividerColorFor, textShadowFor, WHITE } from '../../domain/color'
import type { CardBody, Subfield, ZoneContent } from '../../domain/types'
import { useSlideRender } from './SlideRenderContext'

export interface ZoneContentFrameProps {
  content: ZoneContent
  renderTitle: (content: Extract<ZoneContent, { kind: 'titled-card' }>) => ReactNode
  renderField: (field: Subfield, index: number) => ReactNode
  renderContainer: (content: Extract<ZoneContent, { kind: 'container' }>) => ReactNode
}

function SubfieldStack({
  body,
  dividerColor,
  renderField,
}: {
  body: CardBody
  dividerColor: string
  renderField: (field: Subfield, index: number) => ReactNode
}) {
  const total = body.weights.reduce((sum, weight) => sum + weight, 0) || body.subfields.length
  return (
    <div
      className="subfields"
      style={{
        flexDirection: body.axis === 'x' ? 'row' : 'column',
        gap: SUBFIELD_GAP,
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
            style={{ flexGrow: (body.weights[index] ?? 1) / total, flexBasis: 0 }}
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
  renderContainer,
}: ZoneContentFrameProps) {
  const { theme } = useSlideRender()

  if (content.kind === 'container') {
    const color = bestTextColor(theme.backgroundColor)
    return (
      <div
        className="zone-content zone-content--container"
        data-content-kind="container"
        data-fit-scroll=""
        style={{ color, textShadow: textShadowFor(theme.backgroundColor) }}
      >
        {renderContainer(content)}
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
          padding: CARD_PADDING,
          textShadow: textShadowFor(content.backgroundColor),
        }}
      >
        <SubfieldStack
          body={content.body}
          dividerColor={dividerColorFor(content.backgroundColor)}
          renderField={renderField}
        />
      </div>
    )
  }

  const headerText = bestTextColor(content.headerColor)
  return (
    <div
      className="zone-content zone-content--card zone-content--titled"
      data-content-kind="titled-card"
      style={{ borderRadius: CARD_RADIUS, boxShadow: CARD_SHADOW, background: WHITE }}
    >
      <div
        className="card-header"
        data-fit-scroll=""
        style={{
          background: content.headerColor,
          color: headerText,
          height: CARD_HEADER_HEIGHT,
          padding: `0 ${CARD_PADDING}px`,
          borderTopLeftRadius: CARD_RADIUS,
          borderTopRightRadius: CARD_RADIUS,
          textShadow: textShadowFor(content.headerColor),
          fontFamily: theme.headingFontFamily,
        }}
      >
        {renderTitle(content)}
      </div>
      <div className="card-body" style={{ padding: CARD_PADDING, color: '#000' }}>
        <SubfieldStack
          body={content.body}
          dividerColor={content.headerColor}
          renderField={renderField}
        />
      </div>
    </div>
  )
}
