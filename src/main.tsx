import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
// the career's own sheets only: base.css (copied from the manager game's styles.css), then me.css over it
import './ui/me/base.css'
import './me.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
