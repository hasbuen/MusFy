import React, { Suspense, lazy } from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'

const App = lazy(() => import('./App.tsx'))

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center bg-[#050505] text-white">
          <div className="rounded-[28px] border border-white/10 bg-white/[0.03] px-8 py-6 text-center shadow-[0_20px_60px_rgba(0,0,0,0.24)]">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-green-300">MusFy</p>
            <p className="mt-3 text-lg font-semibold">Carregando interface...</p>
          </div>
        </div>
      }
    >
      <App />
    </Suspense>
  </React.StrictMode>,
)
