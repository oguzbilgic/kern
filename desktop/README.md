# kern desktop

Native desktop app for kern — a thin Tauri 2.0 wrapper that connects to your kern web server.

## How it works

1. Opens a connect screen where you enter your server URL and token
2. Validates the connection, saves the server to local storage
3. Loads the full kern web UI from your remote server in a native WebView
4. Auto-connects to the last used server on subsequent launches

## Build

### GitHub Actions (recommended)

Push a tag to trigger the build:

```bash
git tag desktop-v0.1.0
git push origin desktop-v0.1.0
```

Or trigger manually from the Actions tab → "Desktop Build" → Run workflow.

Builds macOS (ARM + Intel) and Linux. Artifacts uploaded to a draft GitHub release.

### Local build

Requires [Rust](https://rustup.rs/) and platform dependencies.

```bash
cd desktop
cargo install tauri-cli
cargo tauri dev    # development
cargo tauri build  # production
```

macOS `.dmg` at `src-tauri/target/release/bundle/dmg/`.

## Structure

```
desktop/
├── ui/                  # Connect screen (bundled in app)
│   └── index.html
├── src-tauri/
│   ├── Cargo.toml       # Rust dependencies
│   ├── tauri.conf.json  # App config
│   ├── icons/           # App icon
│   └── src/main.rs      # Entry point
└── README.md
```

# trigger
# v0.1.0
