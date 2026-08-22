# BeamQR

A React/Vite app that transfers text and files by showing animated QR codes on the sender and scanning them on the receiver.

## Interface features

- Responsive dark and light themes
- Drag-and-drop file selection with live transfer estimates
- Adjustable QR animation speed, frame stepping, and fullscreen display
- Circular dot-matrix QR styling with scan-safe finder markers
- Live camera scan progress and camera switching
- XOR recovery frames that reconstruct one missing data frame per eight-frame group
- Burst-resistant frame ordering that spreads related frames across the animation
- Automatic camera calibration with a recommended sender speed
- Native accelerated QR detection where the browser supports it
- Multi-image QR screenshot importing as an alternative to live camera scanning
- Same-Wi-Fi WebRTC file transfer with one receiver scan
- Copy feedback, offline file download, and clear integrity status

## What it does

- No file-transfer backend
- No account
- No Bluetooth transfer
- Direct same-Wi-Fi file transfer without a relay server
- Text transfer
- File transfer
- Animated multi-frame QR protocol
- Frames can arrive in any order
- Duplicate frames are ignored
- Missing frames can be rebuilt from parity data
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
4. On Receiver, press **Start scanning**, or import saved QR screenshots.
5. Hold the receiver camera toward the sender screen and follow the calibrated speed recommendation.
6. The receiver collects unique frames until complete.
7. Text can be copied; files can be saved.

## Same-Wi-Fi flow

1. Open **Wi-Fi** on both devices connected to the same local network.
2. The sender chooses a file and creates a pairing code.
3. The receiver scans the sender code once.
4. Automatic signaling connects the devices; the sender does not scan anything.
5. The file streams directly over WebRTC and the receiver saves it after SHA-256 verification.

Wi-Fi pairing uses the public PeerServer Cloud for temporary signaling metadata, so both devices need internet access while connecting. File bytes remain peer-to-peer and no STUN or TURN relay is configured. Router client isolation or restrictive browser networking policies can prevent a direct connection.

## Practical limits

QR transfer is optical, so large files take many frames. QR mode limits files to 2 MB, and files under about 200 KB are more practical. Same-Wi-Fi mode supports files up to 50 MB. Use the `Easy` QR speed on lower-quality cameras.
