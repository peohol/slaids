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
import type { RichDoc, RichMark, RichNode } from '../../domain/types'
import { useSlideRender } from './SlideRenderContext'
import { InlineAssetImage } from './AssetImage'

const DEFAULT_HEADING_PILL = '#33475b'

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
  const assetId = typeof node.attrs?.assetId === 'string' ? node.attrs.assetId : null
  const alt = typeof node.attrs?.alt === 'string' ? node.attrs.alt : ''
  const percent = Number(node.attrs?.widthPercent)
  const aspect = Number(node.attrs?.aspect)
  const width = `${Number.isFinite(percent) && percent > 0 ? percent : 100}%`
  return (
    <div
      className="rd-image-wrapper"
      style={
        {
          width,
          '--slaids-image-aspect': Number.isFinite(aspect) && aspect > 0 ? String(aspect) : undefined,
        } as React.CSSProperties
      }
    >
      <InlineAssetImage assetId={assetId} alt={alt} />
    </div>
  )
}

/**
 * The stored alignment, as the same inline style Tiptap writes.
 *
 * Identical markup from both renderers is what lets one stylesheet position a
 * heading pill (which is `max-content` wide and needs margins, not text-align)
 * without knowing which renderer drew it.
 */
function alignStyle(node: RichNode): React.CSSProperties | undefined {
  const align = node.attrs?.textAlign
  if (align !== 'center' && align !== 'right' && align !== 'left') return undefined
  return { textAlign: align }
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
    case 'heading': {
      const color = typeof node.attrs?.color === 'string' ? node.attrs.color : DEFAULT_HEADING_PILL
      return (
        <h1
          className="rd-heading"
          style={{ background: color, color: bestTextColor(color), ...alignStyle(node) }}
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
