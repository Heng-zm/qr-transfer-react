import { useEffect, useRef, useState } from 'react'
import { BrowserQRCodeReader } from '@zxing/browser'
import { analyzeTransferFrames, formatBytes, frameKey, parseFrame, rebuildTransfer } from './protocol.js'

const decoder = new TextDecoder()

function Icon({ name, size = 20 }) {
  const paths = {
    camera: <><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3Z"/><circle cx="12" cy="13" r="3"/></>,
    stop: <rect x="6" y="6" width="12" height="12" rx="1"/>,
    pause: <><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></>,
    flip: <><path d="m17 1 4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></>,
    copy: <><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></>,
    download: <><path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/></>,
    reset: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></>,
    shield: <><path d="M20 13c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V5l8-3 8 3Z"/><path d="m9 12 2 2 4-4"/></>,
    flash: <path d="m13 2-9 12h8l-1 8 9-12h-8Z"/>,
    image: <><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></>,
    expand: <><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/></>,
    collapse: <><path d="M8 3v5H3M16 3v5h5M8 21v-5H3M16 21v-5h5"/></>,
  }
  return <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

export default function Receiver({ active = true }) {
  const videoRef = useRef(null)
  const cameraShellRef = useRef(null)
  const assistCanvasRef = useRef(null)
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
  const scanRateStartCountRef = useRef(0)
  const videoTrackRef = useRef(null)
  const zoomCapabilityRef = useRef(null)
  const lastZoomAtRef = useRef(0)
  const qualitySamplesRef = useRef([])
  const cameraBaseScoreRef = useRef(0)
  const importSessionRef = useRef(0)
  const nativeScanCancelRef = useRef(null)
  const nativeScanBusyRef = useRef(false)
  const nativeLastScanAtRef = useRef(0)
  const nativeMissStreakRef = useRef(0)
  const smartScanCycleRef = useRef(0)
  const smartCropAvailableRef = useRef(true)
  const [scanning, setScanning] = useState(false)
  const [status, setStatus] = useState('Ready to scan')
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
  const [fullScreen, setFullScreen] = useState(false)

  useEffect(() => () => {
    scanSessionRef.current += 1
    try { controlsRef.current?.stop() } catch {}
    clearTimeout(copyTimerRef.current)
    clearTimeout(trackingTimerRef.current)
    cancelNativeScanLoop()
    importSessionRef.current += 1
  }, [])

  useEffect(() => {
    if (!active) { exitCameraFullscreen(); pauseScanner() }
  }, [active])

  useEffect(() => {
    const syncFullscreen = () => {
      setFullScreen(getFullscreenElement() === cameraShellRef.current)
      trackingHistoryRef.current = null
      setTracking(null)
    }
    document.addEventListener('fullscreenchange', syncFullscreen)
    document.addEventListener('webkitfullscreenchange', syncFullscreen)
    return () => {
      document.removeEventListener('fullscreenchange', syncFullscreen)
      document.removeEventListener('webkitfullscreenchange', syncFullscreen)
    }
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('camera-fullscreen-open', fullScreen)
    return () => document.documentElement.classList.remove('camera-fullscreen-open')
  }, [fullScreen])

  useEffect(() => {
    const resetTrackerViewport = () => { trackingHistoryRef.current = null; setTracking(null) }
    window.addEventListener('resize', resetTrackerViewport)
    window.addEventListener('orientationchange', resetTrackerViewport)
    return () => {
      window.removeEventListener('resize', resetTrackerViewport)
      window.removeEventListener('orientationchange', resetTrackerViewport)
    }
  }, [])

  function getFullscreenElement() { return document.fullscreenElement || document.webkitFullscreenElement || null }
  async function exitCameraFullscreen() {
    const shell = cameraShellRef.current
    const exitFullscreen = document.exitFullscreen || document.webkitExitFullscreen
    try { if (shell && getFullscreenElement() === shell && exitFullscreen) await exitFullscreen.call(document) } catch {}
    setFullScreen(false)
  }

  function cancelNativeScanLoop() { try { nativeScanCancelRef.current?.() } catch {} nativeScanCancelRef.current = null }
  function stopScanner() { scanSessionRef.current += 1; try { controlsRef.current?.stop() } catch {} controlsRef.current = null; cancelNativeScanLoop(); nativeScanBusyRef.current = false; nativeLastScanAtRef.current = 0; nativeMissStreakRef.current = 0; smartScanCycleRef.current = 0; smartCropAvailableRef.current = true; clearTimeout(trackingTimerRef.current); trackingHistoryRef.current = null; videoTrackRef.current = null; zoomCapabilityRef.current = null; lastZoomAtRef.current = 0; setTracking(null); setTorchAvailable(false); setTorchOn(false); setAutoZoom(0); setNativeFastScan(false); setScanning(false) }
  function resetTransfer() { exitCameraFullscreen(); importSessionRef.current += 1; framesRef.current = new Map(); activeIdRef.current = null; rebuildingRef.current = false; firstFrameAtRef.current = 0; scanRateStartCountRef.current = 0; trackingHistoryRef.current = null; qualitySamplesRef.current = []; setProgress({ received: 0, total: 0, direct: 0, recovery: 0, recoveredIndices: [] }); setResult(null); setError(''); setStatus('Ready to scan'); setCopied(false); setTracking(null); setScanRate(0); setAutoZoom(0); setCameraQuality(null); setImportSummary(''); setImporting(false); setImportProgress({ current: 0, total: 0 }) }

  function pauseScanner() {
    const hasFrames = framesRef.current.size > 0
    stopScanner()
    firstFrameAtRef.current = 0
    scanRateStartCountRef.current = 0
    setScanRate(0)
    setStatus(hasFrames ? 'Paused · progress saved' : 'Ready to scan')
  }

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
    if (!Number.isFinite(coverage) || coverage <= 0) return

    const current = Number(track.getSettings?.().zoom) || capability.min || 1
    const step = Math.max(Number(capability.step) || .1, .08)
    let desired = current
    if (coverage < .34) desired = current * Math.min(1.5, .42 / coverage)
    else if (coverage > .62 && current > capability.min) desired = current * Math.max(.65, .44 / coverage)
    else return
    desired = Math.max(capability.min, Math.min(capability.max, desired))
    const target = Math.max(capability.min, Math.min(capability.max, capability.min + Math.round((desired - capability.min) / step) * step))
    if (!Number.isFinite(target) || Math.abs(target - current) < step * .75) return

    lastZoomAtRef.current = now
    track.applyConstraints({ advanced: [{ zoom: target }] })
      .then(() => { if (videoTrackRef.current === track) setAutoZoom(target > capability.min + step * .5 ? target : 0) })
      .catch(() => { if (videoTrackRef.current === track) { zoomCapabilityRef.current = null; setAutoZoom(0) } })
  }

  function relaxCameraZoom() {
    const track = videoTrackRef.current
    const capability = zoomCapabilityRef.current
    const now = performance.now()
    if (!track || !capability || now - lastZoomAtRef.current < 900) return
    const current = Number(track.getSettings?.().zoom) || capability.min || 1
    const step = Math.max(Number(capability.step) || .1, .08)
    if (current <= capability.min + step * .5) return
    lastZoomAtRef.current = now
    track.applyConstraints({ advanced: [{ zoom: capability.min }] })
      .then(() => { if (videoTrackRef.current === track) setAutoZoom(0) })
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
    if (!frame) { setStatus('Not a BeamQR code'); return 'invalid' }
    if (!matchesTransfer) { setStatus('Different transfer — keep scanning'); return 'different' }
    if (!activeIdRef.current) activeIdRef.current = frame.id

    const key = frameKey(frame)
    if (framesRef.current.has(key)) return 'duplicate'
    framesRef.current.set(key, frame)
    const transferStatus = analyzeTransferFrames(framesRef.current)
    const now = performance.now()
    if (!firstFrameAtRef.current) { firstFrameAtRef.current = now; scanRateStartCountRef.current = transferStatus.direct }
    const framesSinceRateStart = transferStatus.direct - scanRateStartCountRef.current
    if (framesSinceRateStart > 0) setScanRate(framesSinceRateStart / Math.max(.25, (now - firstFrameAtRef.current) / 1000))
    if (showTracking) navigator.vibrate?.(transferStatus.complete ? [35, 45, 70] : 16)
    setProgress(transferStatus)
    setStatus(transferStatus.recovery > 0 ? `Receiving · ${transferStatus.recovery} recovered` : 'Receiving…')

    if (transferStatus.complete) {
      rebuildingRef.current = true
      setStatus(transferStatus.recovery > 0 ? 'Recovering and verifying…' : 'Verifying…')
      try {
        const rebuilt = await rebuildTransfer(framesRef.current)
        exitCameraFullscreen(); setResult(rebuilt); setStatus('Transfer complete'); stopScanner()
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

  function createSmartScanSource(video) {
    if (!video.videoWidth || !video.videoHeight) return null
    const cropSize = Math.round(Math.min(video.videoWidth, video.videoHeight) * .78)
    const sourceX = Math.round((video.videoWidth - cropSize) / 2)
    const sourceY = Math.round((video.videoHeight - cropSize) / 2)
    const canvas = assistCanvasRef.current || document.createElement('canvas')
    assistCanvasRef.current = canvas
    if (canvas.width !== 640) canvas.width = 640
    if (canvas.height !== 640) canvas.height = 640
    const context = canvas.getContext('2d', { alpha: false, desynchronized: true })
    if (!context) return null
    context.drawImage(video, sourceX, sourceY, cropSize, cropSize, 0, 0, 640, 640)
    return {
      source: canvas,
      mapPoint: ({ x, y }) => ({ x: sourceX + x * cropSize / 640, y: sourceY + y * cropSize / 640 }),
    }
  }

  function startNativeDetection(session, detector) {
    setNativeFastScan(true)
    const schedule = (scan) => {
      if (session !== scanSessionRef.current) return
      const video = videoRef.current
      if (video?.requestVideoFrameCallback) {
        const callbackId = video.requestVideoFrameCallback((timestamp) => scan(timestamp))
        nativeScanCancelRef.current = () => video.cancelVideoFrameCallback(callbackId)
      } else {
        const frameId = requestAnimationFrame(scan)
        nativeScanCancelRef.current = () => cancelAnimationFrame(frameId)
      }
    }
    const scan = async (timestamp) => {
      const video = videoRef.current
      if (session !== scanSessionRef.current) return
      const scanInterval = trackingHistoryRef.current?.valid ? 52 : 92
      if (nativeScanBusyRef.current || timestamp - nativeLastScanAtRef.current < scanInterval || !video || video.readyState < 2) { schedule(scan); return }
      nativeScanBusyRef.current = true
      nativeLastScanAtRef.current = timestamp
      try {
        smartScanCycleRef.current += 1
        const useFocusedPass = smartCropAvailableRef.current && smartScanCycleRef.current % 3 === 0 && !trackingHistoryRef.current
        let smartSource = useFocusedPass ? createSmartScanSource(video) : null
        let detected
        try { detected = await detector.detect(smartSource?.source || video) }
        catch (error) {
          if (!smartSource) throw error
          smartCropAvailableRef.current = false
          smartSource = null
          detected = await detector.detect(video)
        }
        let decodedAny = false
        for (const barcode of detected) {
          if (!barcode.rawValue) continue
          decodedAny = true
          const box = barcode.boundingBox
          const sourceCorners = barcode.cornerPoints?.length >= 4 ? barcode.cornerPoints : box ? [
            { x: box.left, y: box.top },
            { x: box.right, y: box.top },
            { x: box.right, y: box.bottom },
            { x: box.left, y: box.bottom },
          ] : []
          const corners = smartSource ? sourceCorners.map(smartSource.mapPoint) : sourceCorners
          const adaptedResult = { getText: () => barcode.rawValue, getResultPoints: () => corners.length >= 4 ? [corners[3], corners[0], corners[1]] : [] }
          await processDecodedResult(adaptedResult, true)
        }
        nativeMissStreakRef.current = decodedAny ? 0 : nativeMissStreakRef.current + 1
        if (nativeMissStreakRef.current >= 22) { relaxCameraZoom(); nativeMissStreakRef.current = 12 }
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
      try { videoRef.current.contentHint = 'detail' } catch {}
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
      setScanning(true); setStatus(framesRef.current.size ? 'Receiving…' : 'Looking for QR codes…')
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
  async function toggleFullscreen() {
    const shell = cameraShellRef.current
    if (!shell) return
    if (fullScreen || getFullscreenElement() === shell) { await exitCameraFullscreen(); return }
    trackingHistoryRef.current = null
    setTracking(null)
    const requestFullscreen = shell.requestFullscreen || shell.webkitRequestFullscreen
    if (!requestFullscreen) { setFullScreen(true); return }
    try {
      await requestFullscreen.call(shell)
      setFullScreen(true)
    } catch { setFullScreen(true) }
  }
  async function stopFullscreenScanner() {
    await exitCameraFullscreen()
    pauseScanner()
  }
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
    if (!completed) setStatus(accepted ? 'Frames imported · add more or scan' : 'No new BeamQR frames found')
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
  const hasPartialTransfer = progress.total > 0
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
      <div className="panel-heading"><div><div className="step-label">RECEIVE</div><h2>{result ? 'Transfer ready' : 'Scan QR codes'}</h2></div>{(hasPartialTransfer || result) && <button className="ghost-button compact" onClick={() => { stopScanner(); resetTransfer() }}><Icon name="reset" size={17} /> Reset</button>}</div>

      {!result && <div className="receive-methods" role="tablist" aria-label="Receive method"><button className={receiveMode === 'camera' ? 'active' : ''} onClick={() => selectReceiveMode('camera')} role="tab" aria-selected={receiveMode === 'camera'} disabled={importing}><span><Icon name="camera" size={20} /></span><strong>Camera</strong></button><button className={receiveMode === 'images' ? 'active' : ''} onClick={() => selectReceiveMode('images')} role="tab" aria-selected={receiveMode === 'images'} disabled={importing}><span><Icon name="image" size={20} /></span><strong>Screenshots</strong></button></div>}

      {!result && (
        <div ref={cameraShellRef} hidden={receiveMode !== 'camera'} className={`camera-shell ${scanning ? 'is-scanning' : ''} ${tracking?.valid ? 'has-lock' : ''} ${fullScreen ? 'camera-fullscreen' : ''}`}>
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
          {scanning && <><div className="vision-assist-badge"><span>✦</span> SMART VISION</div><button type="button" className="fullscreen-button" onClick={toggleFullscreen} aria-label={fullScreen ? 'Exit fullscreen camera' : 'Open fullscreen camera'}><Icon name={fullScreen ? 'collapse' : 'expand'} size={19} /></button></>}
          {scanning && <div className="fullscreen-hud"><div className="fullscreen-status"><span className={`status-indicator ${scanning ? 'active' : ''}`} /><div><strong>{status}</strong><small>{progress.total > 0 ? `${percentage}% · ${progress.received}/${progress.total} frames` : tracking?.valid ? 'Fast scan active' : 'Searching full frame and center'}</small></div></div><div className="fullscreen-actions"><button type="button" onClick={flipCamera} aria-label="Flip camera"><Icon name="flip" size={18} /></button>{torchAvailable && <button type="button" className={torchOn ? 'is-active' : ''} onClick={toggleTorch} aria-label={torchOn ? 'Turn torch off' : 'Turn torch on'}><Icon name="flash" size={18} /></button>}<button type="button" onClick={toggleFullscreen} aria-label="Exit fullscreen camera"><Icon name="collapse" size={18} /></button><button type="button" className="pause" onClick={stopFullscreenScanner} aria-label="Pause scanning"><Icon name="pause" size={17} /></button></div></div>}
          {!scanning && <div className="camera-placeholder"><span className="camera-icon"><Icon name="camera" size={30} /></span><strong>Camera ready</strong></div>}
        </div>
      )}

      {!result && receiveMode === 'images' && <label className={`screenshot-zone ${importDragging ? 'dragging' : ''} ${importing ? 'is-loading' : ''}`} onDragEnter={(event) => { event.preventDefault(); setImportDragging(true) }} onDragOver={(event) => event.preventDefault()} onDragLeave={() => setImportDragging(false)} onDrop={(event) => { event.preventDefault(); setImportDragging(false); importFiles(event.dataTransfer.files) }}><input type="file" accept="image/*" multiple disabled={importing} onChange={importScreenshots} /><span className="screenshot-icon"><Icon name="image" size={27} /></span><strong>{importing ? `${importProgress.current} / ${importProgress.total}` : 'Drop screenshots'}</strong>{!importing && <em>Choose images</em>}</label>}

      {!result && receiveMode === 'camera' && <div className="control-row receiver-controls"><button className="primary-button" onClick={() => scanning ? pauseScanner() : startScanner(cameraFacing, hasPartialTransfer)}><Icon name={scanning ? 'pause' : 'camera'} size={18} /> {scanning ? 'Pause' : hasPartialTransfer ? 'Resume' : 'Start scanning'}</button>{scanning && <button className="secondary-button" onClick={flipCamera}><Icon name="flip" size={18} /> Flip camera</button>}{scanning && torchAvailable && <button className={`secondary-button ${torchOn ? 'is-active' : ''}`} onClick={toggleTorch} aria-pressed={torchOn}><Icon name="flash" size={18} /> {torchOn ? 'Torch on' : 'Torch'}</button>}</div>}

      {!result && cameraQuality && scanning && <div className="calibration-card"><div><span>CAMERA</span><strong>{cameraQuality.label}</strong>{nativeFastScan && <em className="native-fast">✦ Multi-scale detection</em>}</div><div className="quality-meter"><i style={{ width: `${cameraQuality.score}%` }} /></div><div><small>{cameraQuality.score}% signal</small><small>Sender speed: <strong>{cameraQuality.recommendation}</strong></small></div></div>}
      {!result && importSummary && <div className="import-summary"><Icon name="image" size={16} /> {importSummary}</div>}

      {!result && <div className="status-card" aria-live="polite"><div className="status-line"><div><span className={`status-indicator ${scanning || importing ? 'active' : ''}`} /><strong>{status}</strong></div>{progress.total > 0 && <span>{percentage}%</span>}</div>{progress.total > 0 && <><div className="progress-track"><div className="progress-fill" style={{ width: `${percentage}%` }} /></div><div className="frame-map" aria-label={`${progress.received} of ${progress.total} frames available`}>{frameMap.map((frameState, index) => <span className={frameState} key={index} />)}</div><div className="receive-metrics"><small>{progress.direct} scanned{progress.recovery > 0 ? ` + ${progress.recovery} recovered` : ''} · {progress.total - progress.received} missing</small>{scanRate > 0 && <small>{scanRate.toFixed(1)} frames/s · ~{remainingSeconds}s left</small>}</div></>}</div>}
      {error && <div className="error-box" role="alert">{error}</div>}

      {result && <div className="result-card"><div className="success-orbit"><Icon name="shield" size={32} /></div><div className="success-badge">✓ SHA-256 verified</div><h3>{result.kind === 'text' ? 'Received text' : (result.name || 'Received file')}</h3><p>{formatBytes(result.bytes.length)} · offline</p>{result.kind === 'text' ? <><textarea ref={resultTextRef} className="text-input result-text" readOnly value={textResult} rows={8} /><button className="primary-button full" onClick={copyText}><Icon name="copy" size={18} /> {copied ? 'Copied!' : 'Copy text'}</button></> : <button className="primary-button full" onClick={saveResult}><Icon name="download" size={18} /> Save file</button>}</div>}
    </section>
  )
}
