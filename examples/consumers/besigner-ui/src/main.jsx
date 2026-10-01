import { initializeBesignerApp } from '@aglyn/besigner'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.jsx'
import { loadDocument } from './document.js'
import { readSavedDocument } from './storage.js'

// The editor's state lives in a Besigner app, which has to exist before the
// editor mounts.
initializeBesignerApp()
loadDocument(readSavedDocument() ?? undefined)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
