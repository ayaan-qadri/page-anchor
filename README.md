# ⚓ Page Anchor

> **High-Performance Cross-Browser Web Annotation & Drawing Extension**  
> Freehand draw, sketch shapes, and place text annotations directly onto any webpage with persistent storage, customizable shortcuts, and zero lag on low-end hardware.

---

## ✨ Features

- ✏️ **Freehand Drawing**: Silky smooth pen and brush sketching with quadratic bezier curve interpolation.
- 🖍️ **Highlighter**: Semi-transparent highlighter with configurable opacity and width, ideal for documents, articles, and code.
- 📐 **Vector Shapes**:
  - Rectangles & Boxes
  - Circles & Ellipses
  - Straight Lines (with Shift snapping to 0°, 45°, 90°)
  - Directional Arrows
  - Double-headed Dimension Arrows
- 🔤 **Text Annotations**: Click anywhere to type notes with custom font size, text colors, and high-legibility backdrop cards.
- 🧹 **Instant Eraser**: Touch or sweep across any stroke, shape, or text to erase with real-time feedback.
- 🔍 **Selection & Move**: Select any existing element, drag it anywhere on the page, or hit `Delete` / `Backspace` to remove.
- 💾 **Persistent Storage**:
  - Automatically saves annotations per URL.
  - Returns to the page days or months later? Your drawings are right where you left them.
  - Smart URL normalization: strips tracking query parameters (`utm_*`, `fbclid`, `gclid`) and hash anchors so your drawings stay anchored even across redirects.
- ⌨️ **Fully Customizable Shortcuts**:
  - Rebind every single tool or action to your preferred keyboard combination with an interactive key recorder.
- ⚡ **Zero-Lag Architecture**:
  - Engineered specifically to run smoothly at 60–120 FPS even on budget laptops, chromebooks, and low-end hardware.
- 🛡️ **100% Shadow DOM Isolation**:
  - Webpage CSS resets cannot alter the extension UI.
  - Extension styles cannot break or leak into host websites.
- 🌐 **True Cross-Browser Support**:
  - Compatible with Google Chrome, Microsoft Edge, Mozilla Firefox, Brave, Opera, and Safari (Manifest V3).

---

## 🚀 Zero-Lag Low-End Device Optimizations

Traditional browser drawing extensions struggle and lag because they attempt to render giant canvases covering the entire page height (e.g., 20,000px tall pages) or redraw hundreds of objects on every mousemove event.

Page Anchor solves this with 5 dedicated performance strategies:

1. **Fixed Viewport Dual-Canvas Engine**:
   - The canvas resolution is clamped strictly to the user's viewport (`innerWidth` × `innerHeight`), avoiding hundreds of megabytes of GPU memory exhaustion.
   - Separate **Active Canvas Layer** (for real-time stroke preview) and **Base Canvas Layer** (for committed shapes). Drawing a freehand stroke never causes re-rendering of existing elements.
2. **Spatial Viewport Frustum Culling**:
   - Uses sub-nanosecond Axis-Aligned Bounding Box (`AABB`) intersection tests.
   - Elements outside the visible screen are culled and never sent to Canvas 2D during scrolling.
3. **Ramer-Douglas-Peucker (RDP) Point Decimation**:
   - Pointer events generate thousands of raw coordinates. On stroke completion, the RDP algorithm compresses points by up to 75% without compromising curve smoothness, slashing memory and storage payloads by 4x.
4. **Pointer Events Coalescing (`getCoalescedEvents`)**:
   - Sub-frame pointer precision from modern mice and trackpads is captured without dropping points or choking the main thread.
5. **Passive Throttled Scroll Listener**:
   - Scrolling uses `requestAnimationFrame` ticking to ensure native page scroll fluidity.

---

## ⌨️ Default Keyboard Shortcuts

| Action | Default Shortcut | Description |
| :--- | :---: | :--- |
| **Toggle Drawing Mode** | `Alt + D` | Turn drawing overlay on / off |
| **Toggle Toolbar** | `Alt + T` | Collapse or expand floating toolbar |
| **Select / Move** | `V` | Select elements to reposition or delete |
| **Pen Tool** | `P` | Freehand drawing tool |
| **Highlighter** | `H` | Semi-transparent highlighter |
| **Rectangle** | `R` | Draw rectangle box |
| **Circle** | `C` | Draw circle or ellipse |
| **Line** | `L` | Draw straight line |
| **Arrow** | `A` | Draw directional arrow |
| **Text Note** | `T` | Click to place text note |
| **Eraser** | `E` | Sweep or click to erase |
| **Undo** | `Ctrl + Z` | Undo last action |
| **Redo** | `Ctrl + Y` | Redo undone action |
| **Delete Selected** | `Delete` / `Backspace` | Remove selected element |
| **Clear Page** | `Ctrl + Alt + K` | Clear all drawings on current page |
| **Export Snapshot** | `Ctrl + Alt + E` | Download PNG screenshot |

> **Note**: All shortcuts can be customized in the in-page **Settings Modal** (gear icon) or the dedicated **Extension Options** page.

---

## 🛠️ Tech Stack

- **Framework**: [WXT](https://wxt.dev/) 0.21.x (Built on Vite 8)
- **Language**: TypeScript 7.x
- **Standard**: Manifest V3 (Chrome, Edge, Firefox, Safari)
- **Rendering**: Hardware-accelerated HTML5 Canvas 2D with Viewport Frustum Culling
- **UI Architecture**: Isolated Shadow DOM (Mode: open)
- **Package Manager**: pnpm

---

## 📦 Project Structure

```
page-anchor/
├── entrypoints/
│   ├── background.ts            # Service worker & command router
│   ├── content.ts               # Content script injected into web pages
│   ├── popup/                   # Browser action popup (HTML + CSS + TS)
│   │   ├── index.html
│   │   ├── popup.css
│   │   └── popup.ts
│   └── options/                 # Options & settings manager (HTML + CSS + TS)
│       ├── index.html
│       ├── options.css
│       └── options.ts
├── src/
│   ├── core/
│   │   ├── types.ts             # Element types, shortcuts, settings
│   │   ├── geometry.ts          # AABB culling, RDP simplification, splines
│   │   ├── engine.ts            # High-performance dual-canvas engine
│   │   ├── storage.ts           # URL normalization & cross-browser storage
│   │   ├── shortcuts.ts         # Keyboard shortcut manager & recorder
│   │   └── history.ts           # Bounded undo/redo stack
│   ├── ui/
│   │   ├── styles.ts            # Shadow DOM isolated CSS styles
│   │   ├── toolbar.ts           # Floating draggable toolbar & anchor pill
│   │   ├── text-editor.ts       # In-page text annotation overlay
│   │   └── settings-modal.ts    # Interactive settings & shortcut modal
│   └── icons/
│       └── svg-icons.ts         # Pure inline SVG icons (zero asset delay)
├── public/                      # Extension icons (16, 32, 48, 128)
├── wxt.config.ts                # WXT & extension manifest configuration
├── tsconfig.json                # TypeScript configuration
└── package.json
```

---

## 🚀 Development & Build

### 1. Install Dependencies
```bash
pnpm install
```

### 2. Start Dev Server (Hot Module Reloading)
```bash
# Chrome / Chromium
pnpm dev

# Firefox
pnpm dev:firefox
```

### 3. Production Build
```bash
# Chrome (Manifest V3)
pnpm build

# Firefox (Manifest V3 / MV2)
pnpm build:firefox

# Microsoft Edge
pnpm build:edge

# Safari
pnpm build:safari
```

### 4. Create Store Zip Packages
```bash
pnpm zip
```
The zipped extension will be created in `.output/page-anchor-1.0.0-chrome.zip`.

---

## 🌐 How to Load in Your Browser

### In Google Chrome / Microsoft Edge / Brave:
1. Open your browser and navigate to `chrome://extensions` (or `edge://extensions`).
2. Toggle on **Developer mode** in the top-right corner.
3. Click **Load unpacked**.
4. Select the `.output/chrome-mv3` folder inside this project directory.
5. Open any website, press `Alt + D`, and start drawing!

### In Mozilla Firefox:
1. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on...**.
3. Select the `.output/firefox-mv2/manifest.json` file.

---

## 📄 License

MIT License. Built for performance and privacy.
