# WisdomWorks Desktop

Native Mac/Windows/Linux app built with Tauri v2, wrapping the Command Deck. Lives in the system tray, sends native notifications, and gives agents access to local files (when wired up).

## Architecture

- **Tauri** (Rust): native window, system tray, notifications, OS integration
- **Vite + React** (frontend): minimal shell that loads the Command Deck
- **Command Deck** (apps/web): runs at `localhost:3000` in dev, `wisdomworks.vercel.app` in prod, embedded via webview

The desktop app is mostly a thin native wrapper. The actual UI is the same Command Deck used in the browser. Future iterations will use Tauri's IPC to expose local file system, app launching, and clipboard access to the agents.

## First-time setup (one-time, ~15 min)

You need the **Rust toolchain** to build Tauri apps. Most macOS/Windows users don't have it installed.

### 1. Install Rust
- Mac/Linux: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
- Windows: download `rustup-init.exe` from https://rustup.rs/ and run it
- Restart your terminal after install
- Verify: `rustc --version` (should print 1.77+)

### 2. Install platform-specific build tools

**Windows:**
- Microsoft C++ Build Tools (https://visualstudio.microsoft.com/visual-cpp-build-tools/)
- Select "Desktop development with C++" workload
- WebView2 (preinstalled on Windows 11; Windows 10 may need https://developer.microsoft.com/en-us/microsoft-edge/webview2/)

**macOS:**
- `xcode-select --install` (if you don't already have Xcode CLI tools)

**Linux:**
- See https://v2.tauri.app/start/prerequisites/ — varies by distro

### 3. Install Node deps
From the repo root:
```bash
pnpm install
```

## Running locally

You need the Command Deck running too:

```bash
# Terminal 1: Command Deck (the actual UI)
pnpm --filter @wisdomworks/web dev

# Terminal 2: Desktop app
pnpm --filter @wisdomworks/desktop dev
```

A native window opens loading `localhost:3000`. Close the window — the app stays in the system tray. Click the tray icon to bring it back.

## Building a production binary

```bash
pnpm --filter @wisdomworks/desktop build
```

Output:
- Mac: `apps/desktop/src-tauri/target/release/bundle/macos/WisdomWorks.app` and `.dmg`
- Windows: `apps/desktop/src-tauri/target/release/bundle/msi/WisdomWorks_*.msi`
- Linux: `apps/desktop/src-tauri/target/release/bundle/{deb,appimage}/...`

You can hand the installer to anyone — no Rust install needed for end users.

## Code signing (production)

For real distribution you'll need to sign the binaries:
- **Mac**: Apple Developer account ($99/yr), notarization
- **Windows**: Code signing certificate (~$100-300/yr)
- **Linux**: optional but improves trust

Without signing, users get OS warnings on first launch. Fine for testing, blocker for shipping.

## Auto-update

Tauri supports built-in updater via `tauri-plugin-updater`. Not configured yet — add when distributing publicly.

## Future iterations

- IPC bridge: agents can call Rust functions to read/write local files, launch apps, access clipboard
- Desktop chat window (smaller floating window separate from main Command Deck)
- Terminal channel for power users (Devon's use case — manage WisdomWorks via shell)
- Cloud↔desktop secure tunnel for remote agent commands
- Local LLM bundling for full offline mode (privacy-first tier)

## Files

- `package.json` — Node dependencies + scripts
- `vite.config.ts` — Vite frontend bundler
- `index.html` + `src/index.tsx` + `src/App.tsx` — minimal React shell
- `src-tauri/Cargo.toml` — Rust dependencies
- `src-tauri/tauri.conf.json` — Tauri config (window size, CSP, tray, etc.)
- `src-tauri/src/main.rs` + `lib.rs` — Rust entry point with system tray setup
- `src-tauri/capabilities/default.json` — security permissions
- `src-tauri/icons/` — app icons (need to be generated; see below)

## Icons

You need icons in `src-tauri/icons/`:
- `32x32.png`, `128x128.png`, `128x128@2x.png` (Linux)
- `icon.icns` (Mac)
- `icon.ico` (Windows)

Generate from a 1024×1024 source PNG with:
```bash
pnpm tauri icon path/to/source-icon.png
```

Run that once when you have a logo PNG; it produces all the sizes Tauri needs.
