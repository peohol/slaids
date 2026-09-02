import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Root } from './Root'
import './styles/global.css'
import './styles/slide.css'
import './styles/library.css'
import './styles/editor.css'

const container = document.getElementById('root')
if (!container) throw new Error('Fant ikke #root')

createRoot(container).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
