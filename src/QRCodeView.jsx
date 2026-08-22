import { useEffect, useRef } from 'react'
import QRCode from 'qrcode'

export default function QRCodeView({ value, size = 320 }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    if (!value || !canvasRef.current) return
    QRCode.toCanvas(canvasRef.current, value, {
      width: size,
      margin: 3,
      errorCorrectionLevel: 'M',
      color: {
        dark: '#10210b',
        light: '#ffffff'
      }
    })
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
