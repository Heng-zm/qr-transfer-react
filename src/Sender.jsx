import { useEffect, useRef, useState } from 'react'
import QRCodeView from './QRCodeView.jsx'
import { createTransfer, formatBytes } from './protocol.js'

const encoder = new TextEncoder()
const FILE_LIMIT = 2 * 1024 * 1024

function Icon({ name, size = 20 }) {
  const paths = {
    text: <><path d="M4 7V4h16v3M9 20h6M12 4v16"/></>,
    file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/></>,
    upload: <><path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M20 15v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4"/></>,
    play: <path d="m8 5 11 7-11 7Z"/>, pause: <><path d="M9 5v14M15 5v14"/></>,
    maximize: <><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/></>,
    chevronLeft: <path d="m15 18-6-6 6-6"/>, chevronRight: <path d="m9 18 6-6-6-6"/>, close: <><path d="m18 6-12 12M6 6l12 12"/></>,
    awake: <><path d="M12 2v2M4.93 4.93l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 4.93l-1.42 1.42"/><circle cx="12" cy="12" r="4"/><path d="M8 22h8"/></>,
  }
  return <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

export default function Sender() {
  const [mode, setMode] = useState('text')
  const [text, setText] = useState('')
  const [file, setFile] = useState(null)
  const [dragging, setDragging] = useState(false)
  const [transfer, setTransfer] = useState(null)
  const [frameIndex, setFrameIndex] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [speed, setSpeed] = useState(360)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const qrStageRef = useRef(null)
  const wakeLockRef = useRef(null)
  const [wakeActive, setWakeActive] = useState(false)

  useEffect(() => {
    if (!transfer || !playing || transfer.frames.length <= 1) return
    const timer = setInterval(() => setFrameIndex((current) => (current + 1) % transfer.frames.length), speed)
    return () => clearInterval(timer)
  }, [transfer, playing, speed])

  useEffect(() => {
    let cancelled = false

    async function requestWakeLock() {
      if (!transfer || !playing || !navigator.wakeLock || document.visibilityState !== 'visible') return
      try {
        const lock = await navigator.wakeLock.request('screen')
        if (cancelled) { await lock.release(); return }
        wakeLockRef.current = lock
        setWakeActive(true)
        lock.addEventListener('release', () => { if (wakeLockRef.current === lock) { wakeLockRef.current = null; setWakeActive(false) } })
      } catch { setWakeActive(false) }
    }

    function handleVisibility() {
      if (document.visibilityState === 'visible' && !wakeLockRef.current) requestWakeLock()
    }

    requestWakeLock()
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', handleVisibility)
      const lock = wakeLockRef.current
      wakeLockRef.current = null
      setWakeActive(false)
      lock?.release().catch(() => {})
    }
  }, [transfer, playing])

  const inputBytes = mode === 'text' ? encoder.encode(text).length : (file?.size || 0)
  const hasContent = mode === 'text' ? inputBytes > 0 : Boolean(file)
  const estimatedFrames = hasContent ? Math.max(1, Math.ceil((inputBytes * 1.38) / 650)) : 0
  const canPrepare = hasContent && inputBytes <= FILE_LIMIT
  const contentTooLarge = mode === 'text' && inputBytes > FILE_LIMIT

  function chooseFile(nextFile) {
    setError('')
    if (!nextFile) return
    if (nextFile.size > FILE_LIMIT) { setFile(null); setError('That file is over the 2 MB limit. Smaller files also scan much faster.'); return }
    setFile(nextFile)
  }

  async function prepare() {
    if (!canPrepare) return
    setBusy(true); setError('')
    try {
      const bytes = mode === 'text' ? encoder.encode(text) : new Uint8Array(await file.arrayBuffer())
      const kind = mode
      const name = mode === 'text' ? 'message.txt' : file.name
      const mime = mode === 'text' ? 'text/plain;charset=utf-8' : (file.type || 'application/octet-stream')
      const result = await createTransfer({ kind, name, mime, bytes })
      setTransfer({ ...result, kind, name, mime }); setFrameIndex(0); setPlaying(true)
    } catch (e) { setError(e?.message || 'Could not prepare transfer.') } finally { setBusy(false) }
  }

  function reset() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    setTransfer(null); setFrameIndex(0); setPlaying(true); setError('')
  }

  function stepFrame(direction) { setPlaying(false); setFrameIndex((current) => (current + direction + transfer.frames.length) % transfer.frames.length) }
  async function enterFullscreen() {
    if (!qrStageRef.current?.requestFullscreen) { setError('Fullscreen is not available in this browser.'); return }
    try { await qrStageRef.current.requestFullscreen() } catch { setError('Fullscreen could not be opened. Check your browser permissions.') }
  }

  if (transfer) {
    const percent = ((frameIndex + 1) / transfer.frames.length) * 100
    const savings = transfer.originalBytes ? Math.max(0, Math.round((1 - transfer.compressedBytes / transfer.originalBytes) * 100)) : 0
    return (
      <section className="panel sender-panel">
        <div className="panel-heading"><div><div className="step-label">READY TO SEND</div><h2>Show this code to the receiver</h2><p>Keep both screens awake and facing each other.</p></div><button className="ghost-button compact" onClick={reset}><Icon name="close" size={17} /> New transfer</button></div>
        <div className="qr-stage" ref={qrStageRef}><div className="qr-glow" /><QRCodeView value={transfer.frames[frameIndex]} size={360} /><div className="frame-counter"><span className={playing ? 'live-dot' : ''} /> Frame {frameIndex + 1} of {transfer.frames.length}</div></div>
        <div className="timeline"><div className="progress-track" aria-label={`Frame ${frameIndex + 1} of ${transfer.frames.length}`}><div className="progress-fill" style={{ width: `${percent}%` }} /></div><div className="frame-controls"><button className="icon-button" onClick={() => stepFrame(-1)} aria-label="Previous frame"><Icon name="chevronLeft" /></button><button className="primary-button play-button" onClick={() => setPlaying((value) => !value)}><Icon name={playing ? 'pause' : 'play'} size={18} /> {playing ? 'Pause' : 'Play'}</button><button className="icon-button" onClick={() => stepFrame(1)} aria-label="Next frame"><Icon name="chevronRight" /></button></div></div>
        <div className="transfer-summary"><div><span>Transfer</span><strong title={transfer.name}>{transfer.name}</strong></div><div><span>Size</span><strong>{formatBytes(transfer.originalBytes)}</strong></div><div><span>Compressed</span><strong>{savings ? `${savings}% smaller` : formatBytes(transfer.compressedBytes)}</strong></div><div><span>Frames</span><strong>{transfer.frames.length}</strong></div></div>
        <div className="control-row split-controls"><label className="select-control"><span>Scan speed</span><select value={speed} onChange={(event) => setSpeed(Number(event.target.value))}><option value={220}>Fast · 4.5 fps</option><option value={360}>Balanced · 2.8 fps</option><option value={520}>Easy · 1.9 fps</option><option value={750}>Slow · 1.3 fps</option></select></label><div className="sender-actions">{wakeActive && <span className="awake-badge"><Icon name="awake" size={15} /> Screen awake</span>}<button className="secondary-button" onClick={enterFullscreen}><Icon name="maximize" size={18} /> Fullscreen</button></div></div>
        {error && <div className="error-box" role="alert">{error}</div>}
      </section>
    )
  }

  return (
    <section className="panel sender-panel">
      <div className="panel-heading"><div><div className="step-label">STEP 1 OF 2</div><h2>What are you sending?</h2><p>Choose text for notes and links, or send any file up to 2 MB.</p></div></div>
      <div className="segmented"><button className={mode === 'text' ? 'active' : ''} onClick={() => { setMode('text'); setError('') }}><Icon name="text" size={18} /> Text</button><button className={mode === 'file' ? 'active' : ''} onClick={() => { setMode('file'); setError('') }}><Icon name="file" size={18} /> File</button></div>
      {mode === 'text' ? <div className="input-wrap"><textarea className={`text-input ${contentTooLarge ? 'invalid' : ''}`} rows={8} placeholder="Paste a message, link, password, or note…" value={text} onChange={(event) => setText(event.target.value)} autoFocus aria-invalid={contentTooLarge} /><div className="input-meta"><span className={contentTooLarge ? 'limit-warning' : ''}>{contentTooLarge ? `${formatBytes(inputBytes)} — exceeds the 2 MB limit` : `${text.length.toLocaleString()} characters`}</span>{text && <button onClick={() => setText('')}>Clear</button>}</div></div> : <label className={`drop-zone ${dragging ? 'dragging' : ''} ${file ? 'has-file' : ''}`} onDragEnter={(event) => { event.preventDefault(); setDragging(true) }} onDragOver={(event) => event.preventDefault()} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); chooseFile(event.dataTransfer.files?.[0]) }}><input type="file" onClick={(event) => { event.currentTarget.value = '' }} onChange={(event) => chooseFile(event.target.files?.[0])} /><span className="drop-icon"><Icon name={file ? 'file' : 'upload'} size={24} /></span><strong>{file ? file.name : 'Drop a file here'}</strong><small>{file ? `${formatBytes(file.size)} · Click to replace` : 'or click to browse · maximum 2 MB'}</small></label>}
      {error && <div className="error-box" role="alert">{error}</div>}
      <div className="prepare-row"><div className="estimate"><span>Estimated transfer</span><strong>{hasContent ? `~${estimatedFrames} QR frame${estimatedFrames === 1 ? '' : 's'}` : 'Waiting for content'}</strong></div><button className="primary-button" disabled={!canPrepare || busy} onClick={prepare}>{busy ? <><span className="spinner" /> Preparing…</> : <>Create QR codes <span aria-hidden="true">→</span></>}</button></div>
      <div className="privacy-note"><span>✓</span><p><strong>Stays on this device.</strong> Content is compressed and converted locally—nothing is uploaded.</p></div>
    </section>
  )
}
