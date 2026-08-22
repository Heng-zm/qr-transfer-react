import pako from 'pako'

const VERSION = 1
const DEFAULT_CHUNK_SIZE = 650

function bytesToBase64(bytes) {
  let binary = ''
  const block = 0x8000
  for (let i = 0; i < bytes.length; i += block) {
    binary += String.fromCharCode(...bytes.subarray(i, i + block))
  }
  return btoa(binary)
}

function base64ToBytes(base64) {
  const binary = atob(base64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i)
  return out
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function randomId() {
  const bytes = new Uint8Array(6)
  crypto.getRandomValues(bytes)
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function createTransfer({ kind, name, mime, bytes, chunkSize = DEFAULT_CHUNK_SIZE }) {
  const compressed = pako.deflate(bytes)
  const encoded = bytesToBase64(compressed)
  const checksum = await sha256Hex(bytes)
  const id = randomId()
  const total = Math.max(1, Math.ceil(encoded.length / chunkSize))
  const frames = []

  for (let index = 0; index < total; index += 1) {
    const payload = {
      q: 'QRT',
      v: VERSION,
      id,
      i: index,
      n: total,
      k: kind,
      nm: name || '',
      mt: mime || '',
      sz: bytes.length,
      h: checksum,
      c: encoded.slice(index * chunkSize, (index + 1) * chunkSize)
    }
    frames.push(JSON.stringify(payload))
  }

  return {
    id,
    frames,
    originalBytes: bytes.length,
    compressedBytes: compressed.length,
    checksum
  }
}

export function parseFrame(text) {
  let data
  try {
    data = JSON.parse(text)
  } catch {
    return null
  }

  if (
    data?.q !== 'QRT' ||
    data?.v !== VERSION ||
    typeof data.id !== 'string' ||
    !Number.isInteger(data.i) ||
    !Number.isInteger(data.n) ||
    data.i < 0 ||
    data.n < 1 ||
    data.i >= data.n ||
    typeof data.c !== 'string'
  ) {
    return null
  }

  return data
}

export async function rebuildTransfer(framesMap) {
  const frames = [...framesMap.values()].sort((a, b) => a.i - b.i)
  if (!frames.length) throw new Error('No frames received.')

  const first = frames[0]
  if (frames.length !== first.n) throw new Error('Transfer is incomplete.')

  for (const frame of frames) {
    if (frame.id !== first.id || frame.n !== first.n || frame.h !== first.h) {
      throw new Error('Frames do not belong to the same transfer.')
    }
  }

  const compressed = base64ToBytes(frames.map((f) => f.c).join(''))
  const bytes = pako.inflate(compressed)
  const checksum = await sha256Hex(bytes)

  if (checksum !== first.h) throw new Error('Checksum failed. Please scan again.')

  return {
    kind: first.k,
    name: first.nm,
    mime: first.mt,
    size: first.sz,
    bytes
  }
}

export function formatBytes(value) {
  if (!Number.isFinite(value) || value <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
  const n = value / 1024 ** index
  return `${n >= 10 || index === 0 ? n.toFixed(0) : n.toFixed(1)} ${units[index]}`
}
