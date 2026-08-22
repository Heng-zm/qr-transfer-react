import { useEffect, useRef } from 'react'
import QRCode from 'qrcode'

export default function QRCodeView({ value, size = 320 }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    if (!value || !canvasRef.current) return
    QRCode.toCanvas(canvasRef.current, value, {
      width: size,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: {
        dark: '#000000',
        light: '#ffffff'
      }
    })
  }, [value, size])

  return <canvas ref={canvasRef} className="qr-canvas" aria-label="Transfer QR code" />
}
