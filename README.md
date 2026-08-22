# QR Offline Transfer

A React/Vite app that transfers text and files by showing animated QR codes on the sender and scanning them on the receiver.

## What it does

- No backend
- No account
- No Bluetooth transfer
- No Wi-Fi/network transfer between sender and receiver
- Text transfer
- File transfer
- Animated multi-frame QR protocol
- Frames can arrive in any order
- Duplicate frames are ignored
- Deflate compression
- SHA-256 integrity verification
- PWA caching for offline use after installation
- Camera scanner using ZXing

## Run locally

```bash
npm install
npm run dev
```

Open the local URL shown by Vite.

## Production build

```bash
npm run build
npm run preview
```

The final static site is in `dist/`. It can be hosted on any static HTTPS hosting service. No API server is required.

## iPhone / iPad / Safari camera rule

Safari and other browsers require a **secure context** for camera access:

- `https://...` works
- `http://localhost...` works on the same device
- plain `http://192.168.x.x...` may not allow camera access
- opening `index.html` directly with `file://` will not allow camera access

For truly offline receiver use, install the app as a PWA while it is available over HTTPS. After the PWA assets are cached, the receiver can reopen it without internet and scan QR codes using the camera.

## Transfer flow

1. On Sender, choose Text or File.
2. Press **Create QR transfer**.
3. The sender displays animated QR frames.
4. On Receiver, press **Start scanning**.
5. Hold the receiver camera toward the sender screen.
6. The receiver collects unique frames until complete.
7. Text can be copied; files can be saved.

## Practical limits

QR transfer is optical, so large files take many frames. This build limits files to 2 MB, but QR is an optical channel, so files under about 200 KB are much more practical. Use the `Easy scan` speed on lower-quality cameras.
# qr-transfer-react
