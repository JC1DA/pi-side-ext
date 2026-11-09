# pi-side-ext

Ask quick questions in a side chat without interrupting your main [pi](https://pi.dev) conversation.

`/side` opens a panel on the right with a copy of the current conversation. A second agent answers there while the main agent keeps working. Nothing from the side chat goes back into the main session.

```
┌──────────── main ────────────┬──────── Side ─────────┐
│ user: refactor auth          │ Context: current      │
│ assistant: ...               │ user: refactor auth   │
│ tool: edit src/auth.ts       │ ── side chat starts ──│
│                              │ user: what's JWT exp? │
│                              │ asst: 15m, set in …   │
│ > main editor                │ > side editor         │
└──────────────────────────────┴───────────────────────┘
```

It is plain TypeScript with no native code and no runtime dependencies.

## Requirements

- pi in the interactive TUI. Tested with pi 0.85.1.
- A terminal at least 100 columns wide. The panel hides in narrower terminals.
- A model selected in pi. The side chat uses the same model and thinking level as the main session.

## Install

Install from GitHub:

```sh
pi install git:github.com/JC1DA/pi-side-ext
```

This adds the package to `~/.pi/agent/settings.json`, so it loads in every pi session. Add `-l` to install it for the current project only (`.pi/settings.json`).

To try it for one run without installing:

```sh
pi -e git:github.com/JC1DA/pi-side-ext
```

Update or remove it later:

```sh
pi update --extensions
pi remove git:github.com/JC1DA/pi-side-ext
```

### From a local clone

```sh
git clone https://github.com/JC1DA/pi-side-ext.git
pi install ./pi-side-ext
```

pi loads the TypeScript source straight from the clone, so you don't need a build step. Run `/reload` in pi after you edit the source.

## Usage

1. Run `/side` in pi. The side panel opens with focus on its editor.
2. Type a question and press `Enter`.
3. Press `alt+/` to move focus back to the main editor. Press it again to return to the side chat.
4. Run `/side-close` when you are done.

### Commands

| Command | Effect |
| --- | --- |
| `/side` | Open a side chat with the current conversation as context. |
| `/side-fork` | Pick an entry in the session tree and open a side chat with the context up to and including that entry. |
| `/side-new` | Open a side chat with no context. |
| `/side-close` | Close the side chat and discard it. Works from the main editor or the side editor. |

Only one side chat can be open at a time. Opening another one asks before replacing it.

### Keys

| Key | Where | Effect |
| --- | --- | --- |
| `alt+/` | anywhere | Move focus between the main editor and the side chat. |
| `Esc` | side chat | Stop the side agent while it is answering. Otherwise move focus back to main. |
| `PgUp` / `PgDn` | side chat | Scroll the side transcript one page. |
| `shift+↑` / `shift+↓` | side chat | Scroll one line. |
| `End` | side chat | Jump to the bottom and follow new output. |

Mouse wheel scrolling over the panel works only in pi's fullscreen TUI mode. Turn it on in `/settings`, or start pi with `--tui-mode fullscreen`. In regular mode, use the keys above.

## What the side agent can do

- It has read-only tools only: `read`, `grep`, `find` and `ls`. It cannot edit files or run commands.
- It loads your `AGENTS.md`, skills and prompt templates, but no extensions. Extension tools such as web search are not available in the side chat.
- It keeps the model it started with. Changing the model in main later does not affect it.

Side chats live in memory only. Closing the side chat, quitting pi, `/reload`, `/new`, `/resume` and `/fork` all discard it.

## Configuration

To change the `alt+/` shortcut, create `~/.pi/agent/pi-side-ext.json`:

```json
{ "shortcut": "ctrl+]" }
```

Restart pi or run `/reload` to apply it.

## Known limitations

- The panel is drawn over the right side of the main transcript. pi has no API to make the main view narrower. Close the side chat to see that part of main again.
- The side agent can read files that the main agent is still editing, so it may see half-finished changes.

## Development

```sh
npm install
npm test           # node --test, needs Node 22.18+ to run .ts files directly
npm run typecheck
```

`description.md` has the design notes and the pi APIs each part uses.

## License

MIT
