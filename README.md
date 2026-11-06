# BeamQR

Current release: **2.1.0**

A React/Vite app that transfers text and files by showing animated QR codes on the sender and scanning them on the receiver.

## Interface features

- Responsive dark and light themes
- On-demand feature loading with preserved tab state
- Drag-and-drop file selection with live transfer estimates
- Adjustable QR animation speed, frame stepping, and fullscreen display
- Circular dot-matrix QR styling with scan-safe finder markers
- Live camera scan progress and camera switching
- XOR recovery frames that reconstruct one missing data frame per eight-frame group
- Burst-resistant frame ordering that spreads related frames across the animation
- Smart Vision scanning with native BarcodeDetector acceleration, adaptive multi-scale crops, and ROI locking
- Automatic camera calibration with a recommended sender speed
- Multi-image QR screenshot importing as an alternative to live camera scanning
- Same-Wi-Fi WebRTC file transfer with one receiver scan
- Wi-Fi pairing from the camera or an uploaded QR screenshot
- Sender QR saving/copying and receiver drag-and-drop pairing
- Temporary share links that open Wi-Fi Receive and connect automatically
- Live Wi-Fi transfer speed, byte progress, and time remaining
- Raw WebRTC data path with larger chunks and tuned backpressure
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
- Smart Vision camera scanner using native BarcodeDetector when available, with ZXing as the fallback

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

SHA-256 verification uses `crypto.subtle`, which is also restricted to secure contexts. Run both the sender and the receiver over HTTPS or localhost.

For truly offline receiver use, install the app as a PWA while it is available over HTTPS. After the PWA assets are cached, the receiver can reopen it without internet and scan QR codes using the camera.

## Smart Vision camera scanning

The receiver adapts its scan strategy to the camera and the scene:

- Native `BarcodeDetector` acceleration is used when the browser supports `qr_code`.
- Each detection cycle chooses a full-frame, center-crop, or wide-crop pass to balance range and small-QR detail.
- After a BeamQR code locks, most passes target a padded region around its last position, with periodic full-frame passes to recover movement.
- Scan cadence adapts to measured detection cost, and UI updates are throttled so camera frames stay responsive.
- Auto zoom enlarges small codes and relaxes when no QR is found.
- Browsers without native detection use the ZXing fallback with the same tracking, calibration, and progress feedback.

The Smart Vision badge shows the active mode: `MULTI-SCALE` for native detection or `ADAPTIVE` for the ZXing fallback.

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
3. The receiver scans the sender code once, uploads its image, or opens the temporary share link.
4. Automatic signaling connects the devices; the sender does not scan anything.
5. The file streams directly over WebRTC and the receiver saves it after SHA-256 verification.

Wi-Fi pairing uses the public PeerServer Cloud for temporary signaling metadata, so both devices need internet access while connecting. STUN helps the browsers discover a stable direct route, but no TURN relay is configured and file bytes remain peer-to-peer. Router client isolation or restrictive browser networking policies can still prevent a direct connection. The receiver confirms the SHA-256 result back to the sender before the sender reports success.

Pairing codes are versioned. A receiver on an older build may not understand a newer code, so keep both devices on the current release.

## Practical limits

QR transfer is optical, so large files take many frames. QR mode limits files to 2 MB, and files under about 200 KB are more practical. Same-Wi-Fi transfers are buffered in memory on both devices and are capped at 2 GB; the practical maximum is still much lower on phones. Use the `Easy` QR speed on lower-quality cameras.
