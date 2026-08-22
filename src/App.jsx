import { useEffect, useState } from 'react'
import Sender from './Sender.jsx'
import Receiver from './Receiver.jsx'

function Icon({ name, size = 20 }) {
  const paths = {
    send: <><path d="M12 19V5"/><path d="m6 11 6-6 6 6"/></>,
    receive: <><path d="M12 5v14"/><path d="m18 13-6 6-6-6"/></>,
    sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41"/></>,
    moon: <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"/>,
  }
  return <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

export default function App() {
  const [tab, setTab] = useState('send')
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem('qr-theme') || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    } catch {
      return 'dark'
    }
  })

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#080b0f' : '#f1f4ed')
    try { localStorage.setItem('qr-theme', theme) } catch {}
  }, [theme])

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-group">
          <div className="brand-mark" aria-hidden="true"><span /><span /><span /></div>
          <div><h1>BeamQR</h1><p>Private, camera-only file transfer.</p></div>
        </div>
        <button className="icon-button" onClick={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
        </button>
      </header>

      <section className="hero-copy">
        <div className="eyebrow"><span className="status-dot" /> 100% OFFLINE</div>
        <h2>Move data from screen to screen.</h2>
        <p>No accounts, cloud, cables, or device pairing. Your camera is the connection.</p>
      </section>

      <div className="trust-row" aria-label="Privacy features"><span>End-to-end local</span><span>Missing-frame recovery</span><span>SHA-256 verified</span></div>

      <nav className="main-tabs" aria-label="Transfer mode">
        <button className={tab === 'send' ? 'active' : ''} onClick={() => setTab('send')} aria-pressed={tab === 'send'}><Icon name="send" /><span><strong>Send</strong><small>Create QR frames</small></span></button>
        <button className={tab === 'receive' ? 'active' : ''} onClick={() => setTab('receive')} aria-pressed={tab === 'receive'}><Icon name="receive" /><span><strong>Receive</strong><small>Scan from camera</small></span></button>
      </nav>

      <div className="content-enter" hidden={tab !== 'send'}><Sender /></div>
      <div className="content-enter" hidden={tab !== 'receive'}><Receiver active={tab === 'receive'} /></div>
      <footer><span className="footer-mark">B</span> BeamQR · Your data never leaves your devices</footer>
    </main>
  )
}
