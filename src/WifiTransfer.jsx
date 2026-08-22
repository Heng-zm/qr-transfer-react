import { useEffect, useRef, useState } from 'react'
import { BrowserQRCodeReader } from '@zxing/browser'
import { Peer } from 'peerjs'
import QRCodeView from './QRCodeView.jsx'
import { formatBytes } from './protocol.js'

const CHUNK_SIZE = 16 * 1024
const HIGH_WATER_MARK = 1024 * 1024
const LOW_WATER_MARK = 256 * 1024
const PAIR_PREFIX = 'BWP1:'

async function checksum(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function createPairSecret() {
  return [...crypto.getRandomValues(new Uint32Array(4))]
    .map((part) => part.toString(16).padStart(8, '0'))
    .join('')
}

function createPairCode(peerId, secret) {
  return `${PAIR_PREFIX}${encodeURIComponent(peerId)}:${secret}`
}

function readPairCode(value) {
  if (!value?.startsWith(PAIR_PREFIX) || value.length > 512) throw new Error('Not a BeamQR Wi-Fi code.')
  const separator = value.lastIndexOf(':')
  const peerId = decodeURIComponent(value.slice(PAIR_PREFIX.length, separator))
  const secret = value.slice(separator + 1)
  if (!peerId || !/^[a-f0-9]{32}$/.test(secret)) throw new Error('This Wi-Fi pairing code is invalid.')
  return { peerId, secret }
}

function createLocalPeer() {
  if (!window.RTCPeerConnection) throw new Error('Wi-Fi transfer is not supported by this browser.')
  // PeerJS's STUN-only default improves candidate discovery without relaying file data.
  return new Peer({ debug: 0 })
}

function peerErrorMessage(error) {
  if (error?.type === 'peer-unavailable') return 'The sender is no longer waiting. Create a new pairing code.'
  if (error?.type === 'not-open-yet' || error?.message?.includes('Connection is not open')) {
    return 'The Wi-Fi connection closed before the transfer finished. Keep both devices open and try again.'
  }
  if (error?.type === 'negotiation-failed' || error?.type === 'connection-closed' || error?.type === 'webrtc') {
    return 'Could not maintain a direct connection. Confirm both devices are online and on the same Wi-Fi, then try again.'
  }
  if (error?.type === 'network' || error?.type === 'server-error' || error?.type === 'socket-error') {
    return 'Automatic pairing is unavailable. Check internet access on both devices and try again.'
  }
  return error?.message || 'Could not connect the devices.'
}

function connectionIsOpen(connection) {
  return Boolean(connection?.open && connection.dataChannel?.readyState === 'open')
}

function sendWhenOpen(connection, data) {
  if (!connectionIsOpen(connection)) throw new Error('The Wi-Fi connection closed before the transfer finished.')
  connection.send(data)
}

async function waitForSendBuffer(connection) {
  const channel = connection.dataChannel
  if (!connectionIsOpen(connection)) throw new Error('The Wi-Fi connection closed before the transfer finished.')
  if (channel.bufferedAmount <= HIGH_WATER_MARK) return
  channel.bufferedAmountLowThreshold = LOW_WATER_MARK
  await new Promise((resolve) => {
    const timeout = setTimeout(done, 2500)
    function done() {
      clearTimeout(timeout)
      channel.removeEventListener('bufferedamountlow', done)
      resolve()
    }
    channel.addEventListener('bufferedamountlow', done, { once: true })
  })
  if (!connectionIsOpen(connection)) throw new Error('The Wi-Fi connection closed before the transfer finished.')
}

async function toBytes(data) {
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer())
  return null
}

function WifiIcon({ name, size = 22 }) {
  const paths = {
    send: <><path d="M12 19V5" /><path d="m6 11 6-6 6 6" /><path d="M5 19h14" /></>,
    receive: <><path d="M12 5v14" /><path d="m18 13-6 6-6-6" /><path d="M5 5h14" /></>,
    file: <><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v5h5" /><path d="M9.5 13h5M9.5 17h5" /></>,
    scan: <><path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4" /><path d="M8 12h8" /></>,
    link: <><path d="M8.5 15.5 6 18a3.5 3.5 0 0 1-5-5l3-3a3.5 3.5 0 0 1 5 0" transform="translate(3)" /><path d="m15.5 8.5 2.5-2.5a3.5 3.5 0 0 1 5 5l-3 3a3.5 3.5 0 0 1-5 0" transform="translate(-3)" /><path d="m9 15 6-6" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    download: <><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></>,
  }
  return <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

function PairScanner({ onCode }) {
  const videoRef = useRef(null)
  const controlsRef = useRef(null)
  const handledRef = useRef(false)
  const onCodeRef = useRef(onCode)
  const [error, setError] = useState('')

  useEffect(() => { onCodeRef.current = onCode }, [onCode])

  useEffect(() => {
    let cancelled = false
    async function start() {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) { setError('Camera unavailable.'); return }
      try {
        const reader = new BrowserQRCodeReader(undefined, { delayBetweenScanAttempts: 45 })
        const controls = await reader.decodeFromConstraints({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } }, videoRef.current, (result) => {
          if (!result || handledRef.current) return
          const value = result.getText()
          if (!value?.startsWith(PAIR_PREFIX)) return
          handledRef.current = true
          controlsRef.current?.stop()
          onCodeRef.current(value)
        })
        if (cancelled) controls.stop()
        else controlsRef.current = controls
      } catch (cause) { if (!cancelled) setError(cause?.message || 'Could not start camera.') }
    }
    start()
    return () => { cancelled = true; try { controlsRef.current?.stop() } catch {} }
  }, [])

  return <div className="wifi-scanner"><video ref={videoRef} muted playsInline /><div className="wifi-scanner-copy"><WifiIcon name="scan" size={16} /><span>Point at the sender QR</span></div><div className="wifi-scan-target"><span /><span /><span /><span /></div>{error && <div className="error-box">{error}</div>}</div>
}

export default function WifiTransfer({ active = true }) {
  const peerRef = useRef(null)
  const connectionRef = useRef(null)
  const payloadRef = useRef(null)
  const receiveRef = useRef(null)
  const [role, setRole] = useState('send')
  const [file, setFile] = useState(null)
  const [stage, setStage] = useState('idle')
  const [pairCode, setPairCode] = useState('')
  const [status, setStatus] = useState('Ready')
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  function closeConnection() {
    try { connectionRef.current?.close() } catch {}
    try { peerRef.current?.destroy() } catch {}
    connectionRef.current = null
    peerRef.current = null
  }

  function reset(nextRole = role) {
    closeConnection()
    payloadRef.current = null
    receiveRef.current = null
    setRole(nextRole); setStage('idle'); setPairCode(''); setStatus('Ready'); setProgress(0); setResult(null); setError(''); setBusy(false)
  }

  useEffect(() => () => closeConnection(), [])
  useEffect(() => {
    if (!active) {
      closeConnection()
      setStage('idle'); setPairCode(''); setStatus('Ready'); setProgress(0); setResult(null); setError('')
    }
  }, [active])

  function handleConnectionFailure(cause) {
    setError(peerErrorMessage(cause))
    setStatus('Connection failed')
    setStage('failed')
  }

  async function sendPayload(connection) {
    const payload = payloadRef.current
    if (!payload) return
    setStage('sending'); setStatus('Sending over Wi-Fi…'); setProgress(0)
    sendWhenOpen(connection, { t: 'meta', name: payload.name, mime: payload.mime, size: payload.bytes.length, hash: payload.hash })
    for (let offset = 0; offset < payload.bytes.length; offset += CHUNK_SIZE) {
      await waitForSendBuffer(connection)
      sendWhenOpen(connection, payload.bytes.slice(offset, offset + CHUNK_SIZE))
      setProgress(Math.round(Math.min(payload.bytes.length, offset + CHUNK_SIZE) / payload.bytes.length * 100))
    }
    await waitForSendBuffer(connection)
    sendWhenOpen(connection, { t: 'done' })
    setStage('complete'); setStatus('Sent successfully'); setProgress(100)
  }

  function prepareSenderConnection(connection, secret) {
    if (connection.metadata?.secret !== secret || connectionRef.current) {
      connection.close()
      return
    }
    connectionRef.current = connection
    connection.on('open', () => sendPayload(connection).catch((cause) => {
      if (connectionRef.current === connection) handleConnectionFailure(cause)
    }))
    connection.on('error', handleConnectionFailure)
  }

  async function createTransfer() {
    if (!file) return
    setBusy(true); setError(''); setStatus('Preparing…')
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      payloadRef.current = { bytes, name: file.name, mime: file.type || 'application/octet-stream', hash: await checksum(bytes) }
      const secret = createPairSecret()
      const peer = createLocalPeer()
      peerRef.current = peer
      peer.on('connection', (connection) => prepareSenderConnection(connection, secret))
      peer.on('error', handleConnectionFailure)
      peer.on('open', (peerId) => {
        setPairCode(createPairCode(peerId, secret))
        setStage('waiting')
        setStatus('Receiver scans this code once')
        setBusy(false)
      })
    } catch (cause) {
      handleConnectionFailure(cause)
      closeConnection()
      setBusy(false)
    }
  }

  async function receiveData(data) {
    if (data && typeof data === 'object' && !ArrayBuffer.isView(data) && !(data instanceof ArrayBuffer) && !(data instanceof Blob)) {
      if (data.t === 'meta') {
        if (!Number.isSafeInteger(data.size) || data.size < 0) throw new Error('The incoming file size is invalid.')
        receiveRef.current = { ...data, chunks: [], received: 0 }
        setStage('receiving'); setStatus(`Receiving ${data.name}`); setProgress(0)
      } else if (data.t === 'done' && receiveRef.current) {
        const incoming = receiveRef.current
        const bytes = new Uint8Array(incoming.received)
        let offset = 0
        for (const chunk of incoming.chunks) { bytes.set(chunk, offset); offset += chunk.length }
        if (bytes.length !== incoming.size || await checksum(bytes) !== incoming.hash) throw new Error('File verification failed.')
        setResult({ name: incoming.name, mime: incoming.mime, bytes }); setStage('complete'); setStatus('Received successfully'); setProgress(100)
      }
      return
    }
    const incoming = receiveRef.current
    const chunk = await toBytes(data)
    if (!incoming || !chunk) return
    incoming.chunks.push(chunk); incoming.received += chunk.length
    if (incoming.received > incoming.size) throw new Error('Received more data than expected.')
    setProgress(incoming.size ? Math.round(incoming.received / incoming.size * 100) : 100)
  }

  function joinTransfer(value) {
    setError(''); setStage('connecting'); setStatus('Connecting automatically…')
    try {
      const { peerId, secret } = readPairCode(value)
      const peer = createLocalPeer()
      peerRef.current = peer
      peer.on('error', handleConnectionFailure)
      peer.on('open', () => {
        const connection = peer.connect(peerId, { reliable: true, metadata: { secret }, serialization: 'binary' })
        connectionRef.current = connection
        connection.on('open', () => { setStage('receiving'); setStatus('Connected · waiting for file') })
        connection.on('data', (data) => receiveData(data).catch((cause) => { handleConnectionFailure(cause); closeConnection() }))
        connection.on('error', handleConnectionFailure)
      })
    } catch (cause) {
      handleConnectionFailure(cause)
      closeConnection()
    }
  }

  function saveResult() {
    if (!result) return
    const url = URL.createObjectURL(new Blob([result.bytes], { type: result.mime }))
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = result.name || 'beamqr-file'; anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <section className="panel wifi-panel">
      <div className="panel-heading wifi-heading"><div><div className="step-label">LOCAL WI-FI</div><h2>Send without the wait</h2><p>Pair once, then transfer directly between devices.</p></div>{stage !== 'idle' && <button className="ghost-button compact" onClick={() => reset()}>Start over</button>}</div>
      <div className="wifi-mode-badge"><span /> ONE-SCAN MODE</div>
      <div className="segmented wifi-role-switch">
        <button className={role === 'send' ? 'active' : ''} onClick={() => reset('send')} aria-pressed={role === 'send'}><WifiIcon name="send" /><span><strong>Send</strong><small>Show one code</small></span></button>
        <button className={role === 'receive' ? 'active' : ''} onClick={() => reset('receive')} aria-pressed={role === 'receive'}><WifiIcon name="receive" /><span><strong>Receive</strong><small>Scan and save</small></span></button>
      </div>

      {stage === 'idle' && role === 'send' && <div className="wifi-action-view"><label className={`drop-zone wifi-file ${file ? 'has-file' : ''}`}><input type="file" onChange={(event) => { setFile(event.target.files?.[0] || null); setError('') }} /><span className="wifi-action-icon"><WifiIcon name="file" size={27} /></span><strong>{file ? file.name : 'Choose a file to send'}</strong><small>{file ? `${formatBytes(file.size)} · Tap to replace` : 'No fixed size cap · same Wi-Fi'}</small><em>{file ? 'Ready to pair' : 'Browse device'}</em></label><button className="primary-button full wifi-cta" disabled={!file || busy} onClick={createTransfer}>{busy ? <><span className="spinner" /> Preparing secure link</> : <><WifiIcon name="link" /> Create transfer code</>}</button></div>}
      {stage === 'idle' && role === 'receive' && <div className="wifi-receive-ready"><span className="wifi-radar"><WifiIcon name="scan" size={30} /></span><div><strong>Scan once. Receive directly.</strong><small>The sender keeps their QR open while you connect.</small></div><button className="primary-button full wifi-cta" onClick={() => { setStage('scan-sender'); setStatus('Scan the sender code') }}><WifiIcon name="scan" /> Open camera</button></div>}

      {stage === 'waiting' && <div className="wifi-pair-code"><div className="wifi-state-heading"><span className="wifi-live-dot" /><div><strong>{status}</strong><small>Keep this screen open—your camera is not needed.</small></div></div><div className="wifi-qr-shell"><QRCodeView value={pairCode} size={340} /></div><div className="wifi-scan-once"><WifiIcon name="receive" size={18} /><span>Receiver scans once</span></div></div>}
      {stage === 'scan-sender' && <PairScanner onCode={joinTransfer} />}
      {(stage === 'connecting' || stage === 'sending' || stage === 'receiving' || stage === 'complete') && <div className={`wifi-progress ${stage === 'complete' ? 'is-complete' : ''}`}><div className="wifi-progress-icon">{stage === 'complete' ? <WifiIcon name="check" /> : <span className="wifi-live-dot" />}</div><div className="wifi-progress-copy"><strong>{status}</strong><small>{stage === 'connecting' ? 'Finding the fastest direct route' : stage === 'complete' ? 'Integrity check passed' : 'Keep both devices on this screen'}</small></div><span>{progress}%</span><div className="progress-track"><div className="progress-fill" style={{ width: `${progress}%` }} /></div></div>}
      {result && <button className="primary-button full wifi-cta" onClick={saveResult}><WifiIcon name="download" /> Save {result.name}</button>}
      {error && <div className="error-box" role="alert">{error}</div>}
      <div className="wifi-trust-row"><span><i /> One receiver scan</span><span><i /> Direct file data</span><span><i /> SHA-256 verified</span></div>
    </section>
  )
}
