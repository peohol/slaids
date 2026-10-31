import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Root } from './Root'
import { applyAppearance, useAppearance } from './state/appearance'
import { WorkspaceProvider } from './ui/workspace/WorkspaceContext'
import './styles/global.css'
import './styles/slide.css'
import './styles/library.css'
import './styles/editor.css'

const container = document.getElementById('root')
if (!container) throw new Error('Fant ikke #root')

// Before the first render, so a chosen appearance is in force from the start.
applyAppearance(useAppearance.getState().appearance)

createRoot(container).render(
  <StrictMode>
    {/*
      How much room there is, and how precisely it can be pointed at, above
      every page: the private workspace and a shared deck both have to work on
      a phone, and neither of them should have to ask the browser itself.
    */}
    <WorkspaceProvider>
      <Root />
    </WorkspaceProvider>
  </StrictMode>,
)
