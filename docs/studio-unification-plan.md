# Builder Unification Plan — Apps Studio & Games Studio (D)

**Status:** APPLIED — verified green (tsc clean · 534 unit tests / 62 files pass ·
hook + GameStudio biome-clean). Manual smoke test on the live UI still recommended
before release.

## 1. Why

`src/components/AppsBuilder.tsx` (~1,257 lines) and `src/components/GameStudio.tsx`
(~1,106 lines) are ~90% duplicated. The entire "machine" — state, refs, effects, and
handlers — is written twice almost verbatim:

- project / gallery state, the busy-elapsed effect, the phase-narration effect
- monotonic turn manager (`turnRef`), stop flag, message queue, `projectRef`/`messagesRef`
- `pushMessage`, `stop`, `runBuild` (with one transient-error retry),
  `startBuild` / `updateProject`, `runTurn`, `sendMessage`
- `handleOpen` / `handleNew` / `handleDelete` / `handleSave` / `handleExport` / `handleBack`

Only a handful of intentional differences separate them, and the code has already
drifted (e.g., the Apps-only engine toggle). The merge collapses this into one shared
hook and lets later work — including B1 "self-heal" and E1 compile-metrics wiring — be
done once instead of twice.

## 2. Target architecture

- New hook: `src/lib/appsBuilder/useStudioBuilder.ts` — owns the whole machine.
- `AppsBuilder` / `GameStudio` become thin shells: a one-line hook call plus local
  aliases, then their JSX is left **byte-for-byte untouched**.
- The module-level sub-components already at the bottom of each file (`GameChatPane`,
  `GameFilesPane`, `LivePreview`, `AppChatPane`, `PreviewPane`, `FilesPane`, the
  Markdown renderers, and the gallery components) are NOT part of the machine and stay
  where they are.

### 2.1 `StudioBuilderConfig`

```ts
export interface StudioBuilderConfig {
  kind: "app" | "game";
  // appsBuilder or gamesStudio storage (load / upsert / delete)
  storage: {
    load: () => SavedApp[];
    upsert: (app: SavedApp) => SavedApp[];
    delete: (id: string) => SavedApp[];
  };
  buildStatus: Record<BuildPhase, string>;
  updateStatus: Record<BuildPhase, string>;
  // lowercase and capitalized noun for user-facing copy, e.g. ("app","App") vs ("game","Game")
  noun: string;
  nounCap: string;
  // zip filename suffix, e.g. "-app.zip" vs "-game.zip"
  zipTag: string;
  // generation-tip dismiss localStorage key (already a per-file constant)
  tipDismissKey: string;
  // games: "3d"; apps: omit so the toggle / request text decides
  forceEngine?: AppEngine;
  // marks the developer-reply as game-flavored (Games: true)
  game?: boolean;
  // the two studios have DISTINCT success copy (asserted verbatim) — provide both
  readyMessage: (name: string, files: number) => string;
  updatedMessage: (name: string, files: number) => string;
}
```

### 2.2 What the hook returns (every identifier the shells' JSX consumes)

`project`, `files`, `messages`, `liveReply`, `phase`, `prompt`/`setPrompt`,
`agentState`, `activityFeed`, `busyElapsed`, `busy`, `generating`, `selectedFile`/
`setSelectedFile`, `previewRevision`, `savedList`, `openProject`, `editorOpen`,
`dirty`, `exportOpen`/`setExportOpen`, `engine`/`setEngine`, `viewport`/`setViewport`,
`prefs`, plus actions: `advancePhase`, `sendMessage`, `stop`,
`handleSave`, `handleExport`, `handleBack`, `handleNewProject`, `handleOpenProject`,
`handleDeleteProject`, and `generate` + `developerReply`.

Each shell aliases to its existing JSX names so the JSX is untouched:

```ts
// GameStudio
const studio = useStudioBuilder({ ...gameConfig });
const savedGames = studio.savedList;
const openGame = studio.openProject;
const handleNewGame = studio.handleNewProject;
const handleOpenGame = studio.handleOpenProject;
const handleDeleteGame = studio.handleDeleteProject;
const handleBackToGames = studio.handleBack;
const generateGame = studio.generate;      // JSX uses generateGame.isPending
const gamesPrefs = studio.prefs;          // JSX uses gamesPrefs.showFileTree

// AppsBuilder — same + engine/viewport
const savedApps = studio.savedList;
const openApp = studio.openProject;
const handleNewApp = studio.handleNewProject;
const handleOpenApp = studio.handleOpenProject;
const handleDeleteApp = studio.handleDeleteProject;
const handleBackToApps = studio.handleBack;
const generateApp = studio.generate;
const appsPrefs = studio.prefs;
```

## 3. Behavior to preserve exactly (the subtle part)

- **Engine:** Apps → `engine === "auto" ? undefined : engine`; Games → `"3d"`.
  Both live in `runBuild`'s `mutateAsync({ engine })`.
- **Developer-reply flavor:** Apps (no `game: true`); Games (`game: true`).
- **Success copy (verbatim in tests):**
  - Games `startBuild`: `**<name>** is ready to play — N files, full 3D scene with physics. Press play…`
  - Apps `startBuild`: its own `**<name>** is ready — N files, and the preview is live…`
  → Pass `config.readyMessage` / `config.updatedMessage` per studio, never hardcode one.
- **Error copy:** `I couldn't build that {noun}:` / `I couldn't apply that change:` and
  toast `${nounCap} generation failed` / `${nounCap} update failed`. Stop messages are
  identical across studios.
- **`handleSave`:** toast + metadata identical except copy; `id` seed `slugify(project.name)`,
  falling back to the open-saved id.
- **`handleOpenProject`:** Apps additionally restores `viewport` + `engine` from the saved
  project; Games does not (it stays 3D).
- **`handleNewProject`:** Apps resets `engine` to `"auto"`; Games does not.
- **`handleExport`:** zip filename differs (`-app.zip` / `-game.zip`); marks
  `status: "completed"`; toast identical.

## 4. Step-by-step migration (each step is a commit-clean checkpoint)

1. **Add the hook, no callers** — create `useStudioBuilder.ts`. The file is ≈18k chars
   and the editor caps each write at ~6k, so write it in ~3 editor calls (types + config,
   then state/effects/handlers, then the return object). Run `npx tsc --noEmit`. Expected
   green: the hook is unused.
2. **Convert Games Studio only** — replace its machine block (roughly lines 54–460) with
   the hook call + aliases; leave the JSX below. Gate:
   `npx vitest run src/test/gameStudio.test.tsx` + `npx tsc --noEmit`.
   If red here, fix the hook copy/config to match the test expectations **before** touching Apps.
3. **Convert Apps Studio** — replace its machine block with the hook call + aliases,
   adding the `engine`/`viewport` handling for the Apps-only shell. Gate:
   `npx vitest run src/test/appsBuilder.test.tsx` + `npx tsc --noEmit`.
4. **Full suite + lint** — `npx vitest run` (expect all current tests to stay green)
   and `npx @biomejs/biome check src/…`.
5. **Manual smoke test (required before release):**
   - Both modes: start a new item, prompt the AI, watch analyze→design→write→preview
     phases; stop mid-turn; send a message mid-build (queue); update an existing project;
     save → reopen; export zip.
   - Apps: toggle Web / 3D engine; responsive device view; default viewport mirrors settings.
   - Games: engine stays 3D; controls-hint toggle; file-tree toggle.
   - Reopen a saved app/game and confirm its session is reused (edits land in place).

## 5. Files & rollback

- **New:** `src/lib/appsBuilder/useStudioBuilder.ts`
- **Modified:** `src/components/AppsBuilder.tsx`, `src/components/GameStudio.tsx`
- **Untouched:** all sub-panes / galleries / previews, settings, storage, and the
  mutation hooks (`useGenerateApp`, `useDeveloperReply` — the hook merely *uses* them).
- Rollback is trivial: revert the two components and delete the hook. Do not commit until
  the manual smoke test passes.

## 6. Residual risk & why it's gated on a manual pass

Unit tests **mock** `useGenerateApp`/`useDeveloperReply` and render the components, so
they gate orchestration (turn counts, queue, retry, save, engine `"3d"`) but cannot catch
visual/UX regressions. The verbatim success-copy assertions are the main trap — every
message/token must match the per-studio strings. Mitigations: land it test-green, require
the manual step, and ideally add two new unit tests asserting **both** studios' success
copy up front so the gate is tighter.

## 7. Follow-ups this unblocks

- **B1 (runtime self-heal):** on preview error, auto-open a "fix this" generation turn —
  now writable once in the hook instead of duplicated.
- **E1 compile metrics:** wire `mountAppPreview({ onCompile })` through the single
  preview site.
- Any future perf/logic fix lands once instead of twice.