import { useEffect, useRef, useState } from 'react'
import { BrowserQRCodeReader } from '@zxing/browser'
import { analyzeTransferFrames, formatBytes, frameKey, parseFrame, rebuildTransfer } from './protocol.js'

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
    image: <><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></>,
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
  const videoTrackRef = useRef(null)
  const zoomCapabilityRef = useRef(null)
  const lastZoomAtRef = useRef(0)
  const qualitySamplesRef = useRef([])
  const cameraBaseScoreRef = useRef(0)
  const importSessionRef = useRef(0)
  const nativeScanFrameRef = useRef(0)
  const nativeScanBusyRef = useRef(false)
  const nativeLastScanAtRef = useRef(0)
  const [scanning, setScanning] = useState(false)
  const [status, setStatus] = useState('Ready when you are')
  const [progress, setProgress] = useState({ received: 0, total: 0, direct: 0, recovery: 0, recoveredIndices: [] })
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [cameraFacing, setCameraFacing] = useState('environment')
  const [copied, setCopied] = useState(false)
  const [tracking, setTracking] = useState(null)
  const [torchAvailable, setTorchAvailable] = useState(false)
  const [torchOn, setTorchOn] = useState(false)
  const [scanRate, setScanRate] = useState(0)
  const [autoZoom, setAutoZoom] = useState(0)
  const [cameraQuality, setCameraQuality] = useState(null)
  const [importing, setImporting] = useState(false)
  const [importSummary, setImportSummary] = useState('')
  const [receiveMode, setReceiveMode] = useState('camera')
  const [importDragging, setImportDragging] = useState(false)
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0 })
  const [nativeFastScan, setNativeFastScan] = useState(false)

  useEffect(() => () => {
    scanSessionRef.current += 1
    try { controlsRef.current?.stop() } catch {}
    clearTimeout(copyTimerRef.current)
    clearTimeout(trackingTimerRef.current)
    cancelAnimationFrame(nativeScanFrameRef.current)
    importSessionRef.current += 1
  }, [])

  useEffect(() => {
    if (!active) stopScanner()
  }, [active])

  function stopScanner() { scanSessionRef.current += 1; try { controlsRef.current?.stop() } catch {} controlsRef.current = null; cancelAnimationFrame(nativeScanFrameRef.current); nativeScanFrameRef.current = 0; nativeScanBusyRef.current = false; nativeLastScanAtRef.current = 0; clearTimeout(trackingTimerRef.current); trackingHistoryRef.current = null; videoTrackRef.current = null; zoomCapabilityRef.current = null; lastZoomAtRef.current = 0; setTracking(null); setTorchAvailable(false); setTorchOn(false); setAutoZoom(0); setNativeFastScan(false); setScanning(false) }
  function resetTransfer() { importSessionRef.current += 1; framesRef.current = new Map(); activeIdRef.current = null; rebuildingRef.current = false; firstFrameAtRef.current = 0; trackingHistoryRef.current = null; qualitySamplesRef.current = []; setProgress({ received: 0, total: 0, direct: 0, recovery: 0, recoveredIndices: [] }); setResult(null); setError(''); setStatus('Ready when you are'); setCopied(false); setTracking(null); setScanRate(0); setAutoZoom(0); setCameraQuality(null); setImportSummary(''); setImporting(false); setImportProgress({ current: 0, total: 0 }) }

  function updateCalibration(confidence) {
    const samples = [...qualitySamplesRef.current, confidence].slice(-12)
    qualitySamplesRef.current = samples
    const average = samples.reduce((sum, value) => sum + value, 0) / samples.length
    const score = Math.round(cameraBaseScoreRef.current * .42 + average * .58)
    const recommendation = score >= 91 ? 'Turbo' : score >= 82 ? 'Fast' : score >= 68 ? 'Smart fast' : score >= 52 ? 'Easy' : 'Slow'
    const label = samples.length < 3 ? 'Calibrating' : score >= 84 ? 'Excellent' : score >= 70 ? 'Good' : score >= 54 ? 'Fair' : 'Low light / unstable'
    setCameraQuality({ score, recommendation, label, ready: samples.length >= 3 })
  }

  function zoomToQr(points, video) {
    const track = videoTrackRef.current
    const capability = zoomCapabilityRef.current
    const now = performance.now()
    if (!track || !capability || now - lastZoomAtRef.current < 850) return

    const xs = points.map(({ x }) => x)
    const ys = points.map(({ y }) => y)
    const qrWidth = Math.max(...xs) - Math.min(...xs)
    const qrHeight = Math.max(...ys) - Math.min(...ys)
    const coverage = Math.max(qrWidth / video.videoWidth, qrHeight / video.videoHeight)
    if (!Number.isFinite(coverage) || coverage <= 0 || coverage >= .44) return

    const current = Number(track.getSettings?.().zoom) || capability.min || 1
    const step = Math.max(Number(capability.step) || .1, .08)
    const desired = Math.min(capability.max, current * Math.min(1.55, .44 / coverage))
    const target = Math.min(capability.max, Math.round(desired / step) * step)
    if (!Number.isFinite(target) || target < current + step) return

    lastZoomAtRef.current = now
    track.applyConstraints({ advanced: [{ zoom: target }] })
      .then(() => { if (videoTrackRef.current === track) setAutoZoom(target) })
      .catch(() => { if (videoTrackRef.current === track) { zoomCapabilityRef.current = null; setAutoZoom(0) } })
  }

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
    if (valid) zoomToQr([topLeft, topRight, bottomRight, bottomLeft], video)
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
    if (valid) updateCalibration(confidence)
    setTracking({ points: smoothed.map(({ x, y }) => `${x},${y}`).join(' '), width, height, valid, confidence, label })
    clearTimeout(trackingTimerRef.current)
    trackingTimerRef.current = setTimeout(() => { trackingHistoryRef.current = null; setTracking(null) }, 680)
  }

  async function processDecodedResult(scanResult, showTracking = false) {
    if (!scanResult || rebuildingRef.current) return 'ignored'
    const frame = parseFrame(scanResult.getText())
    const matchesTransfer = Boolean(frame && (!activeIdRef.current || frame.id === activeIdRef.current))
    if (showTracking) trackResult(scanResult, matchesTransfer)
    if (!frame) { setStatus('QR found, but it is not a BeamQR transfer'); return 'invalid' }
    if (!matchesTransfer) { setStatus('Different transfer found — keep scanning the original'); return 'different' }
    if (!activeIdRef.current) activeIdRef.current = frame.id

    const key = frameKey(frame)
    if (framesRef.current.has(key)) return 'duplicate'
    framesRef.current.set(key, frame)
    const transferStatus = analyzeTransferFrames(framesRef.current)
    const now = performance.now()
    if (!firstFrameAtRef.current) firstFrameAtRef.current = now
    if (transferStatus.direct > 1) setScanRate((transferStatus.direct - 1) / Math.max(.25, (now - firstFrameAtRef.current) / 1000))
    if (showTracking) navigator.vibrate?.(transferStatus.complete ? [35, 45, 70] : 16)
    setProgress(transferStatus)
    setStatus(transferStatus.recovery > 0 ? `Receiving frames… ${transferStatus.recovery} recovered` : 'Receiving frames…')

    if (transferStatus.complete) {
      rebuildingRef.current = true
      setStatus(transferStatus.recovery > 0 ? 'Recovering and verifying…' : 'Verifying transfer…')
      try {
        const rebuilt = await rebuildTransfer(framesRef.current)
        setResult(rebuilt); setStatus('Transfer complete'); stopScanner()
        return 'complete'
      } catch (error) {
        setError(error?.message || 'Could not rebuild transfer.'); setStatus('Transfer failed'); rebuildingRef.current = false
        return 'failed'
      }
    }
    return frame.ft === 'p' ? 'recovery' : 'added'
  }

  async function createNativeDetector(session) {
    if (!window.BarcodeDetector) return null
    try {
      const supported = await window.BarcodeDetector.getSupportedFormats()
      if (session !== scanSessionRef.current || !supported.includes('qr_code')) return null
      return new window.BarcodeDetector({ formats: ['qr_code'] })
    } catch { return null }
  }

  function startNativeDetection(session, detector) {
    setNativeFastScan(true)
    const schedule = (scan) => {
      if (session === scanSessionRef.current) nativeScanFrameRef.current = requestAnimationFrame(scan)
    }
    const scan = async (timestamp) => {
      const video = videoRef.current
      if (session !== scanSessionRef.current) return
      if (nativeScanBusyRef.current || timestamp - nativeLastScanAtRef.current < 85 || !video || video.readyState < 2) { schedule(scan); return }
      nativeScanBusyRef.current = true
      nativeLastScanAtRef.current = timestamp
      try {
        const detected = await detector.detect(video)
        for (const barcode of detected) {
          if (!barcode.rawValue) continue
          const corners = barcode.cornerPoints?.length >= 4 ? barcode.cornerPoints : [
            { x: barcode.boundingBox.left, y: barcode.boundingBox.top },
            { x: barcode.boundingBox.right, y: barcode.boundingBox.top },
            { x: barcode.boundingBox.right, y: barcode.boundingBox.bottom },
            { x: barcode.boundingBox.left, y: barcode.boundingBox.bottom },
          ]
          const adaptedResult = { getText: () => barcode.rawValue, getResultPoints: () => [corners[3], corners[0], corners[1]] }
          await processDecodedResult(adaptedResult, true)
        }
      } catch {}
      finally { nativeScanBusyRef.current = false; schedule(scan) }
    }
    schedule(scan)
  }

  async function startScanner(nextFacing = cameraFacing, preserveProgress = false) {
    stopScanner()
    const session = scanSessionRef.current
    if (!preserveProgress) resetTransfer()
    setError(''); setStatus('Starting camera…')
    if (!window.isSecureContext) { setError('Camera access requires HTTPS or localhost. Install the PWA first for fully offline use on iPhone or iPad.'); setStatus('Camera unavailable'); return }
    if (!navigator.mediaDevices?.getUserMedia) { setError('Camera scanning is not supported by this browser.'); setStatus('Camera unavailable'); return }
    let controls = null
    try {
      const constraints = { audio: false, video: { facingMode: { ideal: nextFacing }, width: { ideal: 960, max: 1280 }, height: { ideal: 540, max: 720 }, frameRate: { ideal: 30, max: 30 } } }
      const nativeDetector = await createNativeDetector(session)
      if (session !== scanSessionRef.current) return
      if (nativeDetector) {
        const stream = await navigator.mediaDevices.getUserMedia(constraints)
        const video = videoRef.current
        controls = {
          stop() {
            stream.getTracks().forEach((track) => track.stop())
            if (video?.srcObject === stream) video.srcObject = null
          },
        }
        if (!video) throw new Error('Camera preview is unavailable.')
        video.srcObject = stream
        await video.play()
      } else {
        const reader = new BrowserQRCodeReader(undefined, { delayBetweenScanAttempts: 35 })
        controls = await reader.decodeFromConstraints(constraints, videoRef.current, async (scanResult) => {
          if (session !== scanSessionRef.current || !scanResult || rebuildingRef.current) return
          await processDecodedResult(scanResult, true)
        })
      }
      if (session !== scanSessionRef.current) { controls.stop(); return }
      controlsRef.current = controls
      const videoTrack = videoRef.current?.srcObject?.getVideoTracks?.()[0]
      videoTrackRef.current = videoTrack || null
      let supportsTorch = false
      try {
        const capabilities = videoTrack?.getCapabilities?.() || {}
        const settings = videoTrack?.getSettings?.() || {}
        const pixels = (settings.width || 0) * (settings.height || 0)
        const resolutionScore = pixels >= 1920 * 1080 ? 95 : pixels >= 1280 * 720 ? 82 : pixels >= 640 * 480 ? 62 : 42
        const frameRateScore = settings.frameRate >= 28 ? 92 : settings.frameRate >= 20 ? 72 : 50
        cameraBaseScoreRef.current = Math.round(resolutionScore * .62 + frameRateScore * .38)
        setCameraQuality({ score: cameraBaseScoreRef.current, recommendation: 'Easy', label: 'Point at QR to calibrate', ready: false })
        supportsTorch = Boolean(capabilities.torch)
        zoomCapabilityRef.current = Number.isFinite(capabilities.zoom?.max) && capabilities.zoom.max > capabilities.zoom.min ? capabilities.zoom : null
        const cameraTuning = {}
        if (capabilities.focusMode?.includes?.('continuous')) cameraTuning.focusMode = 'continuous'
        if (capabilities.exposureMode?.includes?.('continuous')) cameraTuning.exposureMode = 'continuous'
        if (capabilities.whiteBalanceMode?.includes?.('continuous')) cameraTuning.whiteBalanceMode = 'continuous'
        if (Object.keys(cameraTuning).length) videoTrack.applyConstraints({ advanced: [cameraTuning] }).catch(() => {})
      } catch {}
      setTorchAvailable(supportsTorch)
      setScanning(true); setStatus(framesRef.current.size ? 'Receiving frames…' : 'Looking for BeamQR codes…')
      if (nativeDetector) startNativeDetection(session, nativeDetector)
    } catch (e) {
      try { controls?.stop() } catch {}
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
  function selectReceiveMode(nextMode) {
    if (importing) return
    if (nextMode === 'images') stopScanner()
    setReceiveMode(nextMode)
    setError('')
  }
  async function importFiles(fileList) {
    if (importing) return
    const selected = [...(fileList || [])]
    if (!selected.length) return
    if (selected.length > 250) { setError('Import up to 250 QR screenshots at a time.'); return }

    stopScanner()
    if (!framesRef.current.size) resetTransfer()
    const importSession = ++importSessionRef.current
    setImporting(true); setImportProgress({ current: 0, total: selected.length }); setError(''); setImportSummary('Reading QR images…')
    const reader = new BrowserQRCodeReader()
    const counts = { added: 0, recovery: 0, duplicate: 0, invalid: 0, different: 0 }
    let completed = false

    for (let fileIndex = 0; fileIndex < selected.length; fileIndex += 1) {
      if (importSession !== importSessionRef.current) break
      const file = selected[fileIndex]
      setImportProgress({ current: fileIndex + 1, total: selected.length })
      if (!file.type.startsWith('image/')) { counts.invalid += 1; continue }
      const url = URL.createObjectURL(file)
      try {
        const decoded = await reader.decodeFromImageUrl(url)
        if (importSession !== importSessionRef.current) break
        const outcome = await processDecodedResult(decoded, false)
        if (outcome in counts) counts[outcome] += 1
        if (outcome === 'complete') { completed = true; break }
      } catch { counts.invalid += 1 }
      finally { URL.revokeObjectURL(url) }
    }

    if (importSession !== importSessionRef.current) return
    const accepted = counts.added + counts.recovery
    setImportSummary(`${accepted} new · ${counts.duplicate} duplicate · ${counts.invalid + counts.different} skipped`)
    if (!completed) setStatus(accepted ? 'Screenshots imported — add more or continue scanning' : 'No new BeamQR frames found')
    setImporting(false); setImportProgress({ current: 0, total: 0 })
  }
  function importScreenshots(event) {
    const files = [...(event.target.files || [])]
    event.target.value = ''
    importFiles(files)
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
  const recoveredFrames = new Set(progress.recoveredIndices || [])
  const frameMap = Array.from({ length: mapSize }, (_, index) => {
    const start = Math.floor(index * progress.total / mapSize)
    const end = Math.max(start + 1, Math.floor((index + 1) * progress.total / mapSize))
    let state = 'captured'
    for (let frame = start; frame < end; frame += 1) {
      if (framesRef.current.has(`d:${frame}`)) continue
      if (recoveredFrames.has(frame)) state = 'recovered'
      else return ''
    }
    return state
  })

  return (
    <section className="panel receiver-panel">
      <div className="panel-heading"><div><div className="step-label">RECEIVE MODE</div><h2>{result ? 'Your transfer is ready' : 'Scan or import QR frames'}</h2><p>{result ? 'Integrity checked. The content is safe to open.' : 'Use the camera live, or import one or more QR screenshots.'}</p></div>{(progress.received > 0 || result) && <button className="ghost-button compact" onClick={() => { stopScanner(); resetTransfer() }}><Icon name="reset" size={17} /> Reset</button>}</div>

      {!result && <div className="receive-methods" role="tablist" aria-label="Receive method"><button className={receiveMode === 'camera' ? 'active' : ''} onClick={() => selectReceiveMode('camera')} role="tab" aria-selected={receiveMode === 'camera'} disabled={importing}><span><Icon name="camera" size={20} /></span><div><strong>Live camera</strong><small>Fastest for animated QR</small></div></button><button className={receiveMode === 'images' ? 'active' : ''} onClick={() => selectReceiveMode('images')} role="tab" aria-selected={receiveMode === 'images'} disabled={importing}><span><Icon name="image" size={20} /></span><div><strong>QR screenshots</strong><small>Import one or many images</small></div></button></div>}

      {!result && (
        <div hidden={receiveMode !== 'camera'} className={`camera-shell ${scanning ? 'is-scanning' : ''} ${tracking?.valid ? 'has-lock' : ''}`}>
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
          {autoZoom > 0 && <div className="auto-zoom-badge">AUTO ZOOM <strong>{autoZoom.toFixed(1)}×</strong></div>}
          {!scanning && <div className="camera-placeholder"><span className="camera-icon"><Icon name="camera" size={30} /></span><strong>Camera preview</strong><small>Your browser will ask for permission</small></div>}
        </div>
      )}

      {!result && receiveMode === 'images' && <label className={`screenshot-zone ${importDragging ? 'dragging' : ''} ${importing ? 'is-loading' : ''}`} onDragEnter={(event) => { event.preventDefault(); setImportDragging(true) }} onDragOver={(event) => event.preventDefault()} onDragLeave={() => setImportDragging(false)} onDrop={(event) => { event.preventDefault(); setImportDragging(false); importFiles(event.dataTransfer.files) }}><input type="file" accept="image/*" multiple disabled={importing} onChange={importScreenshots} /><span className="screenshot-icon"><Icon name="image" size={27} /></span><strong>{importing ? `Reading image ${importProgress.current} of ${importProgress.total}` : 'Drop QR screenshots here'}</strong><small>{importing ? 'Detecting and deduplicating QR frames…' : 'Select multiple images together · order does not matter'}</small>{!importing && <em>Choose images</em>}</label>}

      {!result && receiveMode === 'camera' && <div className="control-row receiver-controls"><button className="primary-button" onClick={() => scanning ? stopScanner() : startScanner()}><Icon name={scanning ? 'stop' : 'camera'} size={18} /> {scanning ? 'Stop camera' : 'Start scanning'}</button>{scanning && <button className="secondary-button" onClick={flipCamera}><Icon name="flip" size={18} /> Flip camera</button>}{scanning && torchAvailable && <button className={`secondary-button ${torchOn ? 'is-active' : ''}`} onClick={toggleTorch} aria-pressed={torchOn}><Icon name="flash" size={18} /> {torchOn ? 'Torch on' : 'Torch'}</button>}</div>}

      {!result && cameraQuality && scanning && <div className="calibration-card"><div><span>CAMERA QUALITY</span><strong>{cameraQuality.label}</strong>{nativeFastScan && <em className="native-fast">⚡ Native fast scan</em>}</div><div className="quality-meter"><i style={{ width: `${cameraQuality.score}%` }} /></div><div><small>{cameraQuality.score}% signal score</small><small>Recommended sender speed: <strong>{cameraQuality.recommendation}</strong></small></div></div>}
      {!result && importSummary && <div className="import-summary"><Icon name="image" size={16} /> {importSummary}</div>}

      {!result && <div className="status-card" aria-live="polite"><div className="status-line"><div><span className={`status-indicator ${scanning || importing ? 'active' : ''}`} /><strong>{status}</strong></div>{progress.total > 0 && <span>{percentage}%</span>}</div>{progress.total > 0 && <><div className="progress-track"><div className="progress-fill" style={{ width: `${percentage}%` }} /></div><div className="frame-map" aria-label={`${progress.received} of ${progress.total} frames available`}>{frameMap.map((frameState, index) => <span className={frameState} key={index} />)}</div><div className="receive-metrics"><small>{progress.direct} scanned{progress.recovery > 0 ? ` + ${progress.recovery} recovered` : ''} · {progress.total - progress.received} missing</small>{scanRate > 0 && <small>{scanRate.toFixed(1)} frames/s · ~{remainingSeconds}s left</small>}</div></>}</div>}
      {error && <div className="error-box" role="alert">{error}</div>}

      {result && <div className="result-card"><div className="success-orbit"><Icon name="shield" size={32} /></div><div className="success-badge">✓ SHA-256 verified</div><h3>{result.kind === 'text' ? 'Received text' : (result.name || 'Received file')}</h3><p>{formatBytes(result.bytes.length)} · received entirely offline</p>{result.kind === 'text' ? <><textarea ref={resultTextRef} className="text-input result-text" readOnly value={textResult} rows={8} /><button className="primary-button full" onClick={copyText}><Icon name="copy" size={18} /> {copied ? 'Copied!' : 'Copy text'}</button></> : <button className="primary-button full" onClick={saveResult}><Icon name="download" size={18} /> Save file</button>}</div>}
      <div className="privacy-note"><span>✓</span><p><strong>Camera only.</strong> Frames are assembled in this browser and are never sent over a network.</p></div>
    </section>
  )
}
