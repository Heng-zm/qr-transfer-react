import pako from 'pako'

const CURRENT_VERSION = 2
const LEGACY_VERSION = 1
const LEGACY_CHUNK_SIZE = 650
const DATA_CHUNK_BYTES = 480
const DATA_CHUNK_BASE64 = Math.ceil(DATA_CHUNK_BYTES / 3) * 4
const RECOVERY_GROUP_SIZE = 8
export const MAX_TRANSFER_BYTES = 2 * 1024 * 1024
const MAX_FRAMES = 10000

function bytesToBase64(bytes) {
  let binary = ''
  const block = 0x8000
  for (let i = 0; i < bytes.length; i += block) binary += String.fromCharCode(...bytes.subarray(i, i + block))
  return btoa(binary)
}

function base64ToBytes(base64) {
  const binary = atob(base64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i)
  return out
}

async function sha256Hex(bytes) {
  if (!globalThis.crypto?.subtle) throw new Error('SHA-256 verification requires HTTPS or localhost.')
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function randomId() {
  const bytes = new Uint8Array(6)
  crypto.getRandomValues(bytes)
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function commonPayload({ id, kind, name, mime, size, checksum, total }) {
  return { q: 'QRT', v: CURRENT_VERSION, id, n: total, k: kind, nm: name || '', mt: mime || '', sz: size, h: checksum }
}

function buildSmartSchedule(dataFrames, recoveryFrames) {
  if (!recoveryFrames.length) return dataFrames
  const groups = recoveryFrames.length
  const reorderedData = []

  // Spread members of the same recovery group apart. A short camera blackout then
  // removes at most one member from several groups instead of many from one group.
  for (let offset = 0; offset < RECOVERY_GROUP_SIZE; offset += 1) {
    for (let group = 0; group < groups; group += 1) {
      const index = group * RECOVERY_GROUP_SIZE + offset
      if (dataFrames[index]) reorderedData.push(dataFrames[index])
    }
  }

  // Distribute parity frames throughout the cycle so recovery becomes available early.
  const schedule = [...reorderedData]
  recoveryFrames.forEach((frame, index) => {
    const position = Math.min(schedule.length, Math.round(((index + 1) * schedule.length) / (recoveryFrames.length + 1)) + index)
    schedule.splice(position, 0, frame)
  })
  return schedule
}

export async function createTransfer({ kind, name, mime, bytes }) {
  if (bytes.length > MAX_TRANSFER_BYTES) throw new Error('This content is over the 2 MB QR limit.')
  const compressed = pako.deflate(bytes)
  const checksum = await sha256Hex(bytes)
  const id = randomId()
  const total = Math.max(1, Math.ceil(compressed.length / DATA_CHUNK_BYTES))
  const common = commonPayload({ id, kind, name, mime, size: bytes.length, checksum, total })
  const chunks = Array.from({ length: total }, (_, index) => compressed.slice(index * DATA_CHUNK_BYTES, (index + 1) * DATA_CHUNK_BYTES))
  const dataFrames = chunks.map((chunk, index) => JSON.stringify({ ...common, ft: 'd', i: index, c: bytesToBase64(chunk) }))
  const recoveryFrames = []

  for (let start = 0, group = 0; start < total; start += RECOVERY_GROUP_SIZE, group += 1) {
    const members = chunks.slice(start, start + RECOVERY_GROUP_SIZE)
    const lengths = members.map((chunk) => chunk.length)
    const parity = new Uint8Array(Math.max(...lengths))
    for (const chunk of members) for (let index = 0; index < chunk.length; index += 1) parity[index] ^= chunk[index]
    recoveryFrames.push(JSON.stringify({ ...common, ft: 'p', g: group, s: start, ls: lengths, c: bytesToBase64(parity) }))
  }

  return {
    id,
    frames: buildSmartSchedule(dataFrames, recoveryFrames),
    dataFrames: dataFrames.length,
    recoveryFrames: recoveryFrames.length,
    uniqueFrames: dataFrames.length + recoveryFrames.length,
    originalBytes: bytes.length,
    compressedBytes: compressed.length,
    checksum,
  }
}

function validCommon(data) {
  return (
    data?.q === 'QRT' &&
    [LEGACY_VERSION, CURRENT_VERSION].includes(data.v) &&
    typeof data.id === 'string' && /^[a-f0-9]{12}$/.test(data.id) &&
    Number.isInteger(data.n) && data.n >= 1 && data.n <= MAX_FRAMES &&
    ['text', 'file'].includes(data.k) &&
    typeof data.nm === 'string' && data.nm.length <= 255 &&
    typeof data.mt === 'string' && data.mt.length <= 255 &&
    Number.isInteger(data.sz) && data.sz >= 0 && data.sz <= MAX_TRANSFER_BYTES &&
    typeof data.h === 'string' && /^[a-f0-9]{64}$/.test(data.h) &&
    typeof data.c === 'string' && data.c.length <= 700 && /^[A-Za-z0-9+/]*={0,2}$/.test(data.c)
  )
}

export function parseFrame(text) {
  let data
  try { data = JSON.parse(text) } catch { return null }
  if (!validCommon(data)) return null

  if (data.v === LEGACY_VERSION) {
    if (!Number.isInteger(data.i) || data.i < 0 || data.i >= data.n || data.c.length > LEGACY_CHUNK_SIZE) return null
    return { ...data, ft: 'd' }
  }

  if (data.ft === 'd') {
    if (!Number.isInteger(data.i) || data.i < 0 || data.i >= data.n) return null
    if (data.c.length > DATA_CHUNK_BASE64) return null
    return data
  }

  if (data.ft === 'p') {
    if (
      !Number.isInteger(data.g) || data.g < 0 ||
      !Number.isInteger(data.s) || data.s !== data.g * RECOVERY_GROUP_SIZE || data.s >= data.n ||
      !Array.isArray(data.ls) || data.ls.length < 1 || data.ls.length > RECOVERY_GROUP_SIZE ||
      data.s + data.ls.length > data.n ||
      data.ls.some((length) => !Number.isInteger(length) || length < 1 || length > DATA_CHUNK_BYTES) ||
      data.c.length > DATA_CHUNK_BASE64
    ) return null
    return data
  }

  return null
}

export function frameKey(frame) {
  return frame.v === CURRENT_VERSION && frame.ft === 'p' ? `p:${frame.g}` : `d:${frame.i}`
}

function metadataMatches(frame, first) {
  return frame.id === first.id && frame.v === first.v && frame.n === first.n && frame.h === first.h && frame.k === first.k && frame.nm === first.nm && frame.mt === first.mt && frame.sz === first.sz
}

function inspectV2Frames(frames) {
  const data = new Map()
  const parity = new Map()
  for (const frame of frames) {
    if (frame.ft === 'p') parity.set(frame.g, frame)
    else data.set(frame.i, frame)
  }

  let recoverable = 0
  const recoveredIndices = []
  for (const recovery of parity.values()) {
    const missing = []
    for (let offset = 0; offset < recovery.ls.length; offset += 1) if (!data.has(recovery.s + offset)) missing.push(recovery.s + offset)
    if (missing.length === 1) { recoverable += 1; recoveredIndices.push(missing[0]) }
  }

  return { data, parity, direct: data.size, recoverable, recoveredIndices, total: frames[0]?.n || 0 }
}

export function analyzeTransferFrames(framesMap) {
  const frames = [...framesMap.values()]
  if (!frames.length) return { received: 0, direct: 0, recovery: 0, recoveredIndices: [], total: 0, complete: false }
  if (frames[0].v === LEGACY_VERSION) {
    const received = new Set(frames.map((frame) => frame.i)).size
    return { received, direct: received, recovery: 0, recoveredIndices: [], total: frames[0].n, complete: received === frames[0].n }
  }
  const status = inspectV2Frames(frames)
  const received = Math.min(status.total, status.direct + status.recoverable)
  return { received, direct: status.direct, recovery: status.recoverable, recoveredIndices: status.recoveredIndices, total: status.total, complete: received === status.total }
}

function rebuildLegacy(frames) {
  const encoded = frames.sort((a, b) => a.i - b.i).map((frame) => frame.c).join('')
  return pako.inflate(base64ToBytes(encoded))
}

function rebuildV2(frames) {
  const { data, parity, total } = inspectV2Frames(frames)

  for (const recovery of parity.values()) {
    const missing = []
    for (let offset = 0; offset < recovery.ls.length; offset += 1) if (!data.has(recovery.s + offset)) missing.push(offset)
    if (missing.length !== 1) continue

    const missingOffset = missing[0]
    const rebuilt = base64ToBytes(recovery.c)
    for (let offset = 0; offset < recovery.ls.length; offset += 1) {
      if (offset === missingOffset) continue
      const chunk = base64ToBytes(data.get(recovery.s + offset).c)
      for (let index = 0; index < chunk.length; index += 1) rebuilt[index] ^= chunk[index]
    }
    const index = recovery.s + missingOffset
    data.set(index, { ...recovery, ft: 'd', i: index, c: bytesToBase64(rebuilt.slice(0, recovery.ls[missingOffset])) })
  }

  if (data.size !== total) throw new Error('Transfer is incomplete. Keep scanning for more frames.')
  const chunks = Array.from({ length: total }, (_, index) => {
    const frame = data.get(index)
    if (!frame) throw new Error('Transfer is incomplete. Keep scanning for more frames.')
    return base64ToBytes(frame.c)
  })
  const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const compressed = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { compressed.set(chunk, offset); offset += chunk.length }
  return pako.inflate(compressed)
}

export async function rebuildTransfer(framesMap) {
  const frames = [...framesMap.values()]
  if (!frames.length) throw new Error('No frames received.')
  const first = frames.find((frame) => frame.ft === 'd') || frames[0]
  if (!frames.every((frame) => metadataMatches(frame, first))) throw new Error('Frames do not belong to the same transfer.')

  let bytes
  try { bytes = first.v === LEGACY_VERSION ? rebuildLegacy(frames) : rebuildV2(frames) }
  catch (error) {
    if (error?.message?.startsWith('Transfer is incomplete')) throw error
    throw new Error('Transfer data is damaged. Please scan again.')
  }

  if (bytes.length !== first.sz || bytes.length > MAX_TRANSFER_BYTES) throw new Error('Received data size does not match the transfer.')
  if (await sha256Hex(bytes) !== first.h) throw new Error('Checksum failed. Please scan again.')
  return { kind: first.k, name: first.nm, mime: first.mt, size: first.sz, bytes }
}

export function formatBytes(value) {
  if (!Number.isFinite(value) || value <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
  const number = value / 1024 ** index
  return `${number >= 10 || index === 0 ? number.toFixed(0) : number.toFixed(1)} ${units[index]}`
}
