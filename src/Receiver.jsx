import { useEffect, useRef, useState } from 'react'
import { BrowserQRCodeReader } from '@zxing/browser'
import { formatBytes, parseFrame, rebuildTransfer } from './protocol.js'

const decoder = new TextDecoder()

export default function Receiver() {
  const videoRef = useRef(null)
  const controlsRef = useRef(null)
  const framesRef = useRef(new Map())
  const activeIdRef = useRef(null)
  const rebuildingRef = useRef(false)

  const [scanning, setScanning] = useState(false)
  const [status, setStatus] = useState('Ready to scan')
  const [progress, setProgress] = useState({ received: 0, total: 0 })
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [cameraFacing, setCameraFacing] = useState('environment')

  useEffect(() => () => stopScanner(), [])

  function stopScanner() {
    try {
      controlsRef.current?.stop()
    } catch {}
    controlsRef.current = null
    setScanning(false)
  }

  function resetTransfer() {
    framesRef.current = new Map()
    activeIdRef.current = null
    rebuildingRef.current = false
    setProgress({ received: 0, total: 0 })
    setResult(null)
    setError('')
    setStatus('Ready to scan')
  }

  async function startScanner(nextFacing = cameraFacing) {
    stopScanner()
    resetTransfer()
    setError('')
    setStatus('Starting camera…')

    if (!window.isSecureContext) {
      setError('Camera access requires HTTPS or localhost. Install the PWA first if you need to use it fully offline on iPhone/iPad.')
      setStatus('Camera unavailable')
      return
    }

    try {
      const reader = new BrowserQRCodeReader(undefined, { delayBetweenScanAttempts: 35 })
      const controls = await reader.decodeFromConstraints(
        {
          audio: false,
          video: {
            facingMode: { ideal: nextFacing },
            width: { ideal: 1280 },
            height: { ideal: 720 }
          }
        },
        videoRef.current,
        async (scanResult) => {
          if (!scanResult || rebuildingRef.current) return
          const frame = parseFrame(scanResult.getText())
          if (!frame) {
            setStatus('QR detected, but it is not a QR Transfer frame')
            return
          }

          if (activeIdRef.current && frame.id !== activeIdRef.current) {
            setStatus('Different transfer detected — keep scanning the original sender')
            return
          }

          if (!activeIdRef.current) activeIdRef.current = frame.id

          const key = frame.i
          if (!framesRef.current.has(key)) {
            framesRef.current.set(key, frame)
            const received = framesRef.current.size
            setProgress({ received, total: frame.n })
            setStatus(`Receiving… ${received} of ${frame.n}`)

            if (received === frame.n) {
              rebuildingRef.current = true
              setStatus('Rebuilding data…')
              try {
                const rebuilt = await rebuildTransfer(framesRef.current)
                setResult(rebuilt)
                setStatus('Transfer complete')
                stopScanner()
              } catch (e) {
                setError(e?.message || 'Could not rebuild transfer.')
                setStatus('Transfer failed')
                rebuildingRef.current = false
              }
            }
          }
        }
      )
      controlsRef.current = controls
      setScanning(true)
      setStatus('Point camera at the sender QR code')
    } catch (e) {
      const message = e?.name === 'NotAllowedError'
        ? 'Camera permission was denied. Allow camera access in your browser settings.'
        : (e?.message || 'Could not start the camera.')
      setError(message)
      setStatus('Camera unavailable')
      setScanning(false)
    }
  }

  async function flipCamera() {
    const next = cameraFacing === 'environment' ? 'user' : 'environment'
    setCameraFacing(next)
    await startScanner(next)
  }

  function saveResult() {
    if (!result) return
    const blob = new Blob([result.bytes], { type: result.mime || 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = result.name || 'received-file'
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  async function copyText() {
    if (!result) return
    const text = decoder.decode(result.bytes)
    await navigator.clipboard.writeText(text)
    setStatus('Text copied')
  }

  const percentage = progress.total ? Math.round((progress.received / progress.total) * 100) : 0
  const textResult = result?.kind === 'text' ? decoder.decode(result.bytes) : ''

  return (
    <section className="panel receiver-panel">
      <div className="panel-heading">
        <div>
          <div className="eyebrow">RECEIVER</div>
          <h2>Scan the sender screen</h2>
        </div>
        {(progress.received > 0 || result) && (
          <button className="ghost-button" onClick={() => { stopScanner(); resetTransfer() }}>Reset</button>
        )}
      </div>

      {!result && (
        <div className="camera-shell">
          <video ref={videoRef} className="camera-view" muted playsInline />
          <div className="scan-frame"><span /><span /><span /><span /></div>
          {!scanning && <div className="camera-placeholder">Camera preview</div>}
        </div>
      )}

      {!result && (
        <div className="control-row">
          <button className="primary-button" onClick={() => scanning ? stopScanner() : startScanner()}>
            {scanning ? 'Stop camera' : 'Start scanning'}
          </button>
          {scanning && <button className="secondary-button" onClick={flipCamera}>Flip camera</button>}
        </div>
      )}

      <div className="status-card">
        <div className="status-line">
          <strong>{status}</strong>
          {progress.total > 0 && <span>{percentage}%</span>}
        </div>
        {progress.total > 0 && (
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${percentage}%` }} />
          </div>
        )}
        {progress.total > 0 && <small>{progress.received} unique frames received of {progress.total}</small>}
      </div>

      {error && <div className="error-box">{error}</div>}

      {result && (
        <div className="result-card">
          <div className="success-badge">✓ Transfer complete</div>
          <h3>{result.kind === 'text' ? 'Received text' : result.name || 'Received file'}</h3>
          <p>{formatBytes(result.bytes.length)} · verified with SHA-256</p>

          {result.kind === 'text' ? (
            <>
              <textarea className="text-input result-text" readOnly value={textResult} rows={9} />
              <button className="primary-button full" onClick={copyText}>Copy text</button>
            </>
          ) : (
            <button className="primary-button full" onClick={saveResult}>Save file</button>
          )}
        </div>
      )}

      <p className="hint">The receiver needs only camera access. No network request is used for the transfer itself.</p>
    </section>
  )
}
