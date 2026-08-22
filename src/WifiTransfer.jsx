import { useEffect, useRef, useState } from 'react'
import { BrowserQRCodeReader } from '@zxing/browser'
import pako from 'pako'
import QRCodeView from './QRCodeView.jsx'
import { formatBytes } from './protocol.js'

const WIFI_FILE_LIMIT = 50 * 1024 * 1024
const CHUNK_SIZE = 16 * 1024
const encoder = new TextEncoder()

function bytesToBase64Url(bytes) {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function base64UrlToBytes(value) {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4)
  const binary = atob(base64)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function packSignal(description) {
  return `BW1:${bytesToBase64Url(pako.deflate(encoder.encode(JSON.stringify(description))))}`
}

function unpackSignal(value) {
  if (!value?.startsWith('BW1:')) throw new Error('Not a BeamQR Wi-Fi code.')
  if (value.length > 12000) throw new Error('Pairing code is too large.')
  return JSON.parse(new TextDecoder().decode(pako.inflate(base64UrlToBytes(value.slice(4)))))
}

async function checksum(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function waitForIce(peer) {
  if (peer.iceGatheringState === 'complete') return Promise.resolve()
  return new Promise((resolve) => {
    const timeout = setTimeout(done, 5000)
    function done() { clearTimeout(timeout); peer.removeEventListener('icegatheringstatechange', check); resolve() }
    function check() { if (peer.iceGatheringState === 'complete') done() }
    peer.addEventListener('icegatheringstatechange', check)
  })
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
          if (!value?.startsWith('BW1:')) return
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

  return <div className="wifi-scanner"><video ref={videoRef} muted playsInline /><div className="wifi-scan-target"><span /><span /><span /><span /></div>{error && <div className="error-box">{error}</div>}</div>
}

export default function WifiTransfer({ active = true }) {
  const peerRef = useRef(null)
  const channelRef = useRef(null)
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
    try { channelRef.current?.close() } catch {}
    try { peerRef.current?.close() } catch {}
    channelRef.current = null
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

  function createPeer() {
    if (!window.RTCPeerConnection) throw new Error('Wi-Fi transfer is not supported by this browser.')
    const peer = new window.RTCPeerConnection({ iceServers: [] })
    peerRef.current = peer
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'failed' || peer.connectionState === 'disconnected') { setError('Connection lost. Keep both devices on the same Wi-Fi network.'); setStatus('Disconnected') }
    }
    return peer
  }

  async function sendPayload(channel) {
    const payload = payloadRef.current
    if (!payload) return
    setStage('sending'); setStatus('Sending over Wi-Fi…'); setProgress(0)
    channel.bufferedAmountLowThreshold = 256 * 1024
    channel.send(JSON.stringify({ t: 'meta', name: payload.name, mime: payload.mime, size: payload.bytes.length, hash: payload.hash }))
    for (let offset = 0; offset < payload.bytes.length; offset += CHUNK_SIZE) {
      if (channel.bufferedAmount > 1024 * 1024) await new Promise((resolve) => channel.addEventListener('bufferedamountlow', resolve, { once: true }))
      channel.send(payload.bytes.slice(offset, offset + CHUNK_SIZE))
      setProgress(Math.round(Math.min(payload.bytes.length, offset + CHUNK_SIZE) / payload.bytes.length * 100))
    }
    channel.send(JSON.stringify({ t: 'done' }))
    setStage('complete'); setStatus('Sent'); setProgress(100)
  }

  async function createOffer() {
    if (!file) return
    if (file.size > WIFI_FILE_LIMIT) { setError('Choose a file up to 50 MB.'); return }
    setBusy(true); setError(''); setStatus('Preparing…')
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      payloadRef.current = { bytes, name: file.name, mime: file.type || 'application/octet-stream', hash: await checksum(bytes) }
      const peer = createPeer()
      const channel = peer.createDataChannel('beamqr', { ordered: true })
      channelRef.current = channel
      channel.binaryType = 'arraybuffer'
      channel.onopen = () => sendPayload(channel).catch((cause) => setError(cause?.message || 'Send failed.'))
      await peer.setLocalDescription(await peer.createOffer())
      await waitForIce(peer)
      setPairCode(packSignal(peer.localDescription)); setStage('offer'); setStatus('Scan this code on the receiver')
    } catch (cause) { setError(cause?.message || 'Could not create Wi-Fi transfer.'); setStatus('Failed'); closeConnection() }
    finally { setBusy(false) }
  }

  async function acceptOffer(value) {
    setError(''); setStatus('Creating answer…')
    try {
      const peer = createPeer()
      peer.ondatachannel = ({ channel }) => {
        channelRef.current = channel
        channel.binaryType = 'arraybuffer'
        channel.onopen = () => { setStage('receiving'); setStatus('Connected · waiting for file') }
        channel.onmessage = async ({ data }) => {
          try {
            if (typeof data === 'string') {
              const message = JSON.parse(data)
              if (message.t === 'meta') {
                if (!Number.isSafeInteger(message.size) || message.size < 0 || message.size > WIFI_FILE_LIMIT) throw new Error('The incoming file is too large.')
                receiveRef.current = { ...message, chunks: [], received: 0 }; setStage('receiving'); setStatus(`Receiving ${message.name}`); setProgress(0)
              }
              if (message.t === 'done' && receiveRef.current) {
                const incoming = receiveRef.current
                const bytes = new Uint8Array(incoming.received)
                let offset = 0
                for (const chunk of incoming.chunks) { bytes.set(chunk, offset); offset += chunk.length }
                if (bytes.length !== incoming.size || await checksum(bytes) !== incoming.hash) throw new Error('File verification failed.')
                setResult({ name: incoming.name, mime: incoming.mime, bytes }); setStage('complete'); setStatus('Received'); setProgress(100)
              }
              return
            }
            const incoming = receiveRef.current
            if (!incoming) return
            const chunk = new Uint8Array(data)
            incoming.chunks.push(chunk); incoming.received += chunk.length
            if (incoming.received > incoming.size) throw new Error('Received more data than expected.')
            setProgress(Math.round(incoming.received / incoming.size * 100))
          } catch (cause) {
            setError(cause?.message || 'Receive failed.'); setStatus('Failed'); setStage('failed'); closeConnection()
          }
        }
      }
      const offer = unpackSignal(value)
      if (offer.type !== 'offer' || typeof offer.sdp !== 'string') throw new Error('Expected a sender pairing code.')
      await peer.setRemoteDescription(offer)
      await peer.setLocalDescription(await peer.createAnswer())
      await waitForIce(peer)
      setPairCode(packSignal(peer.localDescription)); setStage('answer'); setStatus('Show this answer to the sender')
    } catch (cause) { setError(cause?.message || 'Could not join transfer.'); setStatus('Failed'); setStage('idle'); closeConnection() }
  }

  async function acceptAnswer(value) {
    try {
      const answer = unpackSignal(value)
      if (answer.type !== 'answer' || typeof answer.sdp !== 'string') throw new Error('Expected a receiver answer code.')
      await peerRef.current?.setRemoteDescription(answer); setStage('connecting'); setStatus('Connecting over local Wi-Fi…')
    }
    catch (cause) { setError(cause?.message || 'Could not read the answer code.'); setStage('offer') }
  }

  function saveResult() {
    if (!result) return
    const url = URL.createObjectURL(new Blob([result.bytes], { type: result.mime }))
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = result.name || 'beamqr-file'; anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const showScanner = stage === 'scan-offer' || stage === 'scan-answer'
  return (
    <section className="panel wifi-panel">
      <div className="panel-heading"><div><div className="step-label">LOCAL WI-FI</div><h2>Direct device transfer</h2></div>{stage !== 'idle' && <button className="ghost-button compact" onClick={() => reset()}>Reset</button>}</div>
      <div className="segmented"><button className={role === 'send' ? 'active' : ''} onClick={() => reset('send')}>Send</button><button className={role === 'receive' ? 'active' : ''} onClick={() => reset('receive')}>Receive</button></div>

      {stage === 'idle' && role === 'send' && <><label className="drop-zone wifi-file"><input type="file" onChange={(event) => { setFile(event.target.files?.[0] || null); setError('') }} /><strong>{file ? file.name : 'Choose a file'}</strong><small>{file ? formatBytes(file.size) : 'Up to 50 MB · same Wi-Fi'}</small></label><button className="primary-button full" disabled={!file || busy} onClick={createOffer}>{busy ? 'Preparing…' : 'Create Wi-Fi transfer'}</button></>}
      {stage === 'idle' && role === 'receive' && <button className="primary-button full" onClick={() => { setStage('scan-offer'); setStatus('Scan the sender code') }}>Scan sender code</button>}

      {(stage === 'offer' || stage === 'answer') && <div className="wifi-pair-code"><QRCodeView value={pairCode} size={340} /><strong>{status}</strong>{stage === 'offer' && <button className="primary-button" onClick={() => setStage('scan-answer')}>Scan receiver answer</button>}</div>}
      {showScanner && <PairScanner onCode={stage === 'scan-offer' ? acceptOffer : acceptAnswer} />}
      {(stage === 'connecting' || stage === 'sending' || stage === 'receiving' || stage === 'complete') && <div className="wifi-progress"><strong>{status}</strong><div className="progress-track"><div className="progress-fill" style={{ width: `${progress}%` }} /></div><span>{progress}%</span></div>}
      {result && <button className="primary-button full" onClick={saveResult}>Save {result.name}</button>}
      {error && <div className="error-box" role="alert">{error}</div>}
      <div className="wifi-note">Direct WebRTC · no relay server</div>
    </section>
  )
}
