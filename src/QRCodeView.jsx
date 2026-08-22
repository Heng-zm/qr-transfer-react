import { useEffect, useRef } from 'react'
import QRCode from 'qrcode'

const QUIET_ZONE = 4
const DARK = '#10210b'

function roundedRect(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2)
  context.beginPath()
  context.moveTo(x + r, y)
  context.lineTo(x + width - r, y)
  context.quadraticCurveTo(x + width, y, x + width, y + r)
  context.lineTo(x + width, y + height - r)
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height)
  context.lineTo(x + r, y + height)
  context.quadraticCurveTo(x, y + height, x, y + height - r)
  context.lineTo(x, y + r)
  context.quadraticCurveTo(x, y, x + r, y)
  context.closePath()
}

function drawFinder(context, column, row, cell) {
  const x = (QUIET_ZONE + column) * cell
  const y = (QUIET_ZONE + row) * cell
  context.fillStyle = DARK
  roundedRect(context, x, y, cell * 7, cell * 7, cell * 1.2)
  context.fill()
  context.fillStyle = '#ffffff'
  roundedRect(context, x + cell, y + cell, cell * 5, cell * 5, cell * .8)
  context.fill()
  context.fillStyle = DARK
  context.beginPath()
  context.arc(x + cell * 3.5, y + cell * 3.5, cell * 1.42, 0, Math.PI * 2)
  context.fill()
}

export default function QRCodeView({ value, size = 320 }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    if (!value || !canvasRef.current) return
    const canvas = canvasRef.current
    let matrix
    try { matrix = QRCode.create(value, { errorCorrectionLevel: 'M' }).modules }
    catch {
      QRCode.toCanvas(canvas, value, { width: size, margin: QUIET_ZONE, errorCorrectionLevel: 'M', color: { dark: DARK, light: '#ffffff' } })
      return
    }
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
    const moduleCount = matrix.size
    const cell = size / (moduleCount + QUIET_ZONE * 2)
    canvas.width = Math.round(size * pixelRatio)
    canvas.height = Math.round(size * pixelRatio)
    const context = canvas.getContext('2d')
    if (!context) return
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
    context.clearRect(0, 0, size, size)
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, size, size)
    context.fillStyle = DARK

    const inFinder = (row, column) => (
      (row < 7 && column < 7) ||
      (row < 7 && column >= moduleCount - 7) ||
      (row >= moduleCount - 7 && column < 7)
    )

    for (let row = 0; row < moduleCount; row += 1) {
      for (let column = 0; column < moduleCount; column += 1) {
        const dark = typeof matrix.get === 'function' ? matrix.get(row, column) : matrix.data[row * moduleCount + column]
        if (!dark || inFinder(row, column)) continue
        const x = (QUIET_ZONE + column + .5) * cell
        const y = (QUIET_ZONE + row + .5) * cell
        context.beginPath()
        context.arc(x, y, cell * .43, 0, Math.PI * 2)
        context.fill()
      }
    }

    drawFinder(context, 0, 0, cell)
    drawFinder(context, moduleCount - 7, 0, cell)
    drawFinder(context, 0, moduleCount - 7, cell)
  }, [value, size])

  return (
    <div className="qr-code-frame">
      <span className="qr-corner top-left" />
      <span className="qr-corner top-right" />
      <span className="qr-corner bottom-left" />
      <span className="qr-corner bottom-right" />
      <canvas ref={canvasRef} className="qr-canvas" aria-label="BeamQR transfer code" />
    </div>
  )
}
