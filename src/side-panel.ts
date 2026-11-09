import {
  type AgentSession,
  type AgentSessionEvent,
  AssistantMessageComponent,
  BashExecutionComponent,
  BranchSummaryMessageComponent,
  CompactionSummaryMessageComponent,
  CustomMessageComponent,
  getMarkdownTheme,
  getSelectListTheme,
  type Theme,
  ToolExecutionComponent,
  UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import {
  type Component,
  Container,
  Editor,
  type Focusable,
  Key,
  type KeyId,
  matchesKey,
  Spacer,
  Text,
  type TUI,
  type TuiMouseEvent,
  type TuiMouseEventResult,
  truncateToWidth,
} from "@earendil-works/pi-tui";
import { Scroller } from "./scroller.ts";

export interface SidePanelOptions {
  tui: TUI;
  theme: Theme;
  session: AgentSession;
  /** Where the context came from, e.g. "current", "fork @ …", "empty". */
  source: string;
  shortcut: KeyId;
  cwd: string;
  onClose: () => void;
  onUnfocus: () => void;
}

const PREFIX_WIDTH = 2; // "│ "
// pi strips OSC 133 prompt-zone marks only at line start; our "│ " prefix would leave them mid-line.
const OSC133 = /\x1b\]133;[ABC](?:\x07|\x1b\\)/g;

type Message = AgentSession["messages"][number];

/** Right-side overlay: header, scrollable side transcript, side editor, hint line. */
export class SidePanel implements Component, Focusable {
  private readonly o: SidePanelOptions;
  private readonly transcript = new Container();
  private readonly editor: Editor;
  private readonly scroller = new Scroller();
  private readonly tools = new Map<string, ToolExecutionComponent>();
  private readonly unsubscribe: () => void;
  private streaming?: AssistantMessageComponent;
  private viewHeight = 1;
  private editorTop = 0;
  private _focused = false;

  constructor(options: SidePanelOptions) {
    this.o = options;
    const { theme } = options;
    this.editor = new Editor(
      options.tui,
      {
        borderColor: (s) => theme.fg(this._focused ? "borderAccent" : "borderMuted", s),
        selectList: getSelectListTheme(),
      },
      { paddingX: 0 },
    );
    this.editor.onSubmit = (text) => this.submit(text);
    this.showHistory();
    this.unsubscribe = options.session.subscribe((event) => this.onEvent(event));
  }

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    this.editor.focused = value;
  }

  render(width: number): string[] {
    const { theme, tui, session } = this.o;
    const inner = Math.max(1, width - PREFIX_WIDTH);
    const bar = `${theme.fg(this._focused ? "borderAccent" : "borderMuted", "│")} `;

    const status = [
      theme.fg(this._focused ? "accent" : "muted", theme.bold("Side")),
      theme.fg("dim", `${this.o.source} · ${session.model?.id ?? "no model"}`),
      session.isStreaming ? theme.fg("accent", "● working") : "",
      this.scroller.follow ? "" : theme.fg("warning", "↑ scrolled (End)"),
    ];
    const header = status.filter(Boolean).join("  ");
    const key = this.o.shortcut;
    const hint = this._focused
      ? `Enter send · Esc ${session.isStreaming ? "stop" : "main"} · ${key} main · /side-close`
      : `${key} focus side chat`;

    const editorLines = this.editor.render(inner);
    this.viewHeight = Math.max(1, tui.terminal.rows - editorLines.length - 2);
    const body = this.transcript.render(inner);
    const top = this.scroller.layout(body.length, this.viewHeight);
    const visible = body.slice(top, top + this.viewHeight);
    while (visible.length < this.viewHeight) visible.push("");
    this.editorTop = 1 + this.viewHeight;

    return [header, ...visible, ...editorLines, theme.fg("dim", hint)].map(
      (line) => bar + truncateToWidth(line.replace(OSC133, ""), inner, "", true),
    );
  }

  handleInput(data: string): void {
    if (matchesKey(data, this.o.shortcut)) return this.o.onUnfocus();
    if (matchesKey(data, Key.escape) && !this.editor.isShowingAutocomplete()) {
      if (this.o.session.isStreaming) void this.o.session.abort();
      else this.o.onUnfocus();
      return;
    }
    const page = Math.max(1, this.viewHeight - 1);
    if (matchesKey(data, Key.pageUp)) this.scroller.scrollBy(-page);
    else if (matchesKey(data, Key.pageDown)) this.scroller.scrollBy(page);
    else if (matchesKey(data, Key.shift("up"))) this.scroller.scrollBy(-1);
    else if (matchesKey(data, Key.shift("down"))) this.scroller.scrollBy(1);
    else if (matchesKey(data, Key.end) && this.editor.getText() === "") this.scroller.toEnd();
    else this.editor.handleInput(data);
    this.o.tui.requestRender();
  }

  /** Fullscreen TUI mode only: wheel scrolls the transcript, clicks focus the panel. */
  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (event.type === "wheel") {
      this.scroller.scrollBy(event.wheelDelta ?? 0);
      return { handled: true };
    }
    if (event.type !== "click" || event.button !== "left") return undefined; // keep drag-to-select
    if (event.y >= this.editorTop) {
      this.editor.handleMouse({
        ...event,
        x: event.x - PREFIX_WIDTH,
        y: event.y - this.editorTop,
        width: event.width - PREFIX_WIDTH,
      });
    }
    return { handled: true, focus: true };
  }

  invalidate(): void {
    this.transcript.invalidate();
    this.editor.invalidate();
  }

  dispose(): void {
    this.unsubscribe();
    const { session } = this.o;
    void session.abort().finally(() => session.dispose());
  }

  private submit(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (trimmed === "/side-close") return this.o.onClose();
    this.editor.setText("");
    this.editor.addToHistory(trimmed);
    this.scroller.toEnd();
    this.o.session.prompt(trimmed, { streamingBehavior: "followUp" }).catch((error: unknown) => {
      this.add(new Text(this.o.theme.fg("error", error instanceof Error ? error.message : String(error)), 0, 0));
      this.o.tui.requestRender();
    });
  }

  private onEvent(event: AgentSessionEvent): void {
    switch (event.type) {
      case "message_start":
        if (event.message.role === "assistant") {
          this.streaming = new AssistantMessageComponent(undefined, false, getMarkdownTheme(), undefined, 0);
          this.transcript.addChild(this.streaming);
          this.streaming.updateContent(event.message, true);
        } else {
          this.addMessage(event.message);
        }
        break;
      case "message_update":
        if (this.streaming && event.message.role === "assistant") {
          this.streaming.updateContent(event.message, true);
          for (const c of event.message.content) {
            if (c.type === "toolCall") this.tool(c.id, c.name, c.arguments).updateArgs(c.arguments);
          }
        }
        break;
      case "message_end":
        if (this.streaming && event.message.role === "assistant") {
          const message = event.message;
          this.streaming.updateContent(message, false);
          if (message.stopReason === "aborted" || message.stopReason === "error") {
            const text = message.errorMessage ?? "Operation aborted";
            for (const tool of this.tools.values()) tool.updateResult({ content: [{ type: "text", text }], isError: true });
            this.tools.clear();
          } else {
            for (const tool of this.tools.values()) tool.setArgsComplete();
          }
          this.streaming = undefined;
        }
        break;
      case "tool_execution_start":
        this.tool(event.toolCallId, event.toolName, event.args).markExecutionStarted();
        break;
      case "tool_execution_update":
        this.tools.get(event.toolCallId)?.updateResult({ ...event.partialResult, isError: false }, true);
        break;
      case "tool_execution_end":
        this.tools.get(event.toolCallId)?.updateResult({ ...event.result, isError: event.isError });
        this.tools.delete(event.toolCallId);
        break;
      case "agent_end":
        this.streaming = undefined;
        this.tools.clear();
        break;
    }
    this.o.tui.requestRender();
  }

  /** Copied context, rendered like pi's own transcript (tool calls collapsed, results matched by id), then a divider. */
  private showHistory(): void {
    const { theme, source, session } = this.o;
    const history = session.messages; // nothing prompted yet: exactly the copied context (+ hidden boundary)
    if (!history.some((m) => m.role !== "custom")) {
      this.transcript.addChild(new Text(theme.fg("dim", "Empty side chat (no context copied)"), 0, 0));
      return;
    }
    this.transcript.addChild(new Text(theme.fg("dim", `Context copied from main (${source})`), 0, 0));
    const pending = new Map<string, ToolExecutionComponent>();
    for (const m of history) {
      if (m.role === "toolResult") {
        pending.get(m.toolCallId)?.updateResult(m);
        pending.delete(m.toolCallId);
        continue;
      }
      this.addMessage(m);
      if (m.role !== "assistant") continue;
      const failed = m.stopReason === "aborted" || m.stopReason === "error";
      for (const c of m.content) {
        if (c.type !== "toolCall") continue;
        const tool = this.newTool(c.id, c.name, c.arguments);
        if (failed) tool.updateResult({ content: [{ type: "text", text: m.errorMessage ?? "Operation aborted" }], isError: true });
        else pending.set(c.id, tool);
      }
    }
    this.add(new Text(theme.fg("accent", "── side chat starts here ──"), 0, 0));
  }

  /** Everything except streaming assistant messages and tool calls (same mapping as pi's transcript). */
  private addMessage(m: Message): void {
    const md = getMarkdownTheme();
    switch (m.role) {
      case "user": {
        const text = typeof m.content === "string" ? m.content : m.content.map((c) => (c.type === "text" ? c.text : "")).join("");
        if (text) this.add(new UserMessageComponent(text, md, 0));
        break;
      }
      case "assistant":
        this.transcript.addChild(new AssistantMessageComponent(m, false, md, undefined, 0));
        break;
      case "compactionSummary":
        this.add(new CompactionSummaryMessageComponent(m, md));
        break;
      case "branchSummary":
        this.add(new BranchSummaryMessageComponent(m, md));
        break;
      case "custom": // hidden ones include our boundary message
        if (m.display) this.add(new CustomMessageComponent(m, undefined, md, 0));
        break;
      case "bashExecution": {
        const bash = new BashExecutionComponent(m.command, this.o.tui, m.excludeFromContext);
        if (m.output) bash.appendOutput(m.output);
        bash.setComplete(m.exitCode, m.cancelled);
        this.add(bash);
        break;
      }
    }
  }

  private tool(id: string, name: string, args: unknown): ToolExecutionComponent {
    let component = this.tools.get(id);
    if (!component) {
      component = this.newTool(id, name, args);
      this.tools.set(id, component);
    }
    return component;
  }

  private newTool(id: string, name: string, args: unknown): ToolExecutionComponent {
    const definition = this.o.session.getToolDefinition(name);
    const component = new ToolExecutionComponent(name, id, args, {}, definition, this.o.tui, this.o.cwd);
    this.transcript.addChild(component);
    return component;
  }

  private add(component: Component): void {
    this.transcript.addChild(new Spacer(1));
    this.transcript.addChild(component);
  }
}
