# pi-side-ext

Ask quick questions in a side chat without interrupting the main pi conversation.

A side chat opens as a panel on the right. It starts with a copy of the main conversation, a copy of any earlier checkpoint, or no context at all. It runs its own agent in the same pi process. Nothing it does is written back to the main session.

## Why

Two similar extensions already exist:

| Package | Approach | Problem |
| --- | --- | --- |
| `@luan.sh/pi-side` | Starts a child `pi` process in a PTY through a native Rust `terminal-bridge` | Needs a Rust toolchain or a prebuilt binary, so it is hard to distribute |
| `pi-side-chat` | Runs a TypeScript agent in a top overlay | Has only one fork point (the latest), extra modes and actions, and a `peek_main` tool |

`pi-side-ext` is plain TypeScript with no native code and no extra runtime dependencies. It uses only `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui`. Install it with:

```sh
pi install npm:pi-side-ext
```

## Commands

| Command | Effect |
| --- | --- |
| `/side` | Open a side chat with the main session's **current** branch as context. |
| `/side-fork` | Pick an entry in the session tree, then open a side chat with the context **up to and including** that entry. |
| `/side-new` | Open a side chat with **no** inherited context. |
| `/side-close` | Close the side chat and discard its conversation. |

There are no actions, no `/side <prompt>` shorthand and no subcommands.

## Keybindings

| Key | Where | Effect |
| --- | --- | --- |
| `alt+/` | anywhere | Move focus between the main editor and the side chat. Does nothing if no side chat is open. |
| `Esc` | side chat | Stop the side agent if it is responding. Otherwise move focus back to main. Esc never closes the side chat. |
| `PgUp` / `PgDn` | side chat | Scroll the side transcript one page. |
| `shift+↑` / `shift+↓` | side chat | Scroll the side transcript one line. |
| `End` | side chat | Jump to the bottom and follow new output. |

You can change the `alt+/` shortcut in `~/.pi/agent/pi-side-ext.json`:

```json
{ "shortcut": "alt+/" }
```

## Layout

```
┌──────────── main ────────────┬────── Side ──────────┐
│ user: refactor auth          │ Context copied (current)│
│ assistant: ...               │ user: refactor auth  │
│ tool: edit src/auth.ts       │ ── side chat starts ──│
│                              │ user: what's JWT exp?│
│                              │ asst: 15m, set in …  │
│ > main editor                │ > side editor        │
└──────────────────────────────┴──────────────────────┘
```

- The side chat is a pi overlay anchored `right-center`. It is 45% wide, at least 40 columns, and full height.
- The header shows the title, which context it came from (`current`, `fork @ <entry summary>` or `empty`), the model, and a streaming spinner.
- Below the header are the side transcript and a side editor.
- The transcript starts with the copied context, drawn the same way as main's transcript (tool calls collapsed). A `── side chat starts here ──` divider follows it. The panel opens scrolled to the bottom, so scroll up to read the context. `/side-new` shows `Empty side chat (no context copied)` instead.
- The border uses the accent color when the side chat has focus and a muted color when it does not, so you can always see where your input goes.
- The overlay is hidden when the terminal is narrower than 100 columns. The side chat keeps running. It shows again when the terminal is wide enough. While hidden, `alt+/` shows a notification instead of moving focus.

## Side chat behavior

### Context

- **`/side`** builds the context from `ctx.sessionManager.getBranch()`, which is the current active branch.
- **`/side-fork`** opens pi's tree selector (`TreeSelectorComponent`, the same UI as `/tree`). The context is the branch from the root to the selected entry, including that entry. This is different from `/tree`. If you pick a user message, the side chat starts right after that message instead of moving to its parent and loading the text into the editor. `Esc` in the selector cancels and opens nothing.
- **`/side-new`** copies nothing. The side session starts empty and no boundary message is added.
- Entries that `buildSessionContext` understands are copied with their meaning kept: compactions, branch summaries, and custom messages.
- If the main agent is in the middle of a response, only messages that pi has already saved are copied. pi-ai adds placeholder results for any tool calls that have no result yet, so the copy needs no trimming.
- For `/side` and `/side-fork`, a hidden boundary message is added after the copied history:

  > The conversation above was copied from the main session for reference only. Do not continue its pending work, tool calls, or unfinished answer. Answer only the side-chat messages that follow.

### Agent

- The side agent uses the model and thinking level that the main session has when the side chat opens. Later model changes in main do not affect it.
- Its system prompt is rebuilt for the side chat's own tools, with a short side-chat addendum. It keeps `AGENTS.md`, skills and prompt templates but loads no extensions. It does not reuse main's prompt (`ctx.getSystemPrompt()`), because that prompt lists tools the side agent does not have.
- **It has read-only tools only: `read`, `grep`, `find` and `ls`.** It has no `bash`, `edit` or `write`, and no extension tools, so it cannot interfere with the main agent's work.
- Side-chat messages are sent with `Enter`, like the main editor. Inside the side editor, `/side-close` is caught locally. Any other text, including other slash commands, is sent to the side agent as a normal prompt.

### Only one side chat at a time

- `/side`, `/side-fork` or `/side-new` while a side chat is open asks first: `Replace the current side chat?` If you confirm, the old one is closed and discarded. While the dialog and the `/side-fork` picker are shown, the panel is hidden because they are drawn in the same place. If you cancel, the panel comes back unchanged.

### Lifecycle (in memory only)

- Side chats are never saved to disk. `/side-close`, quitting pi, `/reload`, and switching or replacing the main session (`/new`, `/resume`, `/fork`) all discard the side chat. Any running side response is stopped first.
- Closing does not ask for confirmation.

## Focus and scrolling

- Focus is either on the main editor or on the side editor. `alt+/` switches between them. The side overlay stays visible either way, so the main session keeps responding to input while the side chat is open.
- **Mouse scrolling works in pi's fullscreen TUI mode** (`tuiMode: "fullscreen"` or `--tui-mode fullscreen`). pi sends mouse events to the overlay under the pointer. The wheel over the side panel scrolls the side chat and the wheel over the main transcript scrolls main, no matter which one has focus. Clicking the panel focuses it. Dragging to select text also works in fullscreen mode.
- **In regular TUI mode** the terminal handles mouse scrolling, so the wheel scrolls terminal scrollback and not the side panel. Use the keyboard scroll keys instead. When the side chat opens in regular mode, a one-time notification says: `Enable fullscreen TUI mode (/settings) for mouse scrolling in side chat`.
- The side transcript follows new output. Scrolling up stops following and shows `↑ scrolled (End)` in the header. `End` or scrolling back to the bottom turns following back on.

## Non-goals

- Running more than one side chat at a time, or side-chat tabs.
- Saving or restoring side chats.
- Write or bash tools in the side chat, or an edit-mode toggle.
- Copying side-chat content back into main.
- A `peek_main` tool or live access to the main agent's activity.
- Actions or action-registry integration.
- Child processes, PTYs or native binaries.

## Implementation notes

All of these are public pi exports, except the model runtime noted in the Side agent row.

| Need | API |
| --- | --- |
| Commands and shortcut | `pi.registerCommand("side" \| "side-fork" \| "side-new" \| "side-close")`, `pi.registerShortcut(shortcut)` |
| Tree picker | `TreeSelectorComponent(ctx.sessionManager.getTree(), leafId, termHeight, onSelect, onCancel)` inside `ctx.ui.custom()` |
| Side agent | `createAgentSession({ sessionManager: SessionManager.inMemory(cwd, undefined, copiedEntries), model, thinkingLevel, tools: ["read","grep","find","ls"], resourceLoader, modelRuntime })` with a `DefaultResourceLoader({ noExtensions: true, appendSystemPromptOverride })` so that this extension does not load itself again inside the side chat. `/side-new` passes an empty entry list. `modelRuntime` is main's runtime, read from a private field on `ctx.modelRegistry` because pi has no public getter, so that providers registered by extensions keep working. If that field is missing, a fresh `ModelRuntime` is used. |
| Panel | `ctx.ui.custom(..., { overlay: true, overlayOptions: { anchor: "right-center", width: "45%", minWidth: 40, visible }, onHandle })` |
| Focus switching | `OverlayHandle.focus()` / `handle.unfocus()`. Extension shortcuts only fire while the main editor has focus, so the panel itself handles `alt+/` when it has focus. |
| Transcript | A `Container` of `UserMessageComponent`, `AssistantMessageComponent` and `ToolExecutionComponent`, driven by `session.subscribe()` events. pi-tui's `ScrollView` only scrolls inside pi's main layout, not inside overlays, so the panel cuts out the visible lines itself (`Scroller`) and handles wheel events in `handleMouse`. |
| Side editor | pi-tui `Editor` |
| Cleanup | A `session_shutdown` handler (it runs for quit, `/reload`, `/new`, `/resume` and `/fork`) that calls `session.abort()`, then disposes the session and hides the overlay. `close()` uses `handle.hide()`, not the `custom()` `done()` callback, because `done()` hides whichever overlay is on top. |

Files: `src/index.ts` (commands, shortcut, lifecycle), `src/side-session.ts` (copying context and creating the agent session), `src/side-panel.ts` (overlay component), `src/scroller.ts` (scroll position, tested in `test/scroller.test.ts`).

## Known limitations

- **The panel covers the right side of the main transcript.** pi has no public API to make the main view narrower, so the overlay is drawn on top of it. The covered part of main is visible again when you close the side chat or make the terminal narrow enough to hide the panel.
- Mouse scrolling needs fullscreen TUI mode (see above).
- The side agent can read files that the main agent is still editing, so it may see half-finished changes.

## Open questions

1. Should `alt+/` open a side chat with the current context when none is open, like `pi-side-chat` does, or only switch focus as written above?
2. Should the panel width be configurable in `pi-side-ext.json`, or is a fixed 45% enough?
3. Should extension tools such as web search or fetch be allowed in the side chat? They are read-only in spirit, but `noExtensions: true` removes them.
