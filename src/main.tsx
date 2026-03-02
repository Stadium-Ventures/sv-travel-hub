import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

// Safety net: if the app crashes before React can mount (e.g., corrupted localStorage),
// show a recovery UI instead of a blank page.
try {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
} catch (e) {
  console.error('Fatal startup error:', e)
  const root = document.getElementById('root')!
  root.innerHTML = `
    <div style="max-width:500px;margin:80px auto;padding:24px;font-family:system-ui;color:#e0e0e0;text-align:center">
      <h1 style="color:#ff6b6b;font-size:20px">App failed to start</h1>
      <p style="margin:12px 0;font-size:14px;color:#999">${e instanceof Error ? e.message : 'Unknown error'}</p>
      <p style="margin:12px 0;font-size:13px;color:#888">This is usually caused by corrupted saved data. Click below to reset and reload.</p>
      <button onclick="Object.keys(localStorage).filter(k=>k.startsWith('sv-travel')).forEach(k=>localStorage.removeItem(k));location.reload()"
        style="margin:8px;padding:10px 20px;background:#3b82f6;color:white;border:none;border-radius:8px;cursor:pointer;font-size:14px">
        Clear App Data & Reload
      </button>
      <button onclick="location.reload()"
        style="margin:8px;padding:10px 20px;background:#374151;color:#ccc;border:none;border-radius:8px;cursor:pointer;font-size:14px">
        Just Reload
      </button>
    </div>
  `
}

// Also catch unhandled errors that slip past React's error boundary
window.addEventListener('error', (event) => {
  const root = document.getElementById('root')
  // Only intervene if the page is blank (React never rendered)
  if (root && root.children.length === 0) {
    root.innerHTML = `
      <div style="max-width:500px;margin:80px auto;padding:24px;font-family:system-ui;color:#e0e0e0;text-align:center">
        <h1 style="color:#ff6b6b;font-size:20px">Something went wrong</h1>
        <p style="margin:12px 0;font-size:14px;color:#999">${event.error?.message ?? event.message}</p>
        <button onclick="Object.keys(localStorage).filter(k=>k.startsWith('sv-travel')).forEach(k=>localStorage.removeItem(k));location.reload()"
          style="margin:8px;padding:10px 20px;background:#3b82f6;color:white;border:none;border-radius:8px;cursor:pointer;font-size:14px">
          Clear App Data & Reload
        </button>
      </div>
    `
  }
})
