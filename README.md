# Software Project Analyzer

A local-first desktop workspace for software project ideas. It does two jobs:

1. **Generate** — give it a theme and a goal. It returns one to five distinct, buildable product ideas, each with a tech stack, viability estimate, build plan, and any existing projects the model already knows about.
2. **Analyze** — paste a fully formed idea. It searches GitHub, the general web, and Hacker News for projects that already do it, then grades each match for completeness and real usage.

Generation runs on your machine through [Ollama](https://ollama.com). There is no account, no telemetry, and no cloud model. Only short search queries leave the app during a project scan.

---

## Requirements

- Windows 10 or 11 for the installer target
- [Ollama](https://ollama.com) running locally
- One local model. The recommended default is **Qwen3 8B** (pull command below).
- Optional: a GitHub personal access token for a 30-request-per-minute search limit and up to 10 queries per scan.

```bash
ollama pull qwen3:8b
```

- Node.js 20 or newer only if you run the app from source.

The app does not download models. Install one first, then choose it in **Settings**. If no models are installed, Settings shows an empty model list and the pull command; if Ollama is not running, the status reads offline.

### Other good model choices

| Model | Pull command | Notes |
| --- | --- | --- |
| Qwen3 8B | `ollama pull qwen3:8b` | Recommended default. Good balance of reasoning, instruction following, and structured JSON on 8 GB of RAM or a 6 GB GPU. |
| Llama 3.1 8B | `ollama pull llama3.1:8b` | Reliable, widely available fallback with similar hardware needs. |
| Gemma 3 12B | `ollama pull gemma3:12b` | Stronger writing, but wants 16 GB of RAM. |
| Qwen3 4B | `ollama pull qwen3:4b` | Faster on modest machines. Less reliable at strict JSON, so expect more retries. |
| Qwen2.5 3B | `ollama pull qwen2.5:3b` | Minimum viable option. Good for testing the plumbing, not for careful research. |

---

## Run from source

```bash
npm install
npm run dev
```

`npm run dev` compiles the Electron main process, starts Vite, and opens the app. Restart after editing files in `electron/`.

To run the production build without packaging:

```bash
npm start
```

To typecheck:

```bash
npm run typecheck
```

---

## Build the Windows installer

```bash
npm run dist
```

The installer is written to `release/software-project-analyzer-v1.0.0-windows-x64.exe` (NSIS, per-user install, optional install directory). The version, platform, and architecture are part of the filename. For an unpacked folder instead:

```bash
npm run dist:dir
```

The installer is unsigned, so Windows SmartScreen may warn on first launch. Regenerate the icon with `npm run icon` if you change the brand mark.

---

## Using the app

### Generate

1. Go to **Generate**.
2. Enter **Themes** and/or **Goals**. **Tech stack** is optional; leave it blank and every idea gets a stack chosen for it.
3. Pick how many ideas to produce per run (1–5).
4. Press **Generate**.

Every run is saved as a **saved brief** on the right. **Run again** sends that exact brief back to the model, unchanged, for another batch — as many times as you like. **Load** puts it back into the form so you can tweak it.

Generated ideas are filed immediately under **Unfiled** on the left. Drag an idea onto a folder header, or use the folder selector on the idea page. Deleting a folder moves its ideas back to Unfiled instead of deleting them.

### Analyze

1. Go to **Analyze**.
2. Paste the idea as you would explain it to an engineer: who it is for, what it does, and the core mechanic. A stack is optional.
3. Press **Scan before you build**.

The description is filed as an idea (diamond marker) with the full report attached, so you can keep it, fold it, or re-scan later. Re-scanning an idea deliberately ignores cached research and runs a fresh pass.

### Settings, GitHub, and backups

**GitHub access.** Anonymous GitHub search allows 10 requests per minute and 3 queries per scan. Paste a personal access token in **Settings → GitHub access** to raise that to 30 requests per minute and 10 queries per scan. The supported sign-in is a personal access token, so no OAuth app registration is needed. A classic token with no scopes checked is enough for public repository search; **Create token** opens the right GitHub page. The token is encrypted with the operating system's secure storage and kept outside the workspace.

**Backups.** **Export backup** writes the ideas, folders, saved briefs, and settings to a JSON file of your choosing. **Import backup** validates the file, asks for confirmation, and replaces the current workspace. The GitHub token and research cache are intentionally excluded, so a backup never contains a credential.

**Cache.** Settings shows the current research-cache size and offers a clear button. See [Caching](#caching) below.

### What each idea page contains

- **What it is** — the pitch, in plain language
- **Shape** — target user, core features, the wedge, and risks
- **Tech stack** — concrete choices with the role each one plays
- **Viability** — an honest 0–100 estimate that a small team ships this and gets real usage
- **Build plan** — weeks, difficulty, and the minimum useful slice
- **Existing projects** — scanned matches with completeness, usage, similarity, stars, and last activity

---

## How project scans work

1. **Translate.** The local model turns the idea into up to four search phrasings that do not depend on the name you gave it.
2. **Search.**
   - GitHub repository search, up to 3 queries anonymously or 10 with a token. Queries are spaced for the 10/min or 30/min limit respectively.
   - General web results from DuckDuckGo's HTML endpoint, with Yahoo as a fallback.
   - Hacker News story search through Algolia.
   - Search pages are fetched through Electron's Chromium network stack so they behave like a browser request.
3. **Read evidence.** GitHub results arrive with stars, forks, owner type, creation date, last push, and a short README excerpt.
4. **Grade.** The model marks each relevant result `direct`, `adjacent`, or `loose`, estimates completeness, and writes a one-line note. It also returns an overall verdict, gaps you could own, and angles forward.
5. **Guardrail.** The app will not report an "open field" when the model itself found a direct match with real usage. Usage and the numeric signals come from the data, not the model.

### Caching

Research is cached on disk so a repeated scan does not spend another API call or model pass on data the app has already seen:

| Data | Reused for |
| --- | --- |
| GitHub search results | 6 hours |
| GitHub README excerpts | 7 days, keyed to the last push |
| General web results | 12 hours |
| Hacker News results | 6 hours |
| Planned search queries | 7 days per model and idea |
| Model evidence grades | 7 days per model and idea |

The cache is bounded to 600 entries, lives in `research-cache.json`, and can be cleared in **Settings → Workspace data**. **Re-scan projects** forces fresh results for that idea. Idea generation is intentionally not cached: rerunning a saved brief should produce another batch, not replay the last one.

### Completeness labels

| Label | Meaning |
| --- | --- |
| **Shipped** | Usable, maintained, with signs of real production use |
| **Beta** | Usable but early or lightly maintained |
| **Prototype** | Demo, experiment, or very small project |
| **Abandoned** | Archived, or no activity for roughly two years |
| **Unverified** | Not enough evidence to judge |

### Usage labels

| Label | Signal |
| --- | --- |
| **Widely used** | Very high stars, or a smaller repo maintained by an organization |
| **In use** | Meaningful star count, or strong Hacker News discussion |
| **Niche** | Real but modest traction |
| **Low usage** | Few stars and little discussion |
| **Usage ?** | Web result with no hard usage number |

Completeness and usage are estimates built from real signals. They are not audits. GitHub data is factual; the grade is the model's read of the evidence.

### Known limits

- GitHub's unauthenticated search API allows 10 requests per minute; a token raises that to 30. A scan uses up to 3 or 10 queries respectively. If the limit is hit, the report says so and shows fewer repositories.
- General web search can be rate-limited or challenged by the provider. If it fails, the report says so and still includes GitHub and Hacker News results.
- Small models can produce weak search phrasings or miss an obvious competitor. Re-scan after editing the idea, or use a larger model.
- Projects shown before a scan come from model knowledge and are labeled **unverified** until you run a scan.
- Cache entries expire on the schedule above. A fresh scan may still return a known result if the source has not changed.

---

## Where your data lives

The workspace is a single plain JSON file. **Settings → Workspace data** shows the exact path, typically:

```
%APPDATA%\Software Project Analyzer\workspace.json
```

It contains your ideas, folders, saved briefs, reports, and settings. Changes are written locally about half a second after they happen. Use **Export backup** and **Import backup** to move it. There is no account and no sync.

Two other files sit beside it:

- `research-cache.json` — disposable search and grading cache. Safe to delete; **Clear research cache** empties it.
- `github-auth.json` — the encrypted GitHub token, if connected. It is never included in a workspace backup.

---

## Project layout

```
electron/
  main.ts            Electron window, IPC, security
  preload.ts         Typed contextBridge API
  lib/
    ollama.ts        Model listing and streaming chat
    generate.ts      Idea generation prompt and normalization
    research.ts      Query planning, evidence, grading
    github.ts        Repository search and README excerpts
    web.ts           DuckDuckGo / Yahoo / Hacker News search
    cache.ts         Persistent TTL cache for research data
    githubAuth.ts    Encrypted token storage and validation
    backup.ts        Workspace export and restore
    json.ts          Tolerant JSON extraction
    store.ts         Atomic JSON persistence
shared/types.ts      Shared data model
src/
  App.tsx            State, tasks, persistence
  main.tsx           React entry point
  global.d.ts        Typed preload bridge declaration
  lib/util.ts        Formatting, IDs, model selection
  components/        Sidebar, Composer, IdeaView, VerifyView, SettingsView, shared UI
  styles.css         Visual system
build/               icon.ico and icon.png
scripts/             Dev launcher and icon generator
index.html           Renderer entry and CSP
vite.config.mts      Vite build and development server
```

---

## Security

This is a local desktop app, not a web service. A few boundaries are deliberate:

- The renderer is sandboxed with context isolation and no Node integration. It reaches native capabilities only through the typed preload bridge in `electron/preload.ts`.
- The packaged app contains no command execution, `eval`, dynamic code loading, auto-updater, or downloaded executables. The only `child_process` use in the repository is the development launcher in `scripts/dev.mjs`, which is not included in the installer.
- Network access is limited to the configured Ollama host (loopback by default), GitHub, DuckDuckGo, Yahoo, Hacker News, and GitHub's raw content host. There is no telemetry endpoint and no remote configuration fetch.
- The GitHub token is encrypted with the operating system's secure storage, kept in the main process, and excluded from workspace backups.
- The Content Security Policy blocks remote scripts, objects, and base-URI changes. Inline styles and the Vite development preamble are allowed; the packaged page contains no inline application script.
- `npm audit --omit=dev` reports zero vulnerabilities. A full audit reports moderate, build-only issues in electron-builder's glob tooling; they are not shipped in the app runtime, and the affected dependency is not force-downgraded because that would change the packaging toolchain.

The installer is unsigned. Windows SmartScreen may warn on first launch. If you distribute a build, publish a SHA-256 hash alongside it and tell users to verify it with `Get-FileHash`.

---

## Scope

This build runs entirely through Ollama. Accounts, sync, cloud generation, and collaboration are not included.

---

## Privacy

- Prompts, ideas, reports, and settings stay on this machine.
- Generation and grading send text only to your local Ollama endpoint (`127.0.0.1:11434` by default).
- During a scan, only the generated search queries are sent to GitHub, DuckDuckGo/Yahoo, and Hacker News. Idea text is not posted anywhere.
- If you connect a GitHub token, it is stored encrypted in the app data folder and sent only to `api.github.com` as an authorization header. It is never exposed to the renderer or included in backups.
- Research cache files contain search results and model grades, not credentials. They can be cleared at any time.
- The renderer has no Node access; all network work happens in the main process behind a typed IPC bridge.

---

## License

MIT. See [LICENSE](LICENSE).
