import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './i18n'
import { initOverlayScrollbars } from './lib/overlay-scrollbars'
import './index.css'

initOverlayScrollbars()

const root = document.getElementById('root')
if (!root) throw new Error('No se encontró #root')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
