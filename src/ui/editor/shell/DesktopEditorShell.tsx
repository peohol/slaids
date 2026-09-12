/**
 * The editor with room to spare: strip, stage and inspector side by side.
 *
 * This is the arrangement Slaids has always had, and it is deliberately still
 * the default — desktop-first means the roomy layout is not a variant of the
 * small one. Everything in it is built by `EditorView`; this file is the
 * placement and nothing else.
 */

import { TopToolbar } from '../TopToolbar'
import type { EditorShellProps } from './editorShell'

export function DesktopEditorShell(props: EditorShellProps) {
  return (
    <>
      <div className="editor" data-testid="editor" data-shell="desktop" data-fonts={props.fontState}>
        <TopToolbar {...props.toolbar} />
        {props.textToolbar}
        <div className="editor__body">
          {props.filmstrip}
          {props.stage}
          {props.inspector}
        </div>
        {props.statusBar}
      </div>
      {props.placementBar}
      {props.ideas}
      {props.sandbox}
    </>
  )
}
