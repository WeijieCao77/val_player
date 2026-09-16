import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { startTelemetry } from './engine/me/telemetry'
// the career's own sheets only: base.css (copied from the manager game's styles.css), then me.css over it
import './ui/me/base.css'
import './me.css'

// How the game is being played, anonymously and never who is playing it
// (engine/me/telemetry.ts). Before the first render so a crash on the way in is
// still counted; it turns itself off on localhost and file://, so local play
// and the headless checks never report anything.
startTelemetry()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
