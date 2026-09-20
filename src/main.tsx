import React from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import App from './App.js'

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Elemen root #root tidak ditemukan di DOM.')
}

createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
