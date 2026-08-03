# PulsarWiki Desktop Application Implementation Plan

## Summary

Convert PulsarWiki from a manually started Express application into a Windows-first Electron desktop application that runs entirely in the logged-in user's session. This ensures installed CLI tools inherit the correct environment and can access that user's Windows Credential Manager credentials.

The packaged application must:

- Produce an NSIS `.exe` installer and run without a separate terminal.
- Support Claude Code, Antigravity CLI, Codex CLI, and OpenCode through reusable connectors.
- Provide embedded interactive CLI onboarding using `xterm.js` and `node-pty`.
- Let each CLI handle its native OAuth, terms, workspace-trust, and credential storage.
- Never store provider tokens or passwords in PulsarWiki.
- Preserve portable architecture for future macOS and Linux builds.

## Architecture and Implementation

### Desktop runtime

- Add Electron with a hardened `BrowserWindow`: `contextIsolation: true`, `nodeIntegration: false`, navigation restrictions, and a strict Content Security Policy.
- Refactor `server.js` to export a start/stop factory rather than listening immediately.
- Start Express/WebSocket from the Electron main process on `127.0.0.1` using an ephemeral port.
- Protect all local HTTP and WebSocket traffic with a random per-launch session cookie created by Electron.
- Shut down the server, PTYs, and active CLI processes when Electron exits.
- Enforce a single running app instance.
- Keep `npm start` available for browser-based development, while adding `electron:dev`, `electron:start`, and `dist:win` scripts.

### User workspace and configuration

- Store application settings under Electron's `app.getPath('userData')`, not beside the installed executable.
- Store only workspace path, selected connector, executable paths, UI preferences, and non-secret status metadata.
- On first launch, ask users to create or select a workspace; default to `Documents/PulsarWiki`.
- Allow importing an existing workspace containing `wiki/` and `raw/`.
- Keep application assets inside the package and all writable wiki content in the selected workspace.
- Use the workspace as the CLI working directory so authentication, workspace trust, instructions, and file access refer to the correct location.
- Do not migrate, copy, inspect, or persist provider credentials.

### CLI connector layer

Create a shared connector contract with:

- Connector identity, name, executable names, and common installation locations.
- Executable discovery through `PATH`, known locations, and a user-selected file.
- Connector status: `not-installed`, `installed`, `unknown`, `authentication-required`, `workspace-trust-required`, `ready`, `expired`, or `error`.
- A documented, non-destructive readiness probe where the CLI provides one; otherwise use `unknown` until connection or first invocation.
- Interactive connection command, headless chat invocation, output parsing, cancellation, timeout, and error classification.
- Exact executable paths and argument arrays with `shell: false`.
- No automatic permission-bypass or dangerous-mode flags.

Implement the four initial adapters:

- Antigravity: interactive `agy` onboarding; headless `agy --print --output-format text`; classify OAuth, keyring, terms, and workspace-trust failures.
- Claude Code: native interactive login followed by print-mode chat.
- Codex CLI: native login/status workflow followed by `codex exec`.
- OpenCode: native provider-authentication workflow followed by `opencode run`.

Verify every authentication and status command against current official CLI documentation during implementation rather than guessing unsupported flags.

### Embedded CLI onboarding

- Add `xterm.js` to the renderer and `node-pty` to the Electron main process.
- Configure Electron native-module rebuilding and unpack `node-pty` from ASAR.
- Expose a narrow preload API for starting, writing to, resizing, and closing an authentication PTY.
- Launch the selected executable interactively inside the embedded terminal using the selected workspace.
- Allow OAuth pages to open only in the system browser through validated HTTPS URLs.
- Do not log or persist PTY input/output during authentication.
- Re-run the connector readiness probe after the interactive process completes.
- Provide a clearly labelled external-terminal fallback if ConPTY or embedded onboarding fails.
- Explain that the external command must run as the same logged-in user—not a Windows service, administrator account, or sandbox identity.

### Renderer and chat behavior

- Replace the current binary chooser with connector cards showing installation and connection state separately.
- Never hide or disable a connector merely because discovery or authentication status is uncertain.
- Provide `Locate executable`, `Connect`, `Reconnect`, `Change`, and `Open external terminal` actions.
- Keep setup progress across application restarts.
- Send the selected connector ID with each chat request and validate it against the server-side registry.
- Disable chat until the desktop backend handshake succeeds, while still allowing connector selection and onboarding.
- Show actionable errors for missing executables, expired sessions, inaccessible keyrings, workspace trust, and outdated backend versions.
- Keep provider credentials and OAuth codes out of renderer storage, logs, HTTP responses, and configuration files.

### Packaging and distribution

- Configure `electron-builder` with an NSIS per-user installer using `asInvoker`; never request elevation or install a Windows service.
- Produce `PulsarWiki Setup <version>.exe`.
- Add application metadata, icon resources, uninstall support, and Start Menu shortcuts.
- Configure optional Windows code signing through CI secrets; local development builds may remain unsigned.
- Add a Windows build workflow that installs dependencies, rebuilds native modules, runs tests, packages the installer, and smoke-tests the unpacked application.
- Keep auto-update, hosted accounts, and direct provider OAuth outside the first release.

## Public Interfaces

- `createPulsarWikiServer({ workspaceDir, host, port, sessionToken })` returns the bound URL and an asynchronous shutdown function.
- Connector registry exposes `discover`, `probe`, `connect`, `invokeChat`, and `abort`.
- Configuration API returns every supported connector plus executable, connection, and selected-state metadata; it never returns credentials.
- Preload exposes only workspace selection, executable selection, external-link opening, and PTY lifecycle operations.
- WebSocket protocol gains connector-aware chat and explicit desktop-backend version negotiation.
- All interfaces validate connector IDs, executable paths, workspace paths, message sizes, and process ownership.

## Test and Acceptance Plan

- Unit-test connector discovery, exact-path execution, argument construction, error classification, timeouts, and shell-injection resistance.
- Use fake CLI fixtures to test OAuth URLs, authorization-code prompts, workspace trust, successful completion, cancellation, and malformed output without real credentials.
- Integration-test Electron startup, ephemeral server binding, session-cookie protection, configuration persistence, workspace import, and graceful child-process shutdown.
- Add Electron UI tests for first-run setup, missing executables, manual executable selection, embedded-terminal interaction, reconnection, and changing connectors.
- Package and install the NSIS artifact under a normal Windows account and confirm no administrator prompt or service installation occurs.
- Manually verify Antigravity by authenticating through the embedded terminal, restarting PulsarWiki, and successfully running chat without signing in again.
- Confirm the same Antigravity session works in a normal terminal and PulsarWiki because both run under the same Windows identity.
- Confirm authentication data never appears in application logs, settings, crash output, browser storage, or WebSocket messages.
- Confirm an unavailable or unauthenticated connector remains selectable and produces a recovery action rather than blocking setup.
- Run all existing wiki, document-viewer, graph, upload, and chat regression checks in both development and packaged modes.

## Assumptions and Defaults

- Initial delivery is Windows-first with cross-platform abstractions retained.
- Electron is preferred over Tauri because the current application is Node-based and requires Node child processes and PTY support.
- PulsarWiki is a local, single-user application; hosted multi-user authentication is out of scope.
- Native CLI authentication and OS keyrings remain the source of truth.
- The app runs in the interactive desktop user's session and never as a service, elevated helper, or alternate account.
- Embedded onboarding is the primary experience; external terminal authentication is a fallback.
- Antigravity's secure-keyring and browser OAuth behavior follows Google's [authentication](https://antigravity.google/docs/cli-getting-started) and [keyring troubleshooting](https://antigravity.google/docs/cli-troubleshooting?1=1) guidance.
