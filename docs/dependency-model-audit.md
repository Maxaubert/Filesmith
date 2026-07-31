# Filesmith: dependency and model-extensibility audit

Scope: can a person who is not the developer install this and use it, and can that person add a new
AI model without waiting for an app release? Six subsystem audits (bundled tools, on-demand
download, ComfyUI integration, model generalization, security, fresh-user UX) were run, each
adversarially filtered, then reconciled here. Every file:line below was read.

---

## 1. Verdict

**The core of Filesmith ships and works for a stranger. The AI half does not generalize.** Convert,
compress, resize, PDF and document conversion are bundled, spawned safely with argv arrays
(`src/main/run.ts:24`), never overwrite a user file (`src/main/output.ts:43-63`), and keep all
mutable state in `userData`. A fresh user on a machine with none of your setup gets a working file
toolkit on day one. That is a real achievement and most of this report is not about it.

**The AI layer is a snapshot of your machine on the day you built it.** Five architectures live in
a TypeScript union (`src/shared/genArch.ts:14`), four of them are runnable
(`src/main/generate/models.ts:16`), each with a hand-written ComfyUI graph and eight hardcoded
Hugging Face `resolve/main` URLs (`src/main/generate/archRegistry.ts:26-141`). Two Real-ESRGAN
model names are frozen at build time (`scripts/fetch-binaries.mjs:255`, `src/main/tools/upscale.ts:13`).
One PiD backbone is hardcoded down to the IPC call (`src/main/pid/paths.ts:84-91`, `src/main/ipc.ts:180`).
Four rembg sessions are a compile-time union (`src/shared/removebg.ts:22`). **There is no file
anywhere on disk that a user can edit to add a model.** Every one of those additions is a code
change plus a signed release.

**Two things will bite a stranger before they ever get to models.** A build made on any machine
but yours silently ships without LibreOffice, Ghostscript or Real-ESRGAN, because the packaging
gate checks only five flat exes (`scripts/fetch-binaries.mjs:342`) while three tree-shaped tools
ride `extraResources` unchecked (`electron-builder.yml:22-34`), and electron-builder only *warns*
on a missing source. And a user whose ComfyUI is not in the ~35 guessed paths has no way to tell
the app where it is: the only folder picker in the entire renderer is behind an NVIDIA gate
(`OptionsPanel.tsx:405`) *and* behind a 3 GB engine download (`ComfyImport.tsx:81`).

**One hard bug**: a space in `%TEMP%` breaks every document conversion, reproduced by direct
execution of the bundled `soffice.com` (`src/main/tools/soffice.ts:28`).

The good news is that the correct pattern already exists in this codebase, twice. The spandrel
upscaler import probes the actual file and lets unknown architectures through with an
"experimental" badge (`src/main/comfy/discover.ts:275-323`, `src/shared/comfy.ts:57-72`). The
architecture scanner classifies by safetensors tensor keys, not filenames
(`src/main/generate/archScan.ts:76-105`). The whole fix is to make the rest of the app behave like
those two files.

---

## 2. What already works

An honest baseline. These are not consolations, they are the parts you should not touch.

### Process execution and file safety
- **No shell, anywhere.** Zero `shell: true`, zero `exec`/`execSync`/`spawnSync` across `src/`.
  Every spawn goes through `run.ts:24` with an argv array and `windowsHide`. A filename containing
  `& rd /s /q C:\`, quotes or `$(...)` is inert. This is the single biggest correctness win for
  arbitrary user paths, and it also removes the injection surface entirely.
- **Output naming cannot clobber.** `output.ts:43-63` claims names with an exclusive
  `openSync(cand, 'wx')`, so concurrent queue jobs racing the same target diverge rather than
  overwrite. `registry.ts:85-118` deletes the placeholder on any failure or cancel and treats a
  0-byte result as failure, so a missing tool never leaves junk beside the source.
- **Prompts and filenames never reach argv.** The generate prompt travels as JSON inside the
  workflow body (`generate/comfy.ts:192-196`); the output name goes through a hard slug
  (`generate/index.ts:26-34`). Sidecar paths travel as JSON over stdin (`pid/sidecar.ts:198`).

### Packaging and paths
- One consistent dev-vs-packaged rule across all six resource trees
  (`toolResolver.ts:10-14, 33-36, 61-64, 89-93`; `pid/paths.ts:48-59`), verified to hold in both
  modes with no drift.
- `electron-builder.yml:15` excludes `resources/**` from the app files while shipping via
  `extraResources`. This halves the installer and keeps binaries as real on-disk files, avoiding
  the classic "binary inside asar cannot be spawned" trap with no `asarUnpack` needed.
- LibreOffice is invoked correctly on Windows: an isolated per-conversion
  `-env:UserInstallation` profile, `soffice.com` preferred over `.exe` so the call actually
  blocks, and `txt:Text (encoded):UTF8` forced so non-ASCII export is not mangled
  (`tools/soffice.ts:22-44`).

### Downloads
- Genuinely atomic and never mistakable for complete: stream to `<dest>.part`, verify byte count
  against Content-Length, delete the part on any failure, rename last
  (`net/download.ts:47-80`, `pid/install.ts:87-116`).
- `net/download.ts` has exactly the right defensive set for model files: a 401/403 branch telling
  the user to accept the license on the model page (`:34-38`), rejection of an HTML/JSON body
  served as 200 (`:41-43`), and a `minBytes` floor fed from the catalog's advertised size
  (`companions.ts:66`). This file is the reference implementation. It just needs hashes, and
  `pid/install.ts` needs to stop forking it.
- Idle-stall watchdog re-arms on every chunk and aborts a half-open socket after 60s, so a dead
  connection reports "Download stalled" instead of hanging the modal forever.
- Phase markers are written only after a phase fully completes, and readiness gates on the marker
  rather than on an artifact that appears early: `paths.ts:39-44` gates on `pidEnvMarker()`
  instead of `python.exe`, which `uv` creates before the ~3 GB torch pull. An interrupted install
  resumes cleanly instead of reading as a torch-less success.

### Model identification (the part that already generalizes)
- **Architecture is inferred from the file, not the name.** `archScan.ts:21` reads the 8-byte
  length plus JSON header, capped at 16 MB against a hostile length field; `classifyArch`
  (`:76-105`) decides from tensor-key signatures. A new *finetune* of a known family works with
  zero code change. Declared `modelspec.architecture` is preferred where present (`:72`).
- Non-image DiTs (video/3D/audio) are positively excluded before the image checks
  (`archScan.ts:113-125`), with regression tests for HunyuanVideo, FramePack, Hunyuan3D, Wan and
  LTX (`test/arch-scan.test.ts:104-119`).
- Flux 2's encoder size is chosen from the file's **byte size**, not its filename
  (`archRegistry.ts:115`), explicitly rename-safe and tested (`test/gen-registry.test.ts:25`).
- **Imported upscalers are fully arch-agnostic.** `probeModels` (`discover.ts:275-323`) loads each
  file with spandrel on CPU to get its real architecture and native scale, with a 120s watchdog so
  one bad file cannot wedge a scan. Unknown-but-loadable models stay usable and are merely badged
  `experimental` (`shared/comfy.ts:57-72`); `VERIFIED_TOKENS` changes a badge, never availability.
  The code even documents the lesson at `discover.ts:205-207`: "Show every checkpoint, name-based
  filtering was unreliable." **This is the design the rest of the app should copy.**
- `scanModelFiles` (`discover.ts:243-247`) has the correct symlink-cycle guard
  (`resolve(dir)` into a `visited` set). Three sibling walkers are missing it (see §3).

### Live reconciliation
- `resolveAgainstComfy` (`preflight.ts:31-39, 77-131`) fetches `/object_info` before queueing,
  validates every node class and every CLIPLoader `type` enum value, and resolves each of our
  filesystem names to the exact string ComfyUI reports, separator- and case-insensitively. A wrong
  path separator can never reach the queue and the user gets an actionable message instead of a
  raw HTTP 400. This is rare and excellent.

### Not downloading things it does not need
- `findComfyPidWeights` (`discover.ts:214-237`) reuses a ComfyUI user's existing PiD weights with
  2 GB / 200 MB size floors, saving ~3 GB. `pythonEnv.ts:96-106` runs the spandrel sidecar in the
  user's **own** ComfyUI Python when it has torch and spandrel, so many ComfyUI users need no
  multi-GB install at all. Models are referenced in place, never copied (`comfy/store.ts:6-8`).

### Honest, up-front disclosure
- Cost and license are stated **before** the user commits: `PidUpscale.tsx:36-40` leads with
  "non-commercial use only" and "~6 GB"; `OptionsPanel.tsx:673-684` warns about the rembg
  first-run download before files are queued.
- Capability gating is real runtime probing, not assumption: `pid/gpu.ts:37-51` shells `nvidia-smi`
  and caches; a stored AI selection self-heals to a working default when it becomes invalid
  (`OptionsPanel.tsx:431-437`).
- The three best error messages in the app are the model for everything else: LibreOffice
  (`registry.ts:194-198`), uv/rembg (`registry.ts:874-878`), and the no-Vulkan-device case
  (`registry.ts:838-844`), which pattern-matches the driver error and rewrites it.

### Electron security posture
- Defaults left secure: no `nodeIntegration: true`, no `contextIsolation: false`, no
  `webSecurity: false`, zero `NODE_TLS_REJECT_UNAUTHORIZED` / `rejectUnauthorized` /
  `certificate-error` handlers. A real CSP ships (`renderer/index.html:8`,
  `default-src 'self'; script-src 'self'`). `will-navigate` is guarded on both windows. The
  markdown preview sanitizes properly (`renderer/src/lib/markdown.ts:55-70, 109-114`).
- The renderer is not trusted with model identity: `bgModelOf()` re-validates the rembg model
  against the allowlist in main (`tools/removebg.ts:18-21`), and `upscaleWithComfy` re-validates a
  renderer-supplied model path against the on-disk store (`registry.ts:739`).

### State portability
- Everything mutable lives under `app.getPath('userData')`: `session.json`,
  `comfy-upscalers.json`, the PiD env and weights, the generated extra-model-paths YAML. Nothing
  is written next to the exe. Per-user NSIS install needs no admin rights. Single-instance lock
  (`index.ts:178`), age-guarded temp sweep (`index.ts:15-31`), and `before-quit` cancels in-flight
  jobs and frees the sidecars holding VRAM (`index.ts:207-211`).

---

## 3. Blocking gaps for a fresh user

Ranked by (fresh-user impact) x (how many people it hits). Model-extensibility findings are §4.

### H1. A space in `%TEMP%` crashes every document conversion
**`src/main/tools/soffice.ts:28`** ・ severity **high** ・ breaks for: **any user whose account name
contains a space** ("John Smith"), or who redirected TEMP to a spaced path.

```ts
const profileUrl = 'file:///' + profileDir.replace(/\\/g, '/')
```

A raw string splice with no URL encoding. `registry.ts:184-191` builds the profile under
`mkdtempSync(join(tmpdir(), 'filesmith-doc-'))`, so it inherits `%TEMP%`.

Reproduced by direct execution against the repo's own `resources/libreoffice/program/soffice.com`
with the exact argv `buildSofficeArgs` emits, varying only the profile dir:

| profile URL | result |
|---|---|
| `file:///C:/.../p1/profile` | status 0, `in.pdf` written |
| `file:///C:/.../p2/pro file` | **status 3765269347 (0xE06D7363, C++ exception), no PDF, empty stdout AND stderr** |
| `file:///C:/.../p3/pro%20file` | status 0, `in.pdf` written |

Because stderr is empty, `registry.ts:202-207` falls through to the generic "LibreOffice couldn't
convert to PDF" with no diagnostic. A `#` in the profile path makes `soffice.bin` **hang
indefinitely** instead, and there is no timeout anywhere in `run.ts`. Non-ASCII is *not* affected:
accented and Cyrillic profile dirs both converted fine, so this is specifically an
unencoded-space/`#` bug, not an encoding bug.

**Fix**: `import { pathToFileURL } from 'url'` and use `pathToFileURL(profileDir).href`. Add a
test in `test/documents.test.ts` asserting `buildSofficeArgs` percent-encodes a spaced profile path.
One line, one test.

---

### H2. A build made anywhere but your machine silently ships without LibreOffice, Ghostscript or Real-ESRGAN
**`scripts/fetch-binaries.mjs:342`** and **`electron-builder.yml:26`** ・ severity **high** ・ breaks
for: **every end user of any installer built on a machine lacking those trees**, and any
contributor or CI cutting a release from a fresh clone (`resources/` is gitignored).

The build gate requires only the flat exes:

```js
const required = ['magick.exe', 'ffmpeg.exe', 'ffprobe.exe', 'caesiumclt.exe', 'mutool.exe']
```

The three tree-shaped tools are declared as `extraResources` (`electron-builder.yml:22-34`) but
never asserted. Reading `node_modules/app-builder-lib/out/fileMatcher.js` `copyFiles()`:
`if (fromStat == null) { log.warn(...); return }`. **A missing source only warns.** Meanwhile
`bundleLibreOffice` (`:150`), `bundleGhostscript` (`:182`) and `bundleRealesrgan` (`:257`) each
warn-and-return on failure. So `npm run package` exits 0 and produces a `Setup.exe` with dead AI
upscale and dead PDF compress.

LibreOffice is the deterministic case: `bundleLibreOffice` copies from
`['C:\Program Files\LibreOffice', 'C:\Program Files (x86)\LibreOffice', $LIBREOFFICE_DIR]` and has
**no download fallback at all**. Ghostscript and Real-ESRGAN do have download fallbacks
(`:215-246`, `:288-308`), so they usually survive; gs only fails when 7-Zip is also absent.

Severity nuance: LibreOffice **degrades gracefully** at runtime because `registry.ts:193-198`
catches the spawn rejection and shows a real install message. Ghostscript (`registry.ts:471`) and
Real-ESRGAN (`registry.ts:833`) have no such handling, which is finding M3.

**Fix**: extend the required-check to the trees, not just the flat exes. Assert
`resources/libreoffice/program/soffice.com`, `resources/ghostscript/bin/gswin64c.exe`,
`resources/realesrgan/realesrgan-ncnn-vulkan.exe` and at least one `models/*.param`, exiting 1 with
the same loud message. If a tree is deliberately optional for a build, make it an explicit
`--skip=<tree>` flag that **also drops the `extraResources` entry** so electron-builder never warns
past a missing source.

---

### H3. There is no way to tell Filesmith where ComfyUI is, unless you have an NVIDIA GPU and download 3 GB first
**`src/renderer/src/components/OptionsPanel.tsx:405, 974`** and **`ComfyImport.tsx:81`** ・ severity
**high** ・ breaks for: **any user whose ComfyUI is outside the ~35 guessed paths** (F:/G:/a NAS,
`C:\AI\comfy`, a OneDrive-redirected Documents, a dev checkout), and **every non-NVIDIA ComfyUI
user**, who can never reach the picker at all.

Discovery is pure path guessing, and the same literal list appears three times with drift already
visible between the copies (`discover.ts:21-36`, `discover.ts:147-148`, `pythonEnv.ts:43-44`):

```
roots = [home, Desktop, Documents, Downloads, 'C:\', 'D:\', 'E:\']
names = ['ComfyUI', 'ComfyUI-Shared', 'ComfyUI-Installs', 'ComfyUI_windows_portable', 'comfyui']
```

`ComfyUI-Shared` and `ComfyUI-Installs` are your machine's folder names.

The only `comfy:pick-folder` caller in the entire renderer is `ComfyImport.tsx:61`. That card
renders only when `category === 'comfy'`, which requires `hasNvidia`
(`OptionsPanel.tsx:405: [...UPSCALE_MODELS, ...(hasNvidia ? [UPSCALE_COMFY] : [])]`). And inside
the card, the Browse button renders only when `status.engineReady` (`ComfyImport.tsx:81`);
otherwise the user sees only "Set up upscale engine (~3 GB)". `engineReady` is
`comfyEngineReady() || comfyPythonReady()` (`ipc.ts:206`), and `comfyPythonReady` depends on the
same failed guess. **So the user whose path was not guessed must download 3 GB before the app will
let them point at the ComfyUI they already have.** That is a chicken-and-egg.

The Generate panel has no picker at all, only dead-end text (`OptionsPanel.tsx:974`): "ComfyUI
wasn't found. Open ComfyUI once so Filesmith can locate it, then reopen this." Nothing in the code
implements that: availability is a filesystem walk (`generate/comfy.ts:73-75`), never a probe of a
running server. There is no Settings screen anywhere in `src/renderer/src/components`.

`comfy:scan` (`ipc.ts:241-252`) is the **only** writer of `writeComfyStore({folder})`, and that
stored folder is the sole non-guessed input to `comfyModelsBases()` and `comfyCodeRoots()`, which
drive the entire generation feature.

**Fix**: promote "ComfyUI location" to a first-class setting, reachable from a Settings surface
**and** inline in the Generate panel whenever `generate:status.available === false`. Un-gate the
Browse button from both `hasNvidia` and `engineReady` (ComfyUI is not NVIDIA-only, and picking the
folder is what *makes* discovery work). One pick then fixes generate, upscale and companion
downloads together, since they all read the same store first.

---

### H4. ComfyUI Desktop installs can never be auto-launched, and are reported "not found" forever
**`src/main/comfy/pythonEnv.ts:86`** ・ severity **high** ・ breaks for: **anyone who installed
ComfyUI via the official Desktop installer**, precisely the non-technical target user, whenever the
Desktop app is not already running.

```ts
if (existsSync(py) && hasTorch(py) && existsSync(join(root, 'main.py'))) return py
```

This requires `main.py` in the **same root** as the interpreter. `comfyCodeRoots()`'s `add()` only
pushes `d`, `d/ComfyUI`, `d/ComfyUI/ComfyUI` (`pythonEnv.ts:38`). The Desktop layout puts a uv venv
in the user's chosen base dir while ComfyUI's source lives under the Electron app's
`resources/ComfyUI`, so no probed depth ever reaches it, even though `:49` correctly adds
`%LOCALAPPDATA%\Programs\@comfyorgcomfyui-electron`. `findComfyLaunch()` then re-derives three cwd
candidates (`generate/comfy.ts:23-29`), none containing `main.py`, and returns null.
`comfyGenerationAvailable()` is a pure filesystem check that never probes a live server, so
`generate:status.available` stays false forever and the banner never clears.

Partial mitigation worth knowing: `ensureComfyServer` **does** probe 8188 first
(`generate/comfy.ts:79-82`) and generation is not gated on `available` (`App.tsx:538` calls
`generateRun` unconditionally), so a Desktop user with the app open on 8188 can still generate. The
permanently broken parts are auto-launch and the availability notice.

**Fix**: add `resources/ComfyUI` and `resources/app/ComfyUI` to the `add()` depths, and decouple
interpreter from code root by searching for `main.py` independently under each candidate root at
bounded depth (~3). Independently, make `comfyGenerationAvailable()` also return true when a server
answers `/system_stats`.

---

### M1. ComfyUI port is fixed at 8188/8199, and the launched child's piped stdio is never read
**`src/main/generate/comfy.ts:79, 92`** ・ severity **medium, but the stdio half is a live hang**

```ts
for (const p of [8188, FS_PORT])            // FS_PORT = 8199, comfy.ts:13
proc = spawn(launch.python, args, { cwd, windowsHide: true, env })   // comfy.ts:92
```

`spawn` with no `stdio` option defaults to **pipes**. The only listener attached is
`proc.on('exit')` (`:97`). Nothing ever reads `proc.stdout`/`proc.stderr`, so once the OS pipe
buffer fills (tens of KB, which ComfyUI's model-loading logs and per-step progress exceed easily)
**the child blocks on write mid-run**. This is not a diagnostics gap, it is a deadlock for long
generations. And when the child dies instantly, the poll loop still burns the full 240s (`:104`)
before throwing "ComfyUI did not become ready in time." with no captured output. The project's own
spandrel sidecar shows the right pattern: an 800-byte stderr tail surfaced in the error
(`comfy/sidecar.ts:68-71, 91-92`).

**Fix**: attach `proc.stdout.resume()` and a stderr-tail collector immediately; include the tail in
the timeout error; bail as soon as `exit` fires instead of polling 240s. Add a "ComfyUI server URL"
setting (default `http://127.0.0.1:8188`) tried first, and bind our own launch to a free ephemeral
port instead of a fixed 8199.

---

### M2. A ComfyUI that is running right now is reported as "not found"
**`src/main/generate/comfy.ts:73`** ・ severity **medium**

```ts
export function comfyGenerationAvailable(): boolean { return findComfyLaunch() != null }
```

Pure filesystem, and this is what `generate:status` returns (`ipc.ts:258`). Meanwhile
`ensureComfyServer` (`:79-82`) happily reuses a live server the status check just declared absent.
A working `listCheckpoints(baseUrl)` that asks the live server exists at `comfy.ts:261` and is
never called. This is exactly the user the H3 banner tells to "open ComfyUI once".

**Fix**: make `generate:status` async and probe 8188 / FS_PORT / a configurable URL first; if a
server answers, report available and seed the picker from `/object_info`. Fall back to the
filesystem scan only when nothing is listening.

---

### M3. A missing bundled binary surfaces as `spawn gswin64c ENOENT` on the queue card
**`src/main/toolResolver.ts:81, 99`** → **`run.ts:40`** → **`registry.ts:106-114`** →
**`jobQueue.ts:100`** ・ severity **medium**, conditional on H2

`resolveGhostscript()` returns the bare `'gswin64c'` when the bundled tree is absent; same for
Real-ESRGAN (`:99`). `run()` does `child.on('error', reject)` with Node's raw error,
`runToOutput` rethrows unchanged, and `jobQueue.ts:100` emits `(err as Error).message` straight
into the failed row. `describeToolError` (`registry.ts:132`) only parses stderr from a process that
actually started, so it never sees a spawn failure. There is no startup preflight:
`index.ts` `whenReady` (`:189-199`) only sweeps temp dirs, registers the media protocol and creates
the window. `checkTool` **is** exposed (`preload/index.ts:76`, `ipc.ts:99`) and has **zero callers**
in the renderer.

**Fix**: catch the spawn error in `run.ts` and rethrow a typed `ToolMissingError` carrying the tool
id; map it in `registry.ts` to the same style of message the LibreOffice path already uses. Better,
run a one-shot startup probe that disables affected operations in the UI rather than letting a
200-file queue fail one row at a time.

---

### M4. `resolveUv()` cannot see the uv the app itself downloaded
**`src/main/toolResolver.ts:159`** ・ severity **medium** ・ breaks for: a fresh user with no uv, and
provably **any user who already completed the PiD install**.

The doc comment at `:158` says "winget's package dir, the standard user install, **or PATH**". The
body checks three fixed paths and returns null. No PATH probe exists anywhere. The sharper gap:
`pid/install.ts:196-213` `ensureUv()` **already downloads a pinned standalone uv** into
`<pidRoot>/uv/uv.exe` when `resolveUv()` returns null, and `resolveUv()` never checks that
location. So a user who sat through a 6 GB PiD install is still told
"Background removal needs uv... `winget install astral-sh.uv`" (`registry.ts:874-877`). The winget
candidate is also hardcoded down to the package family hash
`astral-sh.uv_Microsoft.Winget.Source_8wekyb3d8bbwe`.

**Fix**: extract `ensureUv` into a shared `src/main/uv.ts`; add `join(pidRoot(), 'uv', 'uv.exe')` as
a candidate; probe the bare name once (`run('uv', ['--version'])`, cached). Then give Remove
Background a "Set up background removal (one-time download)" button using the same progress modal
instead of asking a non-technical user to open a terminal. Enumerate
`%LOCALAPPDATA%/Microsoft/WinGet/Packages/*` for a dir starting `astral-sh.uv_` rather than
hardcoding the hash.

---

### M5. Three of the four recursive model walks have no symlink-cycle guard, and the scan blocks the main process
**`src/main/generate/models.ts:35`**, **`archRegistry.ts:152-177`**, **`comfy/discover.ts:188-209`** ・
severity **medium**

`walkModels`'s inner `walk()` recurses on `st.isDirectory()` with `seen` keyed by the lower-cased
**relative** name, which keeps growing on each loop iteration and therefore never stops the
recursion. Junctioning a shared models folder (routine when two ComfyUI installs share weights)
hangs the app. `scanModelFiles` (`discover.ts:243-247`) has the correct pattern the other three
are missing. All of it runs synchronously inside `ipcMain.handle('generate:status')` with a
`readSafetensorsHeader` per checkpoint over the ~180 candidate bases `comfyModelsBases()` returns.

**Fix**: add the `visited` / `resolve()` guard to all three, cap depth at ~4, move the scan off the
main thread, and cache keyed on directory mtimes.

---

### M6. No install lock: two concurrent installs destroy each other
**`src/main/ipc.ts:182, 221`** ・ severity **medium**

Neither `pid:install` nor `comfy:install` has in-flight dedupe or a module-level lock, and both
write the **same fixed temp paths**: `pid-src.zip` (`install.ts:137`), `_extract` (`:144`, rmSync'd
at `:145` and `:154`), `uv.zip` (`:205`), plus `rmSync(pidRepoDir())` at `:152` and `uv venv` at
`:228`. The only guards are renderer-local React state (`PidUpscale.tsx:15`, `ComfyImport.tsx:66`),
and `PidInstallCard` is conditionally mounted (`OptionsPanel.tsx:477-481`), so navigating away and
back during a multi-GB install resets the flag and re-enables the button.

**Fix**: module-level `let inFlight: Promise<void> | null` in `install.ts` shared by both entry
points (they share every phase anyway); `mkdtempSync` per run instead of fixed temp names.

---

### M7. No disk-space preflight, no resumable downloads, no repair path
**`src/main/pid/install.ts:295`** ・ severity **medium**

`installPid` goes straight from `mkdirSync(pidRoot())` into the phases with no space check
(`grep freeSpace|statfs` returns nothing). A full disk surfaces as whatever the write stream throws.
Neither downloader sends a `Range` header or reuses an existing part file: both open with
`rmSync(part, { force: true })`, so a 2.6 GB checkpoint that drops at 95% restarts from zero, every
time. `PidUpscale.tsx:39` honestly advertises "~6 GB" but nothing checks whether it fits.

Worse, there is **no repair path**: grep for `repair|reinstall|uninstall|rmSync(pidRoot` across
`src/` finds no reset action anywhere. `pidInstalled()` returns true on mere `existsSync`
(`paths.ts:94-104`), so a poisoned install (a captive-portal block page whose Content-Length
matches its body, passing the `got < total` check at `install.ts:111`) is permanently
unrecoverable from the UI.

**Fix**: sum the requirement (env ~3 GB + `bb.approxBytes`, already populated at `paths.ts:89` and
**never read anywhere**) against `fs.statfs` on the userData volume and refuse with "PiD needs about
10 GB free on C:, you have 4 GB". Keep the `.part`, `stat` it, send `Range: bytes=<size>-`. Add a
visible "Repair / remove AI install" button that does `rmSync(pidRoot(), {recursive: true, force: true})`.

---

### M8. `pid/install.ts` forks a weaker downloader than the one in the same repo
**`src/main/pid/install.ts:83`** ・ severity **medium**

`install.ts:70-120` is a private copy of `net/download.ts` missing all three of that file's guards:
no 401/403 license message, no HTML/JSON-as-200 rejection, no `minBytes` floor. It is what fetches
the 2.6 GB checkpoint (`:287`) and 320 MB VAE (`:278`). Meanwhile `PidBackbone.approxBytes` exists
and is populated and is never read by anything.

**Fix**: delete the private `download()` and call `downloadFile` from `net/download.ts` with
`minBytes = Math.floor(bb.approxBytes * 0.9)`. Strictly less code.

---

### M9. Downloads use Node's undici `fetch`, not Electron's `net.fetch`
**`src/main/net/download.ts:33`**, **`pid/install.ts:83`** ・ severity **medium**

Both are the Node global: no system-proxy support, and TLS validated against Node's bundled CA list
rather than the Windows certificate store. `grep -i 'net\.fetch|proxy|setProxy|HTTPS_PROXY'
src/main` returns zero hits. On a corporate machine behind a TLS-inspecting gateway the install can
never succeed. And the error reaches the user verbatim: undici's rejection message is literally
`fetch failed`, with the real code hidden in `.cause`, so **every user whose wifi is off sees only
"fetch failed"**. Note the inconsistency this creates: the `uv pip install` phases
(`install.ts:233-253`) run in a subprocess that **does** honour proxy env vars, so the pip half can
work while our own fetch fails.

**Fix**: `import { net } from 'electron'` and use `net.fetch` in both downloaders (Electron
documents it for exactly this). Map `err.cause.code`: `ENOTFOUND`/`ECONNREFUSED` to "Could not
reach <host>, check your internet connection or proxy";
`UNABLE_TO_VERIFY_LEAF_SIGNATURE`/`SELF_SIGNED_CERT_IN_CHAIN` to "Your network inspects HTTPS
traffic, ask IT to allow huggingface.co and github.com".

---

### M10. No integrity verification on anything downloaded, including code that gets executed
**`src/main/net/download.ts:15`**, **`pid/install.ts:70`** ・ severity **medium/high**

`grep -riE "sha256|checksum|createHash|integrity|signature" src/` returns exactly one hit, an
unrelated comment. The artifacts so fetched are **executed**: `uv.exe` (downloaded `:206`,
extracted `:209`, spawned at `:228/233/250/313`), and the PiD source zip (`:138`) which is installed
with `uv pip install -e .` (`:250`), running upstream's build backend, then put on `PYTHONPATH` for
the sidecar (`pid/sidecar.ts:94`).

Two honest caveats that keep this at medium rather than critical. All transfers are HTTPS to
`github.com` / `huggingface.co` / `download.pytorch.org`, so plain in-transit tampering already
needs a trusted-CA MITM. And a substituted PiD `.pth` weight is **not** code execution: the
repo's loader (`pid/_ext/imaginaire/utils/checkpointer.py:229`) calls plain `torch.load`, and the
pinned `torch==2.10.0` defaults `weights_only=True`. The real exposure is the unpinned repo zip
(§4) and the general absence of defence in depth.

**Fix**: ship an `artifacts.json` of `{url, bytes, sha256}`; tee the existing pipeline through
`crypto.createHash('sha256')` and refuse the rename on mismatch. **This is also the mechanism that
makes a data-driven model list safe**, so it is a prerequisite for §5, not an optional extra.

---

### M11. The GPU gate is "nvidia-smi answered", with no compute-capability or driver floor
**`src/main/pid/gpu.ts:41`** ・ severity **medium**

`detectNvidia` queries only `name,memory.total`; `hasNvidia()` is `detectNvidia() != null`; that is
the **only** gate on offering the AI-models tier (`OptionsPanel.tsx:393, 405`), whose
`ComfyImportCard` install button triggers a ~3 GB `torch==2.10.0 --index-url .../cu128` install
(`install.ts:236-244`) with no fallback index and no driver check. A GTX 10xx (Pascal) owner waits
through the whole download and then hits a CUDA kernel-image error. VRAM is advisory and after the
fact (`OptionsPanel.tsx:419`, note only).

Correction to a common framing: PiD itself is only offered to users who already have PiD weights in
ComfyUI (`OptionsPanel.tsx:409`), so the unguarded entry point is the **ComfyUI engine setup**, not
PiD.

**Fix**: extend the query to `name,memory.total,compute_cap,driver_version` (`parseNvidiaSmi` is
pure and already unit-tested in `test/pid.test.ts`), gate the tier on `compute_cap >= 7.5` plus a
driver floor, and say "PiD needs an RTX-class NVIDIA GPU (your <name> is not supported)" **before**
any download. Move the torch spec and index URL into the manifest so a cu126/cu130 variant can be
chosen per machine.

---

### M12. Zero test coverage for dependency and model resolution
**`test/`** ・ severity **medium**

Grepping all 15 test files for `resolveUv`, `resolveTool`, `resolveSoffice`, `resolveGhostscript`,
`resolveRembg`, `removebgStatus`, `findComfyLaunch`, `comfyCodeRoots`, `guessComfyFolder`,
`comfyModelsBases`, `scanGenerationModels`, `resolveArch` and `toolAvailable` returns **zero
matches**. The only discovery test is pure path math on a temp fixture (`comfy.test.ts:7`). The
suite passes on any machine precisely because it never exercises the machine-dependent code, which
is the exact code that differs between your machine and everyone else's.

**Fix**: these functions are nearly pure over env vars plus fs. Add fixture-tree tests stubbing
`HOME`/`APPDATA`/`LOCALAPPDATA` into a temp dir: a ComfyUI at an arbitrary path is found via the
remembered store; `resolveArch()` reports missing companions against a fake models tree;
`resolveUv()` finds a uv on PATH; `resolveSoffice`/`resolveGhostscript` honour `ProgramFiles`.

---

### Low-severity, worth a cleanup PR
- **`toolResolver.ts:181`** `toolAvailable()` probes with `-version`, which two of the four bundled
  tools reject. Verified against the repo's own binaries: `magick -version` → 0,
  `ffmpeg -version` → 0, **`mutool -version` → exit 1** (prints usage), **`caesiumclt -version` →
  exit 2** ("unexpected argument '-v'"). Correct probes: `mutool -v`, `caesiumclt --version`. Dead
  code today (zero renderer callers), but it is the foundation of the M3 preflight.
- **`toolResolver.ts:43-48, 70`** and **`fetch-binaries.mjs:157-159, 196, 216-219`** hardcode
  `C:\Program Files`. Build from `process.env.ProgramFiles` / `ProgramFiles(x86)` / `ProgramW6432`,
  keeping the literals as fallback. (Note: Windows localizes only the *display* name; the on-disk
  path is always `\Program Files`. The real case is a non-C: system drive.) `pid/install.ts:58`
  already does this correctly with `process.env.SystemRoot`.
- **`generate/comfy.ts:54`** writes `base_path: ${d}` as a bare YAML scalar. A space followed by
  `#` starts a YAML comment, so `D:\AI #2\ComfyUI` silently truncates and ComfyUI then sees none of
  the user's models, with preflight blaming an already-running ComfyUI. Emit a double-quoted
  scalar. (A `:` in the path is impossible on Windows; encoding is already fine via `PYTHONUTF8=1`.)
- **`index.ts:151`** main window's `setWindowOpenHandler` passes `details.url` to
  `shell.openExternal` with no scheme allowlist. Not reachable today (CSP is `script-src 'self'` and
  the main window renders no untrusted markup), but `previewWindow.ts:54-57` already does it right
  in one line. Copy that.
- **`fetch-binaries.mjs:94`** uses the **rolling** `ffmpeg-release-essentials.zip`, whose contents
  change with every release, and no download in the file computes a hash. Ghostscript (`:227`) and
  Real-ESRGAN (`:290`) *are* pinned, so ffmpeg is the only floating URL. `bundleImageMagick`,
  `bundleCaesium`, `bundleMutool` and `bundleLibreOffice` all source from a **local install found
  via `which()`**, so the shipped bytes depend on your winget state and a bare CI runner cannot
  reproduce the build.
- **`comfy/discover.ts:11`** `MODEL_EXTS` includes `.pt`. Reading the installed spandrel loader:
  `.pth`/`.ckpt` go through `pickle_module=RestrictedUnpickle` (safe) and `.safetensors` through
  `load_file` (safe), but **`.pt` goes to `torch.jit.load` with no restriction**. A bulk scan loads
  every `.pt` in the folder, including ones the user never selected. Drop `.pt` from the bulk scan
  and make it an opt-in per-file confirmation.
- **`pythonEnv.ts:43`** auto-discovers and later spawns `python.exe` under `C:\`, `D:\`, `E:\`,
  `Downloads` and `Desktop`. `icacls C:\` on this machine returns
  `NT AUTHORITY\Authenticated Users:(AD)`, so a non-elevated process can create `C:\ComfyUI\`.
  Execution requires the user to trigger Scan/upscale/Generate (status checks spawn nothing), and
  an attacker who can write to disk usually already has execution, so this is defence in depth. But
  once the folder picker from H3 exists, **drop the drive roots, Downloads and Desktop from implicit
  discovery** and confirm the first spawn of any newly-discovered interpreter, remembered per path.

---

## 4. Model staleness: the real problem

This is your central worry, and it is correctly placed. Here is the **actual path a user must
follow today** to add a new model, per type. I walked each one in the code.

### 4a. A new ComfyUI checkpoint of a known family (a new Flux 1 finetune, a new SDXL merge)
1. Drop the file in `ComfyUI/models/checkpoints/` or `diffusion_models/`.
2. Reopen the Generate panel.
3. It works.

**This case is already solved and you should be proud of it.** `readSafetensorsHeader` +
`classifyArch` (`archScan.ts:21, 76-105`) identify it by tensor keys, `resolveArch` finds the
companions, and the rename-safe byte-size check picks the right Flux 2 encoder. Zero code change.

### 4b. A new checkpoint **family** (SD3.5, Qwen-Image, Chroma, HiDream, whatever ships next month)
1. Drop the file in `diffusion_models/`.
2. `classifyArch` returns `'unknown'` (or `'sd3'`).
3. `models.ts:111-114`: `if (!SUPPORTED.includes(arch)) { unrecognized += 1; continue }`.
   **The file is never pushed into the list.** It is invisible except as a counter.
4. There is no override, no "try anyway", no workflow import. `generateImages` throws on
   `!gm.runnable` before ever contacting ComfyUI (`generate/index.ts:55-60`).
5. The user's only recourse is to wait for you to ship a new Filesmith build.

Adding that family requires editing **six places**, none of which is data:
- `src/shared/genArch.ts:14` the `GenArch` union
- `src/shared/genArch.ts:32` `ARCH_INFO` (sampler, scheduler, steps, cfg, guidance)
- `src/shared/genArch.ts:152/188/222/255` a hand-written API-format graph, plus the
  `buildDiffusionWorkflow` switch at `:326-337` whose `default:` **throws**
- `src/main/generate/archRegistry.ts:81-145` `requiredCompanions` with pinned filenames and URLs
- `src/main/generate/models.ts:16` `SUPPORTED`
- `src/main/generate/preflight.ts:42-47` `CLIP_REQ` (loader + `type` enum literal) and `:50-56`
  `EXTRA_NODES`

Node class names, sampler names and magic constants are baked into the graphs
(`ModelSamplingAuraFlow` with `shift: 3` at `genArch.ts:227`). **Nothing reads a workflow from
disk**: grep shows no JSON or YAML workflow source anywhere in `src/`. And if ComfyUI renames a node
or a CLIPLoader `type` enum value, `preflight.ts:104` raises `missingNodeError`, which returns
`ARCH_INFO[arch].minComfyNote`, i.e. **a fresh fully-updated ComfyUI is told to "update ComfyUI"**.

Also, the eight companion URLs are all `resolve/main` (a moving branch), e.g.
`archRegistry.ts:47`, `:61`, `:96`, `:124`. The day Comfy-Org reorganizes a repo or moves a file out
of `split_files/`, `download.ts:39` throws `Download failed (404)`, the CompanionDownload card shows
it with only a retry button, and the model stays non-runnable forever. There is no mirror list, no
user-supplied URL, and no "I already have this file, point at it" picker anywhere in the flow.

### 4c. A new upscaler architecture (DAT, SPAN, ATD, RealPLKSR, SeedVR, the 2026 arch)
**Via ComfyUI import**: 1. Drop the file in `models/upscale_models/`. 2. Click Rescan. 3. spandrel
probes it and it works, badged "experimental". **This path is genuinely arch-agnostic and needs no
code change.** Excellent.

**But** it is gated three ways: it needs an NVIDIA GPU (`OptionsPanel.tsx:405`), a ComfyUI install,
and either the user's own torch+spandrel Python or a 3 GB engine download. And `install.ts:305-319`
freezes spandrel forever: `if (existsSync(spandrelMarker())) return`, installing `spandrel>=0.4.1`
resolved **on whatever day the user set up**, with the marker recording no version. A user on
Filesmith's own venv who later downloads a model with a newer architecture gets
`{ ok: false, reason: 'could not be read' }` (`discover.ts:313`) and **there is no UI to update the
loader**: `ComfyImport.tsx:81` shows the setup button only when `!engineReady`, and the ready branch
offers only Change folder / Rescan. (Users on their own ComfyUI Python escape this, since
`pythonEnv.ts:98-99` prefers it and they keep ComfyUI updated.)

**Via the bundled Real-ESRGAN (the only cross-vendor path, and the only one an AMD/Intel user has)**:
There is no path. `fetch-binaries.mjs:255` fixes at **build time** which two model files ship;
`upscale.ts:13` repeats the same two names; `shared/compress.ts:70-73` `UPSCALE_MODELS` is a closed
union of `'photo' | 'anime'`. I grepped every `readdirSync` in `src/main` (`index.ts:19`,
`toolResolver.ts:72`, `registry.ts:374`, `comfy/discover.ts`, `generate/models.ts`) and **nothing
ever reads `resources/realesrgan/models`**, even though `registry.ts:828-832` passes it as `-m`.
The ncnn binary would happily run any `.param`/`.bin` pair dropped in there, on any Vulkan GPU
including AMD. Nothing looks.

### 4d. A new rembg model (a new BiRefNet generation, BEN2, RMBG-3)
1. There is no UI. Grepping the entire renderer for `bgModel` returns **zero hits**.
2. `shared/removebg.ts:22` is a four-value compile-time union; `tools/removebg.ts:18-21` clamps
   anything else back to the default.
3. `toolResolver.ts:120` pins `rembg[cli,cpu]==2.0.75`, freezing the session catalogue at that
   release.

Two mitigations worth stating fairly. The pin is **not** permanent: `resolveRembg()` prefers an
already-installed uv tool at `%APPDATA%/uv/tools/rembg` with no version constraint
(`toolResolver.ts:149-150`), so a user who runs `uv tool install rembg` gets the newer binary. And
the allowlist is a **deliberate, documented licensing boundary** (`shared/removebg.ts:1-12` cites
bria-rmbg CC BY-NC, u2net_human_seg's Supervisely provenance, isnet-anime's scraped provenance),
not an oversight. It must stay a vetted list. What genuinely rots is that the vetted list lives in
compiled code with no data-driven override.

### 4e. A new PiD backbone
1. There is no UI and no path. `paths.ts:84-91` has exactly one entry, commented "Only flux is wired
   for now".
2. The identity is hardcoded across four files, **including the IPC boundary**: `ipc.ts:180`
   `pidInstalled('flux')`, `:184` `installPid('flux', ...)`, `:212` `PID_BACKBONES.flux.checkpointDir`.
3. The weight filename `model_ema_bf16.pth` appears literally at `paths.ts:101`, `install.ts:281`,
   `install.ts:287` and `comfy/discover.ts:231`.
4. `install.ts:31` `HF_BASE = 'https://huggingface.co/nvidia/PiD/resolve/main'`, a branch, not a
   revision. An upstream rename 404s every install.
5. `install.ts:30` fetches `.../PiD/archive/refs/heads/main.zip`, **the head of a moving branch**,
   with a hard `PiD-main` folder assumption (`:150-151`) and a `pyproject` regex rewrite (`:162-168`).
   `REPO_MARKER` (`:135, :170`) is an **empty file recording no version**, so a vendored copy is
   never refreshed. Two users installing a month apart run different code with no way to tell which,
   and neither can ever receive a fix.
6. `resources/pid/pid_server.py:42-44` imports `pid._src.inference.cli_utils/decoder/inference_utils`,
   the **underscore-private** modules of that moving branch, and `:87` reads
   `model.config.input_caption_key`. The day nv-tlabs refactors `_src`, every new install breaks.

### Where the path rots: the summary table

| Bound thing | File:line | Rots when |
|---|---|---|
| `GenArch` union | `shared/genArch.ts:14` | any new checkpoint family ships |
| `SUPPORTED` allowlist | `generate/models.ts:16` | same; file becomes invisible |
| Workflow graphs + builder switch | `shared/genArch.ts:152-337` | ComfyUI renames a node |
| `CLIP_REQ` / `EXTRA_NODES` | `generate/preflight.ts:42-56` | ComfyUI renames a loader `type` enum |
| 8 companion URLs on `resolve/main` | `generate/archRegistry.ts:36-136` | HF repo reorg or rename |
| Companion filename regexes | `generate/archRegistry.ts:33-133` | a user's file is named differently |
| ncnn model names (build + runtime) | `fetch-binaries.mjs:255`, `upscale.ts:13` | any new ncnn upscaler |
| `VERIFIED_TOKENS` badge list | `shared/comfy.ts:32` | any upscaler released after this build |
| rembg sessions + version pin | `shared/removebg.ts:22`, `toolResolver.ts:120` | any new matting model |
| PiD backbone table + IPC literals | `pid/paths.ts:84`, `ipc.ts:180-212` | any new NVIDIA checkpoint |
| PiD repo `heads/main.zip` + empty marker | `pid/install.ts:30, 135, 170` | upstream touches `_src` |
| spandrel frozen by version-less marker | `pid/install.ts:305-319` | any new upscaler arch |
| Dimension clamp 2048, SDXL bucket list | `shared/generate.ts:89-103` | a model with a higher native res |
| torch pin + cu128 index | `pid/install.ts:236-244` | a non-12.8 CUDA generation |

Thirteen of those fourteen rows are fixed by one mechanism. Build it once.

---

## 5. Proposed design: a user-extensible model layer

**The decision: model identity becomes data, on disk, in three merged layers, and the app stops
hardcoding names. Unknown models are always shown and always attemptable. Every downloadable
artifact carries a sha256. This is one subsystem, not a rewrite.**

### 5.1 Where it lives and how it merges

Three layers, merged by `id`, later layers winning field-by-field:

```
1. BUILT-IN     <app>/resources/registry/*.json        read-only, ships in the installer
2. CHANNEL      %APPDATA%/Filesmith/registry/channel/  OTA-refreshed cache, signed
3. USER         %APPDATA%/Filesmith/registry/user/     the user's own entries, never touched
```

Rules, non-negotiable:
- **An app update replaces layer 1 only.** It can never read, write or delete layer 3. This is the
  whole point.
- **A channel refresh replaces layer 2 wholesale**, only after signature verification. If the
  signature fails or the network is down, layer 2 is kept as-is and the app runs on 1+3. Offline is
  a first-class state, not an error.
- **Merge is per-`id`, per-field.** A user entry with `{"id": "flux2", "companions": [...]}`
  overrides only the companions of the built-in `flux2` and inherits its workflow. This is how a
  user fixes a dead HF URL in 30 seconds without understanding the rest.
- Each file is `{ "schemaVersion": 1, "entries": [...] }`. On load, entries whose
  `schemaVersion` exceeds the app's are **skipped with a visible note**, never crash the load.
  A malformed file disables *that file* and surfaces a warning, never bricks the registry.
- `readComfyStore` / `writeComfyStore` (`comfy/store.ts`) is already exactly this pattern at 45
  lines. Generalize it; do not invent something new.

### 5.2 Capability descriptors, not name allowlists

The core inversion. Today the app asks "is this model's name in my list?". It should ask
"**what can this file do, and do I have a runner that can do that?**".

An entry declares **capabilities** and **requirements**:

- `detect`: how to recognize this family from the file itself (tensor-key substrings, metadata
  regex, byte-size ranges). Never a filename.
- `capabilities`: `{ task: 'text-to-image', minDim, maxDim, dimStep, sizeBuckets }` for generation;
  `{ task: 'upscale', scales: [2,3,4], inputFormats: [...] }` for upscalers. This kills the global
  2048 clamp (`shared/generate.ts:100`) and the SDXL-only bucket list.
- `requires`: `{ nodes: [...], clipLoader: {node, type}, gpu: {vendor, minComputeCap, minVramMb} }`.
  Preflight already validates all of this against `/object_info` (`preflight.ts:77-131`); it just
  reads the list from data instead of `CLIP_REQ`/`EXTRA_NODES`.
- `workflow`: an API-format graph with `${...}` placeholders. This is what makes a new family a
  file drop instead of a release.
- `companions`: role, subdir, an **identify-by-content** signature, and a download descriptor with
  **mirrors** and a **mandatory sha256**.

### 5.3 Probe first, name never, user overrides anything

Priority order for identifying any model file:

1. **Content probe.** `readSafetensorsHeader` (`archScan.ts:21`) for generation models, spandrel
   `probeModels` (`discover.ts:275`) for upscalers, an ncnn `.param` header read for Real-ESRGAN
   models. Both primitives already exist and are already tested.
2. **Declared metadata** (`modelspec.architecture`), already preferred at `archScan.ts:72`.
3. **Byte-size discrimination**, already used correctly for Flux 2's encoder (`archRegistry.ts:115`).
4. **Filename hint**, last and advisory only. Today it is load-bearing for companions
   (`archRegistry.ts:33-133`), which is why a user with `flux1-ae.safetensors` or
   `t5-xxl_fp16.safetensors` re-downloads gigabytes they already have.
5. **User override**, which beats all of the above. Any inferred field (arch, scale, companion path,
   sampler defaults) is editable in the UI and persisted as a user-layer entry keyed on the file's
   sha256-of-first-1MB plus size, so a rename does not lose it.

### 5.4 The unknown-model fallback (mandatory)

**No model file is ever invisible.** Delete `models.ts:111-114`'s `continue`. Replace with:

- Unknown generation model: listed, badged `unknown architecture`, with a **"Try anyway"** action
  that runs the generic `CheckpointLoaderSimple` graph (or a user-selected workflow template) and
  surfaces ComfyUI's own error verbatim. The user learns something either way.
- Unknown upscaler: already correct, keep it (`experimental` badge, fully usable).
- GGUF and non-image exclusions: **render the counts**. `models.ts:102-110` computes `gguf` and
  `excluded` and both fields reach the renderer, but a grep of `src/renderer` for either returns
  nothing, so a GGUF-only user is told "No image models found" while `diffusion_models` is full.
  Three lines beside the existing `unrecognized` line at `OptionsPanel.tsx:991`.
- Non-image exclusion becomes **advisory**, not terminal: `archScan.ts:119` keys on
  `patch_embedding` + `time_embedding`, which are generic DiT names. List it as "looks like a
  video/3D model, not recommended" and let the user pick it anyway.

The rule: **the app's job is to make the good path obvious, not to make the unusual path
impossible.**

### 5.5 The "add a model" UX

One entry point, reachable from the Generate panel, the Upscale panel and Settings:

**Add a model** →
- **Point at a file or folder.** App probes it, shows what it inferred (architecture, scale,
  detected companions, missing companions), lets the user correct any field, then registers a user
  entry. This is the 90% case and needs no network.
- **Paste a URL.** App fetches it (through `net.fetch`, with the `.part`/rename/minBytes discipline
  already in `download.ts`), computes the sha256 **while streaming**, shows the hash and the host,
  and asks for confirmation before registering. The recorded hash becomes the entry's integrity
  anchor for every future re-download.
- **Paste a ComfyUI workflow (API format).** The single highest-leverage addition. ComfyUI's own
  "Save (API format)" export, schema-validated, placeholders detected, registered as a workflow for
  a new or existing arch. A user who can already generate a model in ComfyUI can now generate it in
  Filesmith. No app update, no understanding of Filesmith internals.

### 5.6 Security for user-added models

This is where a data-driven registry earns its keep or becomes a liability. Non-negotiables:

- **Never execute anything that came from a model or a ComfyUI response.** Today this is already
  true and must stay true: generated images are pulled as **bytes** over `/view` with URL-encoded
  params (`generate/comfy.ts:249-258`) and written through `reserveOutPath`. No path from ComfyUI
  is ever used to read or write a file directly. Keep that invariant explicit in the manifest
  loader's doc comment so nobody regresses it.
- **A workflow template is data, never code.** JSON only, `JSON.parse`, no `eval`, no function
  strings, no `require`. Validate it is an object of `{class_type, inputs}` nodes and that every
  `${placeholder}` is in the known set. Only ever POST it to a loopback address.
- **Path constraints on every registry-supplied path.** `subdir` must be in a fixed enum
  (`text_encoders`, `clip`, `vae`, `checkpoints`, `diffusion_models`, `unet`, `upscale_models`).
  `filename` must match `/^[A-Za-z0-9._-]+$/` with **no separators and no `..`**. This is not a
  live defect today (both are compile-time constants), but the moment the manifest is user- or
  network-editable, `join(root, f.subdir, f.filename)` (`companions.ts:53`) becomes a traversal
  sink. Enforce it in the loader, once, before any entry is trusted.
- **`sha256` mandatory on every `download` descriptor**, verified while streaming, `.part` discarded
  on mismatch. Absent hash means the entry is loadable but its downloads are **blocked with an
  explicit "this entry has no integrity hash" warning**, not silently allowed.
- **Host allowlist plus `https:` only** for layer-1 and layer-2 URLs. A layer-3 (user) URL outside
  the allowlist is permitted but shows an unmissable "you added this source" provenance banner and
  requires an explicit confirm. The user is allowed to take risks with their own machine; they are
  not allowed to be surprised.
- **Channel signing.** Layer 2 is verified with an Ed25519 signature over the manifest bytes using a
  public key compiled into the app. No signature, no trust, keep the previous cache. A ~40-line
  addition using Node's built-in `crypto.verify`, no dependency.
- **Safe extraction.** Keep `System32\tar.exe` by full path (`install.ts:50-59`), which is
  deliberate and correct: long-path support and immunity to a GNU tar earlier on PATH. Add an
  explicit reject of entries with `..` or absolute paths rather than relying on bsdtar's default.
- **Provenance shown in the UI, always.** Every model row displays its layer (Built-in / Channel /
  Added by you), its source host, and whether its hash is verified. A user should never have to
  wonder where a model came from. This is also what makes the "experimental" badge meaningful
  instead of decorative.
- **Formats stay tiered.** `.safetensors` is the default and the only one auto-loaded in bulk;
  `.pt` (which reaches unrestricted `torch.jit.load`) is excluded from bulk scans and requires a
  per-file confirmation. Assert the probing env's spandrel version before probing anything but
  `.safetensors`.

### 5.7 How built-in defaults update independently of the app binary

- Layer 1 ships in the installer, so a fully offline fresh install has a complete working catalog.
  **Offline is never degraded relative to today.**
- Layer 2 refreshes from a URL you control (a GitHub Pages JSON is enough), checked at most once a
  day, in the background, non-blocking, failing silently into "keep what we have". Signature
  verified before it replaces the cache.
- **This is your remote lever.** The day Comfy-Org moves `t5xxl_fp8_e4m3fn_scaled.safetensors`, you
  push a one-line channel update and every existing install is fixed within a day. No release, no
  signing, no download prompt. That single capability is worth the whole subsystem.
- Layer 3 never expires and is never overwritten. A user's hand-added model survives every app
  update and every channel refresh, forever.

### 5.8 Concrete example: one registry entry

`%APPDATA%/Filesmith/registry/user/z-image.json` (identical shape to the shipped
`resources/registry/gen-archs.json`):

```json
{
  "schemaVersion": 1,
  "entries": [
    {
      "id": "z-image",
      "kind": "generate",
      "label": "Z-Image Turbo",
      "group": "Z-Image",
      "provenance": { "source": "builtin", "addedAt": "2026-01-14T00:00:00Z" },

      "detect": {
        "metaArch": ["z-image", "zimage"],
        "tensorKeys": { "all": ["cap_embedder", "noise_refiner"], "none": ["double_blocks"] },
        "sizeBytesRange": [4000000000, 14000000000]
      },

      "capabilities": {
        "task": "text-to-image",
        "minDim": 256, "maxDim": 2048, "dimStep": 64,
        "sizeBuckets": [[1024,1024],[1152,896],[896,1152],[1216,832],[832,1216]]
      },

      "sampler": {
        "name": "res_multistep", "scheduler": "simple",
        "steps": 8, "cfg": 1, "guidance": 0, "hasGuidance": false
      },

      "requires": {
        "nodes": ["UNETLoader","CLIPLoader","VAELoader","CLIPTextEncode",
                  "ModelSamplingAuraFlow","ConditioningZeroOut","EmptySD3LatentImage",
                  "KSampler","VAEDecode","SaveImage"],
        "clipLoader": { "node": "CLIPLoader", "type": "lumina2" },
        "minComfyNote": "Z-Image needs ComfyUI v0.6.0+ (late November 2025)."
      },

      "companions": [
        {
          "role": "clip",
          "label": "Qwen3-4B text encoder",
          "subdir": "text_encoders",
          "identify": {
            "tensorKeys": { "any": ["model.layers.0.self_attn.q_proj.weight"] },
            "sizeBytesRange": [7000000000, 9000000000],
            "nameHint": "qwen.?3.?4b"
          },
          "download": {
            "filename": "qwen_3_4b.safetensors",
            "bytes": 8054337536,
            "sha256": "0000000000000000000000000000000000000000000000000000000000000000",
            "urls": [
              "https://huggingface.co/Comfy-Org/z_image_turbo/resolve/a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0/split_files/text_encoders/qwen_3_4b.safetensors",
              "https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/text_encoders/qwen_3_4b.safetensors"
            ]
          }
        },
        { "role": "vae", "ref": "flux-ae" }
      ],

      "workflow": {
        "format": "comfy-api-v1",
        "template": {
          "1": { "class_type": "UNETLoader",
                 "inputs": { "unet_name": "${unet}", "weight_dtype": "default" } },
          "2": { "class_type": "CLIPLoader",
                 "inputs": { "clip_name": "${clip}", "type": "lumina2", "device": "default" } },
          "3": { "class_type": "VAELoader", "inputs": { "vae_name": "${vae}" } },
          "4": { "class_type": "ModelSamplingAuraFlow",
                 "inputs": { "model": ["1", 0], "shift": 3 } },
          "5": { "class_type": "CLIPTextEncode",
                 "inputs": { "clip": ["2", 0], "text": "${prompt}" } },
          "6": { "class_type": "ConditioningZeroOut", "inputs": { "conditioning": ["5", 0] } },
          "7": { "class_type": "EmptySD3LatentImage",
                 "inputs": { "width": "${width}", "height": "${height}", "batch_size": 1 } },
          "8": { "class_type": "KSampler",
                 "inputs": { "model": ["4", 0], "positive": ["5", 0], "negative": ["6", 0],
                             "latent_image": ["7", 0], "seed": "${seed}",
                             "steps": "${steps}", "cfg": "${cfg}",
                             "sampler_name": "${sampler}", "scheduler": "${scheduler}",
                             "denoise": 1 } },
          "9": { "class_type": "VAEDecode", "inputs": { "samples": ["8", 0], "vae": ["3", 0] } },
          "10": { "class_type": "SaveImage",
                  "inputs": { "images": ["9", 0], "filename_prefix": "${prefix}" } }
        }
      }
    }
  ]
}
```

An upscaler entry is much smaller, and shows the same schema covering the ncnn case that has no
extensibility at all today:

```json
{
  "id": "realesrgan-animevideov3",
  "kind": "upscale",
  "runner": "realesrgan-ncnn",
  "label": "Real-ESRGAN anime video v3",
  "provenance": { "source": "user", "addedAt": "2026-07-31T09:12:00Z" },
  "detect": { "ncnnParamBasename": "realesrgan-animevideov3" },
  "capabilities": { "task": "upscale", "scales": [2, 3, 4],
                    "inputFormats": [".png", ".jpg", ".webp"] },
  "files": [
    { "path": "realesrgan-animevideov3.param", "sha256": "..." },
    { "path": "realesrgan-animevideov3.bin",   "sha256": "..." }
  ]
}
```

### 5.9 The TypeScript it deserializes into

`src/shared/registry.ts` (new, shared by main and renderer, no Electron import):

```ts
export type RegistryKind = 'generate' | 'upscale' | 'removebg' | 'pid-backbone'
export type ProvenanceSource = 'builtin' | 'channel' | 'user'

export interface Provenance {
  source: ProvenanceSource
  addedAt?: string
  /** Host the artifact came from, shown in the UI. */
  host?: string
  /** True once every downloadable file has a verified sha256. */
  verified?: boolean
}

/** How to recognize a model FROM THE FILE. Never a filename alone. */
export interface DetectSpec {
  /** Substrings matched against modelspec.architecture / architecture. */
  metaArch?: string[]
  /** Tensor-key substring signature: all of `all`, at least one of `any`, none of `none`. */
  tensorKeys?: { all?: string[]; any?: string[]; none?: string[] }
  /** Inclusive [min, max] byte range, for size-discriminated variants. */
  sizeBytesRange?: [number, number]
  /** ncnn `.param` basename, for the Real-ESRGAN runner. */
  ncnnParamBasename?: string
  /** Advisory only. Never sufficient on its own. */
  nameHint?: string
}

export interface Capabilities {
  task: 'text-to-image' | 'upscale' | 'remove-background'
  /** Generation */
  minDim?: number; maxDim?: number; dimStep?: number
  sizeBuckets?: [number, number][]
  /** Upscale */
  scales?: number[]
  inputFormats?: string[]
}

export interface SamplerSpec {
  name: string; scheduler: string
  steps: number; cfg: number; guidance: number; hasGuidance: boolean
}

export interface Requirements {
  /** Node class names that must exist in this ComfyUI. Checked via /object_info. */
  nodes?: string[]
  /** Loader node + the `type` enum value it must accept. */
  clipLoader?: { node: string; type: string }
  gpu?: { vendor?: 'nvidia' | 'amd' | 'intel' | 'any'; minComputeCap?: number; minVramMb?: number }
  /** Shown if a node/type check fails. */
  minComfyNote?: string
}

export interface DownloadSpec {
  filename: string
  bytes: number
  /** MANDATORY for builtin/channel. Absent on a user entry blocks the download. */
  sha256?: string
  /** Tried in order. Pin a commit sha first, a moving branch last. */
  urls: string[]
}

export type CompanionSubdir =
  | 'text_encoders' | 'clip' | 'vae' | 'checkpoints' | 'diffusion_models'
  | 'unet' | 'upscale_models'

export interface CompanionSpec {
  role: 'clip' | 'clip2' | 'vae'
  label: string
  subdir: CompanionSubdir
  /** Content-first identification of a file the user may already own. */
  identify: DetectSpec
  download: DownloadSpec
}

/** A companion declared once and referenced by id (e.g. the shared Flux AE). */
export interface CompanionRef { role: CompanionSpec['role']; ref: string }

export interface WorkflowSpec {
  format: 'comfy-api-v1'
  /** JSON DATA. Parsed, validated, never evaluated. Only POSTed to loopback. */
  template: Record<string, { class_type: string; inputs: Record<string, unknown> }>
}

export interface RegistryEntry {
  id: string
  kind: RegistryKind
  label: string
  group?: string
  provenance: Provenance
  detect: DetectSpec
  capabilities: Capabilities
  sampler?: SamplerSpec
  requires?: Requirements
  companions?: (CompanionSpec | CompanionRef)[]
  workflow?: WorkflowSpec
  /** Non-downloaded files that must exist beside the runner (ncnn .param/.bin). */
  files?: { path: string; sha256?: string }[]
  /** Runner id: 'comfy' | 'realesrgan-ncnn' | 'spandrel' | 'rembg' | 'pid'. */
  runner?: string
  /** Engine spec for a runner that installs a Python package (rembg, spandrel). */
  engineSpec?: string
  schemaVersion?: number
}

export interface RegistryFile { schemaVersion: number; entries: RegistryEntry[] }

/** Merge builtin < channel < user, per id, per field. Pure, unit-testable. */
export function mergeRegistry(layers: RegistryFile[]): RegistryEntry[] { /* ... */ }

/** Score a probed file against an entry's DetectSpec. 0 = no match. Pure. */
export function scoreDetect(d: DetectSpec, probe: ProbedFile): number { /* ... */ }
```

Note that `ARCH_INFO` (`shared/genArch.ts:32`) is already a per-arch data table that the UI reads
from (`OptionsPanel.tsx:999` hides the negative prompt when `info.cfg === 1`), and
`classifyModel` (`shared/comfy.ts:57`) **already accepts a `tokens` parameter**. The indirection you
need mostly exists. This is a change of *source*, not of *shape*.

---

## 6. Recommended plan

Eight phases, each one PR, ordered by (fresh-user impact) x (model-longevity payoff). Phases 1 to 3
are days of work and remove most of the "only works on the developer's machine" risk. Phases 4 to 6
are the registry. Phases 7 to 8 are hardening.

**Phase 1 · Make a build on any machine either correct or loud** (highest impact per line)
- `scripts/fetch-binaries.mjs:342` extend the required-check to the three trees; add `--skip=<tree>`
  that also drops the `extraResources` entry.
- `src/main/tools/soffice.ts:28` use `pathToFileURL().href`; add the spaced-path test in
  `test/documents.test.ts`.
- `src/main/run.ts:40` typed `ToolMissingError`; `src/main/tools/registry.ts` map it to a real
  message; fix `toolResolver.ts:181`'s probe flags (`mutool -v`, `caesiumclt --version`).
- `src/main/toolResolver.ts:43-48, 70` build roots from `%ProgramFiles%`.
- Touches: `scripts/fetch-binaries.mjs`, `electron-builder.yml`, `tools/soffice.ts`, `run.ts`,
  `tools/registry.ts`, `toolResolver.ts`, `test/documents.test.ts`.

**Phase 2 · Let the user say where ComfyUI is, from anywhere**
- Un-gate the picker from `hasNvidia` (`OptionsPanel.tsx:405`) and from `engineReady`
  (`ComfyImport.tsx:81`); add "Locate my ComfyUI" inline in `GenerateOptions` where the dead-end
  text is today (`OptionsPanel.tsx:974`).
- Factor the triplicated roots/names lists (`discover.ts:21-36, 147-148`, `pythonEnv.ts:43-44`)
  into one exported constant; enumerate real drive letters; add OneDrive-redirected paths.
- Add `resources/ComfyUI` depths and decouple interpreter from `main.py` root (`pythonEnv.ts:86`).
- Touches: `OptionsPanel.tsx`, `ComfyImport.tsx`, `comfy/discover.ts`, `comfy/pythonEnv.ts`.

**Phase 3 · Stop lying about availability, and stop deadlocking**
- `generate/comfy.ts:92` attach `stdout.resume()` + stderr-tail; bail on `exit`; include the tail in
  the timeout error. (This is a live hang fix, not cosmetics.)
- `generate/comfy.ts:73` make `comfyGenerationAvailable` probe a live server; add a "ComfyUI server
  URL" setting; bind our own launch to an ephemeral port.
- Render the `gguf` and `excluded` counts (`OptionsPanel.tsx:991`); replace `models.ts:111-114`'s
  `continue` with a `runnable: false` push so nothing is invisible.
- Touches: `generate/comfy.ts`, `generate/models.ts`, `ipc.ts`, `OptionsPanel.tsx`.

**Phase 4 · Ship the registry loader with today's data, no behaviour change**
- New `src/shared/registry.ts` (types + `mergeRegistry` + `scoreDetect`, pure) and
  `src/main/registry/load.ts` (three-layer load, schema validation, path constraints, provenance).
- Move `ARCH_INFO`, the four workflow graphs, `CLIP_REQ`, `EXTRA_NODES` and `requiredCompanions`
  into `resources/registry/gen-archs.json` verbatim. `SUPPORTED` becomes "whatever the registry
  has". Existing tests must pass unchanged; add a test asserting the shipped pack covers every
  former `GenArch` id so packs and code cannot drift.
- Touches: new files, `shared/genArch.ts`, `generate/models.ts`, `generate/preflight.ts`,
  `generate/archRegistry.ts`, `test/gen-registry.test.ts`.

**Phase 5 · Integrity, then the user layer**
- Add `sha256` to `DownloadSpec` and verify while streaming in `net/download.ts`; delete
  `pid/install.ts:70-120`'s private fork and call `downloadFile` with
  `minBytes = approxBytes * 0.9`. Switch both to `net.fetch` and map `err.cause.code` to real
  messages. Pin every HF URL to a commit sha with the branch URL as the fallback mirror.
- Enable the `%APPDATA%/Filesmith/registry/user/` layer and the "Add a model" UI: point at a
  file/folder, paste a URL, paste a ComfyUI API-format workflow. Show provenance on every row.
- Touches: `net/download.ts`, `pid/install.ts`, `generate/companions.ts`, `ipc.ts`, new UI.

**Phase 6 · Retire the remaining hardcoded catalogs**
- Real-ESRGAN: enumerate `resources/realesrgan/models/*.param` plus a user overlay under
  `userData/models/realesrgan`; derive the picker from disk (`upscale.ts:13`,
  `shared/compress.ts:70-73`, `fetch-binaries.mjs:255`). This un-freezes the only AI upscaler an
  AMD/Intel user has.
- rembg: keep the vetted allowlist as a **licence** boundary but source it from the registry;
  loosen `REMBG_SPEC` to `>=2.0.75,<3` (`toolResolver.ts:120`).
- PiD: `PID_BACKBONES` into the registry with a pinned commit sha; write the sha into `REPO_MARKER`
  and reinstall on mismatch (`install.ts:135, 170`); take the backbone id from the renderer instead
  of the literal `'flux'` (`ipc.ts:180-212`).
- spandrel: record the version in the marker (`install.ts:305-319`), compare against a registry
  floor, and add an "Update upscale engine" button offered whenever a scan yields unsupported models.
- Content-based companion matching using `readSafetensorsHeader`, replacing the filename regexes
  (`archRegistry.ts:33-133`), plus a "Choose a file I already have" picker.
- Derive the upscaler badge from `probe.arch` instead of `VERIFIED_TOKENS` (`shared/comfy.ts:32`).
- Touches: `tools/upscale.ts`, `shared/compress.ts`, `shared/removebg.ts`, `toolResolver.ts`,
  `pid/paths.ts`, `pid/install.ts`, `ipc.ts`, `generate/archRegistry.ts`, `shared/comfy.ts`.

**Phase 7 · Channel updates and the "try anyway" escape hatch**
- Ed25519-signed channel refresh into layer 2, once a day, background, silent-fail-to-cache
  (`crypto.verify`, no dependency). This is the lever that fixes a dead HF URL for everyone in a day.
- "Try anyway" on unknown generation models with a generic graph, surfacing ComfyUI's own error.
- Advisory (not terminal) non-image exclusion with word-boundary metadata matching
  (`archScan.ts:119`).
- Per-arch dimension limits and size buckets from the registry, replacing the global 2048 clamp
  (`shared/generate.ts:89-103`).

**Phase 8 · Robustness and the remaining hardening**
- Install lock + `mkdtempSync` temp dirs (`ipc.ts:182/221`, `install.ts:137/144/205`); disk-space
  preflight via `fs.statfs`; `Range`-resumable downloads; a visible "Repair / remove AI install".
- Symlink-cycle guards on `models.ts:35`, `archRegistry.ts:152`, `discover.ts:188`; move the scan
  off the main thread with an mtime-keyed cache.
- GPU compute-cap + driver floor before any multi-GB CUDA install (`gpu.ts:41`); torch spec and
  index URL from the registry.
- Drop `.pt` from bulk scans; drop drive roots / Downloads / Desktop from implicit Python discovery
  now that the picker exists; confirm the first spawn of a newly-discovered interpreter.
- Scheme-allowlist `index.ts:151`; quote the YAML scalar in `generate/comfy.ts:54`; shared
  `src/main/uv.ts` with a PATH probe and the `<pidRoot>/uv/uv.exe` candidate.
- Fixture-tree tests for every resolver (`test/`), per M12.

---

## 7. Explicitly out of scope / accepted risks

Things I looked at and am deliberately **not** recommending you fix.

- **`sandbox: false` on both windows** (`index.ts:140`, `previewWindow.ts:38`). Turning it on is
  cheap (the preload uses only `ipcRenderer` and `webUtils`) and worth doing eventually, but the
  claimed exploit chain requires script execution the CSP already blocks, the main window renders no
  untrusted markup, and the markdown path is sanitized. Defence in depth, not a live hole. Same for
  confining `file:bytes` / `file:text` / `fsmedia://` to session-known paths.
- **Cross-platform support.** `paths.ts:25-29` has a platform branch and `install.ts:225/308`
  hardcode `.venv/Scripts/python.exe`, but `electron-builder.yml:45-47` declares only
  `win: target: nsis`. There is no macOS or Linux build to break. Unused generality, not a defect.
- **Zip-slip in the PiD/uv extraction.** Windows bsdtar rejects `..` and absolute members, the zips
  come over TLS from `github.com/nv-tlabs` and `github.com/astral-sh`, and no failure was
  demonstrated. Add the explicit reject in Phase 5 as belt-and-braces, do not treat it as a finding.
- **Binary planting via bare-name spawn.** I tested this: a renamed `whoami.exe` planted as
  `mutool.exe` in the cwd did **not** execute; the real PATH `mutool` did. A name not on PATH failed
  with ENOENT. Modern libuv's `search_path` walks PATH only and does not search the cwd or the
  application directory, under both plain node 24.14 and Electron 43's runtime. The Win32
  `CreateProcess` search order does not apply because libuv resolves the image itself. The
  "never fall back to a bare name" hardening is still worth doing, and Phase 1 covers it, but as
  an error-message fix, not a security fix.
- **The rembg model allowlist as a concept.** `shared/removebg.ts:1-12` documents a real per-model
  licence audit (bria-rmbg CC BY-NC, u2net_human_seg's Supervisely provenance, isnet-anime's scraped
  provenance, sam being the wrong tool). Keep it vetted. Phase 6 moves *where the list lives*, not
  *whether it is a list*. Do not open it up.
- **Localized Windows folder names.** Windows localizes only the Explorer display name;
  `%USERPROFILE%\Desktop` and `\Documents` are the real on-disk paths, which is exactly what
  `join(homedir(), 'Desktop')` produces. The genuine cases are OneDrive redirection and non-C/D/E
  drives, both covered in Phase 2.
- **The `extra_model_paths.yaml` hand-rolled parser** (`discover.ts:97-122`). It genuinely misses
  ComfyUI's multi-line block form, but `resolveExtraPaths` only feeds `resolveUpscaleDirs`, whose
  four layout guesses already cover the normal cases, non-existent paths are silently discarded, and
  the same models are found again via `comfyModelsBases()`. Bounded and cosmetic.
- **Unsigned NSIS installer.** Expected and documented in `CLAUDE.md`. Publish the installer's
  sha256 with the GitHub Release and record bundled tool versions in a manifest inside the app;
  that is the realistic ceiling without a code-signing certificate.
- **Reproducible `fetch-binaries.mjs` from a bare CI runner.** Worth doing (a `tools.lock.json` of
  `{name, url, sha256, version}`, and pinning ffmpeg to a versioned artifact instead of
  `-release-`), but it is a contributor-experience and supply-chain-audit improvement, not something
  an end user hits at runtime. LibreOffice stays the documented `$LIBREOFFICE_DIR` exception; just
  fail loudly when it is absent, which Phase 1 does.
