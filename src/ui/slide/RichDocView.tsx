/**
 * Static renderer for stored rich-text documents.
 *
 * The same component renders presentation mode, thumbnails and the offscreen
 * fit measurement, so what is measured is exactly what is shown. It walks the
 * stored ProseMirror JSON directly — no HTML is ever injected.
 */

import { Fragment, type ReactNode } from 'react'
import { citationLabel } from '../../domain/references'
import { bestTextColor } from '../../domain/color'
import { drawnAlign, inlineImageOf } from '../../domain/richdoc'
import type { RichDoc, RichMark, RichNode, TextAlign } from '../../domain/types'
import { useSlideRender } from './SlideRenderContext'
import { InlineAssetImage } from './AssetImage'

function applyMarks(node: RichNode, children: ReactNode): ReactNode {
  const marks: RichMark[] = node.marks ?? []
  return marks.reduce<ReactNode>((content, mark) => {
    switch (mark.type) {
      case 'bold':
        return <strong>{content}</strong>
      case 'italic':
        return <em>{content}</em>
      case 'underline':
        return <u>{content}</u>
      case 'strike':
        return <s>{content}</s>
      case 'code':
        return <code className="rd-code">{content}</code>
      case 'link': {
        const href = typeof mark.attrs?.href === 'string' ? mark.attrs.href : undefined
        return (
          <a className="rd-link" href={href} target="_blank" rel="noreferrer noopener">
            {content}
          </a>
        )
      }
      default:
        return content
    }
  }, children)
}

function Citation({ node }: { node: RichNode }) {
  const { numbering, onCitationClick } = useSlideRender()
  const ids = Array.isArray(node.attrs?.referenceIds)
    ? (node.attrs.referenceIds as unknown[]).filter((id): id is string => typeof id === 'string')
    : []
  const label = citationLabel(ids, numbering)
  if (!label) return null
  const isRange = label.length > 2
  const classes = [isRange ? 'rd-citation rd-citation--pill' : 'rd-citation']
  if (onCitationClick) classes.push('rd-citation--clickable')
  return (
    <sup
      className={classes.join(' ')}
      title={onCitationClick ? 'Åpne referansen' : undefined}
      onClick={
        onCitationClick
          ? (event) => {
              event.stopPropagation()
              onCitationClick(ids)
            }
          : undefined
      }
    >
      {label}
    </sup>
  )
}

function SlaidsImage({ node }: { node: RichNode }) {
  // `inlineImageOf` is the one reading of the stored node, so this renderer,
  // the fit estimator and the agent's text format cannot disagree about what a
  // picture is. A node with no file behind it is not drawn at all.
  const image = inlineImageOf(node)
  if (!image) return null
  return (
    <div
      className="rd-image-wrapper"
      style={
        {
          width: `${image.widthPercent}%`,
          '--slaids-image-aspect': image.aspect === null ? undefined : String(image.aspect),
          textAlign: drawnAlign(image.align),
        } as React.CSSProperties
      }
    >
      <InlineAssetImage assetId={image.assetId} alt={image.alt} />
    </div>
  )
}

/**
 * The alignment a block is drawn with, as the same inline style Tiptap writes.
 *
 * Identical markup from both renderers is what lets one stylesheet position a
 * heading pill (which is `max-content` wide and needs margins, not text-align)
 * without knowing which renderer drew it — so a block that stores nothing is
 * written out with the default here too, never left bare. `drawnAlign` is the
 * one place absent becomes a value.
 */
function alignStyle(node: RichNode): React.CSSProperties {
  return { textAlign: drawnAlign(node.attrs?.textAlign as TextAlign | undefined) }
}

function renderNodes(nodes: RichNode[] | undefined): ReactNode {
  if (!nodes) return null
  return nodes.map((node, index) => <RichNodeView key={index} node={node} />)
}

function RichNodeView({ node }: { node: RichNode }): ReactNode {
  switch (node.type) {
    case 'text':
      return <Fragment>{applyMarks(node, node.text ?? '')}</Fragment>
    case 'hardBreak':
      return <br />
    case 'paragraph':
      return (
        <p className="rd-p" style={alignStyle(node)}>
          {renderNodes(node.content) ?? <br />}
        </p>
      )
    /*
     * A heading stores a colour only when somebody picked one. With none, the
     * element carries no colour at all and the deck's default arrives through
     * `--slaids-heading-pill` — so changing it on the cover repaints every such
     * heading without rewriting a single document, and a heading that *was*
     * given a colour keeps it.
     */
    case 'heading': {
      const color = typeof node.attrs?.color === 'string' ? node.attrs.color : null
      return (
        <h1
          className="rd-heading"
          style={{
            ...(color ? { background: color, color: bestTextColor(color) } : null),
            ...alignStyle(node),
          }}
        >
          {renderNodes(node.content)}
        </h1>
      )
    }
    case 'bulletList':
      return <ul className="rd-ul">{renderNodes(node.content)}</ul>
    case 'orderedList':
      return <ol className="rd-ol">{renderNodes(node.content)}</ol>
    case 'listItem':
      return <li className="rd-li">{renderNodes(node.content)}</li>
    case 'blockquote':
      return <blockquote className="rd-quote">{renderNodes(node.content)}</blockquote>
    case 'codeBlock':
      return (
        <pre className="rd-pre">
          <code>{renderNodes(node.content)}</code>
        </pre>
      )
    case 'horizontalRule':
      return <hr className="rd-hr" />
    case 'citation':
      return <Citation node={node} />
    case 'slaidsImage':
      return <SlaidsImage node={node} />
    case 'table':
      return (
        <table className="rd-table">
          <tbody>{renderNodes(node.content)}</tbody>
        </table>
      )
    case 'tableRow':
      return <tr>{renderNodes(node.content)}</tr>
    case 'tableHeader':
      return <th className="rd-th">{renderNodes(node.content)}</th>
    case 'tableCell':
      return <td className="rd-td">{renderNodes(node.content)}</td>
    default:
      return <Fragment>{renderNodes(node.content)}</Fragment>
  }
}

export function RichDocView({ doc, className }: { doc: RichDoc; className?: string }) {
  return (
    <div className={className ? `rich-doc ${className}` : 'rich-doc'}>
      {renderNodes(doc.content)}
    </div>
  )
}
