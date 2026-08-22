import { useEffect, useRef, useState } from 'react'
import { BrowserQRCodeReader } from '@zxing/browser'
import { formatBytes, parseFrame, rebuildTransfer } from './protocol.js'

const decoder = new TextDecoder()

function Icon({ name, size = 20 }) {
  const paths = {
    camera: <><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3Z"/><circle cx="12" cy="13" r="3"/></>,
    stop: <rect x="6" y="6" width="12" height="12" rx="1"/>,
    flip: <><path d="m17 1 4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></>,
    copy: <><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></>,
    download: <><path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/></>,
    reset: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></>,
    shield: <><path d="M20 13c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V5l8-3 8 3Z"/><path d="m9 12 2 2 4-4"/></>,
    flash: <path d="m13 2-9 12h8l-1 8 9-12h-8Z"/>,
  }
  return <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

export default function Receiver({ active = true }) {
  const videoRef = useRef(null)
  const controlsRef = useRef(null)
  const framesRef = useRef(new Map())
  const activeIdRef = useRef(null)
  const rebuildingRef = useRef(false)
  const scanSessionRef = useRef(0)
  const resultTextRef = useRef(null)
  const copyTimerRef = useRef(null)
  const trackingTimerRef = useRef(null)
  const trackingHistoryRef = useRef(null)
  const firstFrameAtRef = useRef(0)
  const [scanning, setScanning] = useState(false)
  const [status, setStatus] = useState('Ready when you are')
  const [progress, setProgress] = useState({ received: 0, total: 0 })
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [cameraFacing, setCameraFacing] = useState('environment')
  const [copied, setCopied] = useState(false)
  const [tracking, setTracking] = useState(null)
  const [torchAvailable, setTorchAvailable] = useState(false)
  const [torchOn, setTorchOn] = useState(false)
  const [scanRate, setScanRate] = useState(0)

  useEffect(() => () => {
    scanSessionRef.current += 1
    try { controlsRef.current?.stop() } catch {}
    clearTimeout(copyTimerRef.current)
    clearTimeout(trackingTimerRef.current)
  }, [])

  useEffect(() => {
    if (!active) stopScanner()
  }, [active])

  function stopScanner() { scanSessionRef.current += 1; try { controlsRef.current?.stop() } catch {} controlsRef.current = null; clearTimeout(trackingTimerRef.current); trackingHistoryRef.current = null; setTracking(null); setTorchAvailable(false); setTorchOn(false); setScanning(false) }
  function resetTransfer() { framesRef.current = new Map(); activeIdRef.current = null; rebuildingRef.current = false; firstFrameAtRef.current = 0; trackingHistoryRef.current = null; setProgress({ received: 0, total: 0 }); setResult(null); setError(''); setStatus('Ready when you are'); setCopied(false); setTracking(null); setScanRate(0) }

  function trackResult(scanResult, valid) {
    const video = videoRef.current
    const rawPoints = scanResult.getResultPoints?.() || []
    if (!video || rawPoints.length < 3 || !video.videoWidth || !video.videoHeight) return

    const point = (value) => ({ x: value.getX?.() ?? value.x, y: value.getY?.() ?? value.y })
    const bottomLeft = point(rawPoints[0])
    const topLeft = point(rawPoints[1])
    const topRight = point(rawPoints[2])
    if (![bottomLeft, topLeft, topRight].every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y))) return
    const bottomRight = { x: bottomLeft.x + topRight.x - topLeft.x, y: bottomLeft.y + topRight.y - topLeft.y }
    const width = video.clientWidth
    const height = video.clientHeight
    const scale = Math.max(width / video.videoWidth, height / video.videoHeight)
    const offsetX = (width - video.videoWidth * scale) / 2
    const offsetY = (height - video.videoHeight * scale) / 2
    const mapped = [topLeft, topRight, bottomRight, bottomLeft].map(({ x, y }) => ({ x: x * scale + offsetX, y: y * scale + offsetY }))
    const previous = trackingHistoryRef.current
    const sameViewport = previous?.width === width && previous?.height === height && previous?.valid === valid
    const diagonal = Math.hypot(width, height) || 1
    const movement = sameViewport
      ? mapped.reduce((total, current, index) => total + Math.hypot(current.x - previous.points[index].x, current.y - previous.points[index].y), 0) / mapped.length / diagonal
      : 1
    const stable = sameViewport && movement < .12
    const hits = stable ? Math.min(previous.hits + 1, 6) : 1
    const smoothing = stable ? .58 : 1
    const smoothed = mapped.map((current, index) => stable ? {
      x: previous.points[index].x + (current.x - previous.points[index].x) * smoothing,
      y: previous.points[index].y + (current.y - previous.points[index].y) * smoothing,
    } : current)
    const stabilityBonus = stable ? Math.max(0, Math.round((.12 - movement) * 110)) : 0
    const confidence = Math.min(valid ? 99 : 55, (valid ? 54 : 20) + hits * 7 + stabilityBonus)
    const label = valid ? (confidence >= 85 ? 'HIGH CONFIDENCE' : confidence >= 68 ? 'LOCKED' : 'ACQUIRING') : 'OTHER QR'

    trackingHistoryRef.current = { points: smoothed, width, height, valid, hits }
    setTracking({ points: smoothed.map(({ x, y }) => `${x},${y}`).join(' '), width, height, valid, confidence, label })
    clearTimeout(trackingTimerRef.current)
    trackingTimerRef.current = setTimeout(() => { trackingHistoryRef.current = null; setTracking(null) }, 680)
  }

  async function startScanner(nextFacing = cameraFacing, preserveProgress = false) {
    stopScanner()
    const session = scanSessionRef.current
    if (!preserveProgress) resetTransfer()
    setError(''); setStatus('Starting camera…')
    if (!window.isSecureContext) { setError('Camera access requires HTTPS or localhost. Install the PWA first for fully offline use on iPhone or iPad.'); setStatus('Camera unavailable'); return }
    if (!navigator.mediaDevices?.getUserMedia) { setError('Camera scanning is not supported by this browser.'); setStatus('Camera unavailable'); return }
    try {
      const reader = new BrowserQRCodeReader(undefined, { delayBetweenScanAttempts: 20 })
      const controls = await reader.decodeFromConstraints({ audio: false, video: { facingMode: { ideal: nextFacing }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } } }, videoRef.current, async (scanResult) => {
        if (session !== scanSessionRef.current || !scanResult || rebuildingRef.current) return
        const frame = parseFrame(scanResult.getText())
        const matchesTransfer = Boolean(frame && (!activeIdRef.current || frame.id === activeIdRef.current))
        trackResult(scanResult, matchesTransfer)
        if (!frame) { setStatus('QR found, but it is not a BeamQR transfer'); return }
        if (activeIdRef.current && frame.id !== activeIdRef.current) { setStatus('Different transfer found — keep scanning the original'); return }
        if (!activeIdRef.current) activeIdRef.current = frame.id
        if (!framesRef.current.has(frame.i)) {
          framesRef.current.set(frame.i, frame)
          const received = framesRef.current.size
          const now = performance.now()
          if (!firstFrameAtRef.current) firstFrameAtRef.current = now
          if (received > 1) setScanRate((received - 1) / Math.max(.25, (now - firstFrameAtRef.current) / 1000))
          navigator.vibrate?.(received === frame.n ? [35, 45, 70] : 16)
          setProgress({ received, total: frame.n }); setStatus('Receiving frames…')
          if (received === frame.n) {
            rebuildingRef.current = true; setStatus('Verifying transfer…')
            try { const rebuilt = await rebuildTransfer(framesRef.current); setResult(rebuilt); setStatus('Transfer complete'); stopScanner() }
            catch (e) { setError(e?.message || 'Could not rebuild transfer.'); setStatus('Transfer failed'); rebuildingRef.current = false }
          }
        }
      })
      if (session !== scanSessionRef.current) { controls.stop(); return }
      controlsRef.current = controls
      const videoTrack = videoRef.current?.srcObject?.getVideoTracks?.()[0]
      let supportsTorch = false
      try {
        const capabilities = videoTrack?.getCapabilities?.() || {}
        supportsTorch = Boolean(capabilities.torch)
        const cameraTuning = {}
        if (capabilities.focusMode?.includes?.('continuous')) cameraTuning.focusMode = 'continuous'
        if (capabilities.exposureMode?.includes?.('continuous')) cameraTuning.exposureMode = 'continuous'
        if (capabilities.whiteBalanceMode?.includes?.('continuous')) cameraTuning.whiteBalanceMode = 'continuous'
        if (Object.keys(cameraTuning).length) videoTrack.applyConstraints({ advanced: [cameraTuning] }).catch(() => {})
      } catch {}
      setTorchAvailable(supportsTorch)
      setScanning(true); setStatus(framesRef.current.size ? 'Receiving frames…' : 'Looking for BeamQR codes…')
    } catch (e) {
      if (session !== scanSessionRef.current) return
      const cameraErrors = {
        NotAllowedError: 'Camera permission was denied. Allow access in your browser settings and try again.',
        NotFoundError: 'No camera was found on this device.',
        NotReadableError: 'The camera is already being used by another app.',
        OverconstrainedError: 'This camera does not support the requested settings.',
      }
      setError(cameraErrors[e?.name] || e?.message || 'Could not start the camera.')
      setStatus('Camera unavailable'); setScanning(false)
    }
  }

  async function flipCamera() { const next = cameraFacing === 'environment' ? 'user' : 'environment'; setCameraFacing(next); await startScanner(next, true) }
  async function toggleTorch() {
    const track = videoRef.current?.srcObject?.getVideoTracks?.()[0]
    if (!track) return
    const next = !torchOn
    try { await track.applyConstraints({ advanced: [{ torch: next }] }); setTorchOn(next) }
    catch { setTorchAvailable(false); setError('Torch control is not available for this camera.') }
  }
  function saveResult() { if (!result) return; const blob = new Blob([result.bytes], { type: result.mime || 'application/octet-stream' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = result.name || 'received-file'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000) }
  async function copyText() {
    if (!result) return
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(textResult)
      else { resultTextRef.current?.select(); if (!document.execCommand('copy')) throw new Error('Copy failed') }
      setCopied(true); clearTimeout(copyTimerRef.current); copyTimerRef.current = setTimeout(() => setCopied(false), 1800)
    } catch { resultTextRef.current?.select(); setError('Clipboard access was blocked. The text has been selected so you can copy it manually.') }
  }

  const percentage = progress.total ? Math.round((progress.received / progress.total) * 100) : 0
  const textResult = result?.kind === 'text' ? decoder.decode(result.bytes) : ''
  const remainingSeconds = scanRate > 0 ? Math.ceil((progress.total - progress.received) / scanRate) : 0
  const mapSize = Math.min(progress.total, 64)
  const frameMap = Array.from({ length: mapSize }, (_, index) => {
    const start = Math.floor(index * progress.total / mapSize)
    const end = Math.max(start + 1, Math.floor((index + 1) * progress.total / mapSize))
    for (let frame = start; frame < end; frame += 1) if (!framesRef.current.has(frame)) return false
    return true
  })

  return (
    <section className="panel receiver-panel">
      <div className="panel-heading"><div><div className="step-label">RECEIVE MODE</div><h2>{result ? 'Your transfer is ready' : 'Scan the sender screen'}</h2><p>{result ? 'Integrity checked. The content is safe to open.' : 'Center the animated QR code inside the frame.'}</p></div>{(progress.received > 0 || result) && <button className="ghost-button compact" onClick={() => { stopScanner(); resetTransfer() }}><Icon name="reset" size={17} /> Reset</button>}</div>

      {!result && (
        <div className={`camera-shell ${scanning ? 'is-scanning' : ''} ${tracking?.valid ? 'has-lock' : ''}`}>
          <video ref={videoRef} className="camera-view" muted playsInline />
          <div className="camera-overlay" />
          <div className="scan-frame"><span /><span /><span /><span /><i /></div>
          {tracking && (
            <svg className={`qr-tracker ${tracking.valid ? 'valid' : 'foreign'}`} viewBox={`0 0 ${tracking.width} ${tracking.height}`} aria-hidden="true">
              <polygon points={tracking.points} />
              <text x="50%" y="24">{tracking.label}</text>
            </svg>
          )}
          {tracking && <><div className={`tracking-badge ${tracking.valid ? '' : 'foreign'}`}><span /> {tracking.label.toLowerCase()} <strong>{tracking.confidence}%</strong></div><div className={`confidence-meter ${tracking.valid ? '' : 'foreign'}`}><i style={{ width: `${tracking.confidence}%` }} /></div></>}
          {!scanning && <div className="camera-placeholder"><span className="camera-icon"><Icon name="camera" size={30} /></span><strong>Camera preview</strong><small>Your browser will ask for permission</small></div>}
        </div>
      )}

      {!result && <div className="control-row receiver-controls"><button className="primary-button" onClick={() => scanning ? stopScanner() : startScanner()}><Icon name={scanning ? 'stop' : 'camera'} size={18} /> {scanning ? 'Stop camera' : 'Start scanning'}</button>{scanning && <button className="secondary-button" onClick={flipCamera}><Icon name="flip" size={18} /> Flip camera</button>}{scanning && torchAvailable && <button className={`secondary-button ${torchOn ? 'is-active' : ''}`} onClick={toggleTorch} aria-pressed={torchOn}><Icon name="flash" size={18} /> {torchOn ? 'Torch on' : 'Torch'}</button>}</div>}

      {!result && <div className="status-card" aria-live="polite"><div className="status-line"><div><span className={`status-indicator ${scanning ? 'active' : ''}`} /><strong>{status}</strong></div>{progress.total > 0 && <span>{percentage}%</span>}</div>{progress.total > 0 && <><div className="progress-track"><div className="progress-fill" style={{ width: `${percentage}%` }} /></div><div className="frame-map" aria-label={`${progress.received} of ${progress.total} frames captured`}>{frameMap.map((captured, index) => <span className={captured ? 'captured' : ''} key={index} />)}</div><div className="receive-metrics"><small>{progress.received} captured · {progress.total - progress.received} missing</small>{scanRate > 0 && <small>{scanRate.toFixed(1)} frames/s · ~{remainingSeconds}s left</small>}</div></>}</div>}
      {error && <div className="error-box" role="alert">{error}</div>}

      {result && <div className="result-card"><div className="success-orbit"><Icon name="shield" size={32} /></div><div className="success-badge">✓ SHA-256 verified</div><h3>{result.kind === 'text' ? 'Received text' : (result.name || 'Received file')}</h3><p>{formatBytes(result.bytes.length)} · received entirely offline</p>{result.kind === 'text' ? <><textarea ref={resultTextRef} className="text-input result-text" readOnly value={textResult} rows={8} /><button className="primary-button full" onClick={copyText}><Icon name="copy" size={18} /> {copied ? 'Copied!' : 'Copy text'}</button></> : <button className="primary-button full" onClick={saveResult}><Icon name="download" size={18} /> Save file</button>}</div>}
      <div className="privacy-note"><span>✓</span><p><strong>Camera only.</strong> Frames are assembled in this browser and are never sent over a network.</p></div>
    </section>
  )
}
