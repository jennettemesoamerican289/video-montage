import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* Deep-space HUD background: nebulae + Tron grid (behind content). */}
    <div className="holo-env" aria-hidden>
      <div className="holo-blob b1" />
      <div className="holo-blob b2" />
      <div className="holo-floor" />
    </div>
    <App />
  </React.StrictMode>,
)
