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
  DEFAULT_VERTICAL_ALIGN,
  SUBFIELD_DIVIDER_THICKNESS,
} from '../../domain/constants'
import { CARD_TITLE_PART, subfieldPart } from '../../domain/fit'
import { cardShadow, themeMetrics, type ThemeMetrics } from '../../domain/metrics'
import { bestTextColor, dividerColorFor, textShadowFor, WHITE } from '../../domain/color'
import { titleAlign } from '../../domain/richdoc'
import type {
  TextAlign,
  CardBody,
  ImagePanel,
  Subfield,
  TitledCardContent,
  TitledImageCardContent,
  VerticalAlign,
  ZoneContent,
} from '../../domain/types'
import { usePageColors, useSlideRender } from './SlideRenderContext'

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
  /**
   * Noe å legge oppå delestreken etter delfelt `boundary` – editorens
   * dra-håndtak. Tegnes inni streken og tar ingen plass, så en redigert slide
   * og en presentert slide legges ut nøyaktig likt.
   */
  renderDivider?: (boundary: number) => ReactNode
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

/** Where a field's flowed content sits, defaulting to `DEFAULT_VERTICAL_ALIGN`. */
export function flowAlign(align: VerticalAlign | undefined): string {
  return VERTICAL_ALIGNMENT[align ?? DEFAULT_VERTICAL_ALIGN]
}

/** Hvor en tittelboks smalere enn kortet står: der tittelen er justert. */
const TITLE_BOX_ALIGN = {
  left: 'flex-start',
  center: 'center',
  right: 'flex-end',
} as const satisfies Record<TextAlign, string>

/** Inline-stilene til et kort med tittel: kortet, headeren og innholdet. */
export interface TitledCardStyles {
  card: CSSProperties
  header: CSSProperties
  /** Innholdets egen kortflate – hjørner, og skyggen når det er et eget kort. */
  body: CSSProperties
  /** Om et bildeinnhold er et eget kort i stedet for kortets nedre halvdel. */
  bodyIsCard: boolean
}

/**
 * Hvordan et kort med tittel settes sammen i temaets utseende
 * (`TITLED_CARD_STYLES`).
 *
 * Hvert tall er et token: headerens høyde, gapet en svevende header holder,
 * hjørnet en fane lar være fritt (`cardTitleInset`) – de samme estimatoren og
 * bildebriefen leser fra `ThemeMetrics`, så det som tegnes her og det de
 * regner med, ikke kan gli fra hverandre. En header smalere enn kortet er
 * nøyaktig like bred som tittelen pluss polstring (`max-content`) og aldri
 * bredere enn plassen; en lengre tittel renner over sidelengs som enhver
 * korttittel, og det er det fit-målingen og tittelens forminskning leser.
 */
export function titledCardStyles(
  tokens: ThemeMetrics,
  shadow: string,
  align: TextAlign,
  isImage: boolean,
): TitledCardStyles {
  const height = tokens.cardHeaderHeight
  const padding = `0 ${tokens.cardPadding}px`
  if (tokens.titledCardStyle === 'joined') {
    return {
      card: {
        borderRadius: CARD_RADIUS,
        boxShadow: shadow,
        /*
         * Headeren og innholdet har hver sine hjørner, så kortet har ingenting
         * eget å klippe – og et bildeinnhold trenger plassen: editoren tegner
         * de skjulte delene av en beskjæring *utenfor* rammen, og en klipping
         * her ville skjult akkurat det den forhåndsvisningen finnes for å vise.
         * Et tekstinnhold klippes av `.card-body` uansett.
         */
        overflow: isImage ? 'visible' : 'hidden',
      },
      header: { height, padding, borderRadius: `${CARD_RADIUS}px ${CARD_RADIUS}px 0 0` },
      body: { borderRadius: `0 0 ${CARD_RADIUS}px ${CARD_RADIUS}px` },
      bodyIsCard: false,
    }
  }

  // Headeren og innholdet er to bokser som hver klipper sitt eget innhold og
  // kaster sin egen skygge – som et klippende kort rundt dem ville kuttet.
  const room = `calc(100% - ${tokens.cardTitleInset}px)`
  const titleBox: CSSProperties = {
    alignSelf: TITLE_BOX_ALIGN[align],
    width: 'max-content',
    maxWidth: room,
    // En tom tittel er fortsatt en boks man kan se og klikke i.
    minWidth: `min(${height * 2}px, ${room})`,
    marginInline: tokens.cardTitleInset / 2,
    boxShadow: shadow,
  }
  const bodyCard: CSSProperties = { borderRadius: CARD_RADIUS, boxShadow: shadow }
  if (tokens.titledCardStyle === 'tab') {
    // Fanen går én hjørneradius ned bak innholdet, så dens egne nedre hjørner
    // aldri synes og innholdets avrundede øvre hjørner står foran den.
    return {
      card: { overflow: 'visible' },
      header: {
        ...titleBox,
        height: height + CARD_RADIUS,
        padding: `0 ${tokens.cardPadding}px ${CARD_RADIUS}px`,
        marginBottom: -CARD_RADIUS,
        borderRadius: `${CARD_RADIUS}px ${CARD_RADIUS}px 0 0`,
      },
      body: { ...bodyCard, position: 'relative', zIndex: 1 },
      bodyIsCard: true,
    }
  }
  return {
    card: { overflow: 'visible' },
    header: {
      ...titleBox,
      height,
      padding,
      // Like mye luft på skjermen uansett hvor lite sonen tegnes: delt på
      // sonens egen skala (`drawZoneFit`), som er 1 alle andre steder.
      marginBottom: `calc(${tokens.cardBodyOffset - height}px / var(--slaids-zone-fit, 1))`,
      borderRadius: CARD_RADIUS,
    },
    body: bodyCard,
    bodyIsCard: true,
  }
}

function SubfieldStack({
  body,
  dividerColor,
  gap,
  renderField,
  renderDivider,
}: {
  body: CardBody
  dividerColor: string
  gap: number
  renderField: (field: Subfield, index: number) => ReactNode
  renderDivider?: (boundary: number) => ReactNode
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
            >
              {renderDivider?.(index - 1)}
            </div>
          )}
          <div
            className="subfield"
            data-fit-scroll=""
            data-fit-part={subfieldPart(field.id)}
            data-subfield-id={field.id}
            data-align={field.verticalAlign ?? DEFAULT_VERTICAL_ALIGN}
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
  renderDivider,
}: ZoneContentFrameProps) {
  const { theme } = useSlideRender()
  const colors = usePageColors()
  const tokens = themeMetrics(theme)

  if (content.kind === 'negative-space') {
    /*
     * Deliberate air draws nothing — not a placeholder, not a border, not a
     * background. The box is still here because the zone is: it keeps the
     * element tree the same shape as every other zone's, so hit-testing, the
     * drop targets and the editor's outlines need no branch of their own, and
     * an author can select the air and change their mind about it.
     */
    return (
      <div
        className="zone-content zone-content--negative-space"
        data-content-kind="negative-space"
      />
    )
  }

  if (content.kind === 'container') {
    // A container is a card without the card: same subfields, same dividers,
    // but drawn on the slide background, so the divider follows the text colour
    // the background dictates rather than a card's own palette.
    const color = bestTextColor(colors.background)
    return (
      <div
        className="zone-content zone-content--container"
        data-content-kind="container"
        style={{ color, textShadow: textShadowFor(colors.background) }}
      >
        <SubfieldStack
          body={content.body}
          dividerColor={dividerColorFor(colors.background)}
          gap={tokens.subfieldGap}
          renderField={renderField}
          renderDivider={renderDivider}
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
          boxShadow: cardShadow(theme),
          padding: tokens.cardPadding,
          textShadow: textShadowFor(content.backgroundColor),
        }}
      >
        <SubfieldStack
          body={content.body}
          dividerColor={CARD_DIVIDER_COLOR}
          gap={tokens.subfieldGap}
          renderField={renderField}
          renderDivider={renderDivider}
        />
      </div>
    )
  }

  /*
   * A card with no header colour of its own takes the deck's heading pill
   * colour — the same rule a heading with no stored colour follows — so
   * changing the section repaints every such title panel without touching a
   * single stored document.
   */
  const titled = content
  const isImage = titled.kind === 'titled-image-card'
  const headerColor = titled.headerColor ?? colors.accent
  const headerText = bestTextColor(headerColor)
  const look = titledCardStyles(tokens, cardShadow(theme), titleAlign(titled.title), isImage)
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
      data-titled-style={tokens.titledCardStyle}
      style={{
        ...look.card,
        background: 'transparent',
        /*
         * A caption with no colour of its own reads `--slaids-heading-pill`
         * (see `captionTint`), the same variable a heading pill reads. Scoping
         * it to the header's own colour here — rather than leaving the deck's
         * default in force — is what makes the picture's caption follow this
         * card's header instead of the section whenever the header has one of
         * its own, while still falling back to the section when it doesn't,
         * because `headerColor` already carries that fallback.
         */
        '--slaids-heading-pill': headerColor,
        '--slaids-heading-pill-text': headerText,
      } as CSSProperties}
    >
      <div
        className="card-header"
        data-fit-scroll=""
        data-fit-axis="x"
        data-fit-part={CARD_TITLE_PART}
        style={{
          ...look.header,
          background: headerColor,
          color: headerText,
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
         * photograph mounted on a card. Når tittelen er en egen boks, er bildet
         * et eget kort igjen, med egne hjørner og egen skygge.
         */
        <div
          className="card-body card-body--image"
          style={{ position: look.body.position, zIndex: look.body.zIndex }}
        >
          {renderImage(titled.image, look.bodyIsCard ? 'card' : 'body')}
        </div>
      ) : (
        <div
          className="card-body"
          style={{
            ...look.body,
            background: WHITE,
            padding: tokens.cardPadding,
            color: '#000',
          }}
        >
          <SubfieldStack
            body={titled.body}
            dividerColor={CARD_DIVIDER_COLOR}
            gap={tokens.subfieldGap}
            renderField={renderField}
            renderDivider={renderDivider}
          />
        </div>
      )}
    </div>
  )
}
