import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type ExtensionAPI,
  type ExtensionCommandContext,
  getAgentDir,
  type SessionEntry,
  TreeSelectorComponent,
} from "@earendil-works/pi-coding-agent";
import type { KeyId, OverlayHandle } from "@earendil-works/pi-tui";
import { SidePanel } from "./side-panel.ts";
import { createSideSession } from "./side-session.ts";

const MIN_COLUMNS = 100;

interface OpenSide {
  panel: SidePanel;
  handle: OverlayHandle;
}

export default function sideExtension(pi: ExtensionAPI): void {
  const shortcut = loadShortcut();
  let side: OpenSide | undefined;
  let warnedRegularMode = false;

  const close = () => {
    if (!side) return;
    side.panel.dispose();
    side.handle.hide();
    side = undefined;
  };

  /** Hide the open side chat and ask before replacing it. Returns false (and restores it) if the user declines. */
  const confirmReplace = async (ctx: ExtensionCommandContext): Promise<boolean> => {
    if (!side) return true;
    side.handle.setHidden(true); // the dialog renders where the panel sits
    if (await ctx.ui.confirm("Side chat", "Replace the current side chat?")) return true;
    side.handle.setHidden(false);
    return false;
  };

  const open = async (ctx: ExtensionCommandContext, entries: SessionEntry[], source: string) => {
    if (!ctx.model) {
      ctx.ui.notify("Side chat needs a model. Pick one with /model first.", "error");
      return;
    }
    let session: Awaited<ReturnType<typeof createSideSession>>;
    try {
      session = await createSideSession(ctx, entries);
    } catch (error) {
      side?.handle.setHidden(false);
      ctx.ui.notify(`Could not start side chat: ${error instanceof Error ? error.message : String(error)}`, "error");
      return;
    }
    close();
    let panel: SidePanel | undefined;
    // The promise only settles via done(), which we never call: close() hides this exact overlay instead,
    // because done() would hide whichever overlay is on top.
    void ctx.ui.custom<void>(
      (tui, theme) => {
        if (tui.mode !== "fullscreen" && !warnedRegularMode) {
          warnedRegularMode = true;
          ctx.ui.notify("Enable fullscreen TUI mode (/settings) for mouse scrolling in side chat", "info");
        }
        panel = new SidePanel({
          tui,
          theme,
          session,
          source,
          shortcut,
          cwd: ctx.cwd,
          onClose: close,
          onUnfocus: () => side?.handle.unfocus(),
        });
        return panel;
      },
      {
        overlay: true,
        overlayOptions: {
          anchor: "right-center",
          width: "45%",
          minWidth: 40,
          visible: (columns) => columns >= MIN_COLUMNS,
        },
        onHandle: (handle) => {
          if (panel) side = { panel, handle };
        },
      },
    );
  };

  pi.registerCommand("side", {
    description: "Open a side chat with the current conversation as context",
    handler: async (_args, ctx) => {
      if (!requireTui(ctx) || !(await confirmReplace(ctx))) return;
      await open(ctx, ctx.sessionManager.getBranch(), "current");
    },
  });

  pi.registerCommand("side-fork", {
    description: "Open a side chat with context up to a picked session-tree entry",
    handler: async (_args, ctx) => {
      if (!requireTui(ctx) || !(await confirmReplace(ctx))) return;
      side?.handle.setHidden(true);
      const entryId = await pickEntry(ctx);
      if (!entryId) {
        side?.handle.setHidden(false);
        return;
      }
      await open(ctx, ctx.sessionManager.getBranch(entryId), `fork @ ${describe(ctx.sessionManager.getEntry(entryId))}`);
    },
  });

  pi.registerCommand("side-new", {
    description: "Open a side chat with no inherited context",
    handler: async (_args, ctx) => {
      if (!requireTui(ctx) || !(await confirmReplace(ctx))) return;
      await open(ctx, [], "empty");
    },
  });

  pi.registerCommand("side-close", {
    description: "Close the side chat",
    handler: async () => close(),
  });

  pi.registerShortcut(shortcut, {
    description: "Focus the side chat",
    handler: (ctx) => {
      if (!side) ctx.ui.notify("No side chat open. Start one with /side.", "info");
      else if (!side.handle.getBounds()) ctx.ui.notify(`Terminal too narrow for the side chat (needs ${MIN_COLUMNS} columns).`, "warning");
      else side.handle.focus();
    },
  });

  pi.on("session_shutdown", () => close());
}

function requireTui(ctx: ExtensionCommandContext): boolean {
  if (ctx.mode === "tui") return true;
  if (ctx.hasUI) ctx.ui.notify("Side chat needs the interactive TUI.", "error");
  return false;
}

function pickEntry(ctx: ExtensionCommandContext): Promise<string | undefined> {
  const tree = ctx.sessionManager.getTree();
  if (tree.length === 0) {
    ctx.ui.notify("No entries in this session yet.", "info");
    return Promise.resolve(undefined);
  }
  return ctx.ui.custom<string | undefined>(
    (tui, _theme, _keybindings, done) =>
      new TreeSelectorComponent(
        tree,
        ctx.sessionManager.getLeafId(),
        tui.terminal.rows,
        (entryId) => done(entryId),
        () => done(undefined),
      ),
  );
}

function describe(entry: SessionEntry | undefined): string {
  if (entry?.type !== "message") return entry?.type ?? "entry";
  const { message } = entry;
  const content = "content" in message ? message.content : "";
  const text = typeof content === "string" ? content : content.map((c) => (c.type === "text" ? c.text : "")).join(" ");
  const oneLine = text.replace(/\s+/g, " ").trim();
  return `${message.role}: ${oneLine.length > 30 ? `${oneLine.slice(0, 29)}…` : oneLine || "…"}`;
}

function loadShortcut(): KeyId {
  try {
    const { shortcut } = JSON.parse(readFileSync(join(getAgentDir(), "pi-side-ext.json"), "utf8"));
    if (typeof shortcut === "string" && shortcut.trim()) return shortcut.trim() as KeyId;
  } catch {
    // Missing or invalid config: use the default.
  }
  return "alt+/";
}
