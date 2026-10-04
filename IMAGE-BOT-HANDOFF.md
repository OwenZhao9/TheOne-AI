# Image Bot handoff

## Commit

- Implementation commit: `b034b17c3` (`feat(image-bot): add built-in image generation bot`)
- Pi repair/config commit: `4eb2ed650` (`fix(image-bot): connect Pi image MCP and Ark config`)
- Branch: `feat/image-bot`
- Worktree: `/Users/owenzhao/TheOne/image-bot`

## What changed

- Added the standard importable Bot package at `docs/guides/bots/image-generation-bot/` with `bot.json`, README and `skills/image-generation/SKILL.md`.
- Added the same package as a bundled built-in seed in `packages/desktop/src/process/extensions/builtinImageBot.ts`.
- `BotStore` seeds the Bot once into the existing Bot plaza. A user removal is persisted and is not silently undone on restart. Existing Bot bindings and immutable package behavior remain unchanged.
- Added explicit visual-request detection in `packages/desktop/src/common/pi/imageBot.ts`. It routes direct image/Logo/illustration creation or image editing to the existing `dispatch` flow, while excluding analysis, search, tutorials and code/component work. An already bound Bot or task-tree child is not recursively routed.
- Extended the existing task-tree extension guidance so the main assistant selects `theone.image-generation`, uses `aionui_image_generation`, declares `img-*` output ownership, and reports unresolved image configuration instead of claiming a text-only result.
- Added `ImageGenerationConfigService` as an independent Pi setting. It stores `provider`, `baseUrl`, `model`, and `enabled` in `${AionPi data}/image-generation.json`; only the encrypted API key is stored as `apiKeyEncrypted`, using the existing Electron `SecretCodec`. The IPC entry points are `imageGenerationConfig` (redacted read) and `saveImageGenerationConfig` (write; an empty `apiKey` keeps the existing key).
- Added explicit CLI import with `--import-image-config=/absolute/path.json` (or the two-argument form). `--import-image-config-only` performs only the safe-storage import after Electron is ready, does not request the single-instance lock, does not start `PiService`, does not create a window, and exits after printing redacted state; this lets an already-running TheOne keep its current UI and data untouched.
- Pi now writes an isolated `mcp.json` for each parent or child agent directory and registers `theone-image-generation` with direct `aionui_image_generation` exposure. The MCP process receives the key only through its private child-process environment; the MCP JSON, resource catalog, snapshots and task evidence contain no key.
- Added the real Volcano Ark Seedream path in `packages/desktop/src/common/chat/imageGenCore.ts`: `volcengine`/Ark providers call `/images/generations`, send `size: "2K"`, parse URL/base64 image output and save an actual `img-*` file. The current default is `doubao-seedream-5-0-flash-260915`; no unsupported sequential-generation field is sent.
- Hardened the existing image channel in `packages/desktop/src/common/chat/imageGenCore.ts`: remote inputs and returned image URLs are downloaded with a 30-second timeout and 25 MB limit, generated files use exclusive unique filenames, cancellation is propagated, and a response without an actual image is now a failure.

## Use and configuration

1. Open TheOne's Bot plaza. **作图助手** is available after the Pi service starts, or import the package folder above using the existing Bot import flow.
2. In Pi Settings, configure the independent `Pi 生图设置` entry. The default endpoint is `https://ark.cn-beijing.volces.com/api/v3`; enter the current Ark model and API key there. This does not read the legacy AionUI Tools setting.
3. Save the setting. The next Pi process start registers the image MCP tool in the parent or isolated child session.
4. Start the Bot directly, or send an explicit image/Logo/illustration creation or editing request in an ordinary chat. The latter enters the existing automatic delegation flow.

The Bot package contains no key, OAuth credential, absolute path or developer-session-only image tool. If the independent image setting or runtime is not configured, the request remains unresolved with a clear configuration error; no placeholder image or prompt-only success is produced.

## Automatic call chain

`user request → explicit visual-intent guard → existing Pi dispatch prompt → existing delegate_tasks tool → configured Jev decision → child conversation with image Bot and isolated workspace → aionui_image_generation → actual img-* file → child evidence/report → parent review and verify_task → declared file integration`

Large App tasks keep using the existing model-driven `delegate_tasks` route. Ordinary non-visual requests do not select the image Bot.

## Verification

Passed:

- Importable Bot package validation through the existing `readLocalPackage` validator.
- Bundled package and importable package Skill content match.
- Bot plaza seed/removal/restart smoke check through `BotStore`.
- Intent-routing smoke cases for creation, attached-image editing, analysis/search/tutorial exclusion and React component exclusion.
- Prettier checks on all changed source, tests and Bot package files.
- `git diff --check`.
- `bun run i18n:types` and `node scripts/check-i18n.js`.
- `bunx --no-install tsc --noEmit -p tsconfig.json`.
- Focused Vitest suite: 6 files, 49 tests passed, including independent config redaction/MCP registration and the real Ark request shape (`/images/generations`, `size: "2K"`).
- `bun run aionpi:build`: main, preload and Pi renderer bundles compiled successfully; the build also emitted `out/main/builtin-mcp-image-gen.js` and `out/main/builtin-mcp-browser.js`.
- Compiled Pi RPC child validation exposed `mcp__theone_image_generation__aionui_image_generation` under the isolated `--no-extensions --extension builtin:mcp` launch path.

Not completed:

- A live Ark request and returned image were accepted by the main task using the user's already-created key; this branch never receives or prints that key.
- No full app packaging, installation, GitHub upload, merge, or public deployment was performed.

## Main-task integration notes

- Keep the existing Bot plaza, task tree, Jev approval, isolated child workspace and parent `verify_task` acceptance path.
- Merge/cherry-pick the final local commits from `feat/image-bot`; do not copy changes from `/Users/owenzhao/TheOne/aion-pi`.
- For a programmable local setup, call `saveImageGenerationConfig({ provider, baseUrl, model, apiKey, enabled })`; then call `imageGenerationConfig()` to verify only `{ provider, baseUrl, model, enabled, configured }`. The persisted file is `${AionPi data}/image-generation.json`; do not write a plaintext key there.
- For an existing running app, invoke the compiled AionUI entry with `--import-image-config-only --import-image-config=/absolute/path.json`; the JSON must be an explicit user-selected file containing `provider`, `baseUrl`, `model`, `apiKey`, and optional `enabled`. The mode imports into the same `${AionPi data}` location without opening or replacing the running app.
- After merge, run the focused Pi/Bot/image tests in an environment with the repository dependencies installed, then perform one real configured image request. Treat automated checks and live image acceptance as separate results.
