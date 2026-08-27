import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { simClock, simulation } from './simulation'
import { useTwin } from './store/useTwin'
import './styles/tokens.css'
import './styles/base.css'
import './styles/components.css'
import './styles/cinematic.css'
import './styles/showcase.css'
import './styles/theatre.css'

/**
 * A diagnostic handle on the running console.
 *
 * The simulation state machine is the thing most worth being able to inspect
 * from outside - it is what the end-to-end tests assert against, and what an
 * operator would be asked for if the console ever looked stuck. Read-only in
 * practice: the controls all go through the same engine.
 */
declare global {
  interface Window {
    __aerotwin?: {
      simulation: typeof simulation
      simClock: typeof simClock
      store: typeof useTwin
    }
  }
}
window.__aerotwin = { simulation, simClock, store: useTwin }

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
