/**
 * Chrome and internal layout for zone content.
 *
 * Both the static renderer and the editable renderer use this, so a card looks
 * and measures identically whether it is being edited, presented or measured
 * offscreen.
 */

import { Fragment, type CSSProperties, type ReactNode } from 'react'
import {
  CARD_DIVIDER_COLOR,
  CARD_RADIUS,
  CARD_SHADOW,
  SUBFIELD_DIVIDER_THICKNESS,
} from '../../domain/constants'
import { themeMetrics } from '../../domain/metrics'
import { bestTextColor, dividerColorFor, textShadowFor, WHITE } from '../../domain/color'
import type {
  CardBody,
  ImagePanel,
  Subfield,
  TitledCardContent,
  TitledImageCardContent,
  VerticalAlign,
  ZoneContent,
} from '../../domain/types'
import { useSlideRender } from './SlideRenderContext'

export interface ZoneContentFrameProps {
  content: ZoneContent
  renderTitle: (content: TitledCardContent | TitledImageCardContent) => ReactNode
  renderField: (field: Subfield, index: number) => ReactNode
  /**
   * The picture panel of a picture kind. Both renderers draw the same
   * `ImagePanelView`; the editor's version adds dragging and the ghost of the
   * hidden parts, which is why it is a prop rather than a branch in here.
   */
  renderImage: (panel: ImagePanel, variant: 'card' | 'body') => ReactNode
}

/**
 * Where a field's flowed content sits inside the field.
 *
 * A field's content box is always the full height of the field — that is what
 * bounds a figure to the field it sits in, and what lets a click anywhere in
 * the field land in the text — so the field has no free space to distribute
 * and aligning the box itself moved nothing. The alignment is handed to the
 * box as a custom property instead and applied to the flow inside it.
 *
 * `safe` is what keeps the fit rule honest: with content taller than its
 * field, plain centring pushes the top of it out through the top edge, where
 * `scrollHeight` cannot see it and the overflow measurement reads half the
 * truth. Overflow then always grows downwards, which is the direction that is
 * measured.
 */
const VERTICAL_ALIGNMENT = {
  top: 'start',
  middle: 'safe center',
  bottom: 'safe end',
} as const satisfies Record<VerticalAlign, string>

/** Where a field's flowed content sits, defaulting to the top of the field. */
export function flowAlign(align: VerticalAlign | undefined): string {
  return VERTICAL_ALIGNMENT[align ?? 'top']
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
            style={
              {
                flexGrow: (body.weights[index] ?? 1) / total,
                flexBasis: 0,
                '--slaids-flow-align': flowAlign(field.verticalAlign),
              } as CSSProperties
            }
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
  renderImage,
}: ZoneContentFrameProps) {
  const { theme, headingPillColor } = useSlideRender()
  const tokens = themeMetrics(theme)

  if (content.kind === 'container') {
    // A container is a card without the card: same subfields, same dividers,
    // but drawn on the slide background, so the divider follows the text colour
    // the background dictates rather than a card's own palette.
    const color = bestTextColor(theme.backgroundColor)
    return (
      <div
        className="zone-content zone-content--container"
        data-content-kind="container"
        style={{ color, textShadow: textShadowFor(theme.backgroundColor) }}
      >
        <SubfieldStack
          body={content.body}
          dividerColor={dividerColorFor(theme.backgroundColor)}
          gap={tokens.subfieldGap}
          renderField={renderField}
        />
      </div>
    )
  }

  /*
   * A picture filling the zone is a card whose whole face is the picture: the
   * same rounded corners and the same shadow, so it sits among the cards
   * around it rather than reading as a hole cut in the slide. Nothing is
   * letterboxed — see `ImagePanel`.
   */
  if (content.kind === 'image') {
    return (
      <div className="zone-content zone-content--image" data-content-kind="image">
        {renderImage(content.image, 'card')}
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

  /*
   * A card with no header colour of its own takes the deck's heading pill
   * colour — the same rule a heading with no stored colour follows — so
   * changing the cover repaints every such title panel without touching a
   * single stored document.
   */
  const titled = content
  const headerColor = titled.headerColor ?? headingPillColor
  const headerText = bestTextColor(headerColor)
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
      data-content-kind={titled.kind}
      style={{
        borderRadius: CARD_RADIUS,
        boxShadow: CARD_SHADOW,
        background: 'transparent',
        /*
         * The header and the body each carry their own corners, so the card
         * has nothing of its own to clip — and a picture body needs the room:
         * the editor draws the hidden parts of a crop *outside* the frame, and
         * a clip here would hide the very thing that preview exists to show.
         * A text body is clipped by `.card-body` either way.
         */
        overflow: titled.kind === 'titled-image-card' ? 'visible' : 'hidden',
        /*
         * A caption with no colour of its own reads `--slaids-heading-pill`
         * (see `captionTint`), the same variable a heading pill reads. Scoping
         * it to the header's own colour here — rather than leaving the deck's
         * default in force — is what makes the picture's caption follow this
         * card's header instead of the cover whenever the header has one of
         * its own, while still falling back to the cover when it doesn't,
         * because `headerColor` already carries that fallback.
         */
        '--slaids-heading-pill': headerColor,
        '--slaids-heading-pill-text': headerText,
      } as CSSProperties}
    >
      <div
        className="card-header"
        data-fit-scroll=""
        style={{
          background: headerColor,
          color: headerText,
          height: tokens.cardHeaderHeight,
          padding: `0 ${tokens.cardPadding}px`,
          borderRadius: `${CARD_RADIUS}px ${CARD_RADIUS}px 0 0`,
          textShadow: textShadowFor(headerColor),
          fontFamily: theme.headingFontFamily,
        }}
      >
        {renderTitle(titled)}
      </div>
      {titled.kind === 'titled-image-card' ? (
        /*
         * The picture *is* the body: no padding and no white beneath it, so the
         * card reads as a title panel over a photograph rather than as a
         * photograph mounted on a card.
         */
        <div className="card-body card-body--image">{renderImage(titled.image, 'body')}</div>
      ) : (
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
            body={titled.body}
            dividerColor={CARD_DIVIDER_COLOR}
            gap={tokens.subfieldGap}
            renderField={renderField}
          />
        </div>
      )}
    </div>
  )
}
