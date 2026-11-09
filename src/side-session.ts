import {
  type AgentSession,
  createAgentSession,
  DefaultResourceLoader,
  type ExtensionContext,
  getAgentDir,
  ModelRuntime,
  type SessionEntry,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

const READ_ONLY_TOOLS = ["read", "grep", "find", "ls"];

const SIDE_PROMPT = `## Side chat

You are in a SIDE CHAT that runs next to the user's main pi session. The main agent cannot see this chat, and nothing here is copied back.
You only have read-only tools (read, grep, find, ls). Never claim to have changed files or run commands.
Keep answers concise.`;

const BOUNDARY_TEXT =
  "The conversation above was copied from the main session for reference only. Do not continue its pending work, tool calls, or unfinished answer. Answer only the side-chat messages that follow.";

/** Start an in-process agent session seeded with a copy of `entries` (a root-to-leaf branch of the main session). */
export async function createSideSession(ctx: ExtensionContext, entries: SessionEntry[]): Promise<AgentSession> {
  const cwd = ctx.cwd;
  const agentDir = getAgentDir();
  // Deep copy so nothing the side session does can touch main's in-memory entries.
  const sessionManager = SessionManager.inMemory(cwd, undefined, JSON.parse(JSON.stringify(entries)));
  if (entries.length > 0) sessionManager.appendCustomMessageEntry("pi-side-boundary", BOUNDARY_TEXT, false);

  const settingsManager = SettingsManager.create(cwd, agentDir);
  // noExtensions keeps this extension (and every other one) from loading again inside the side chat.
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    noExtensions: true,
    noThemes: true,
    appendSystemPromptOverride: (base) => [...base, SIDE_PROMPT],
  });
  await resourceLoader.reload();

  const { session } = await createAgentSession({
    cwd,
    agentDir,
    settingsManager,
    resourceLoader,
    sessionManager,
    modelRuntime: await parentRuntime(ctx),
    model: ctx.model,
    thinkingLevel: ctx.thinkingLevel,
    tools: READ_ONLY_TOOLS,
  });
  return session;
}

// ponytail: ModelRegistry has no public runtime getter. Reuse its private one so providers registered by
// extensions and runtime API keys keep working; fall back to a fresh runtime (auth.json/models.json only).
async function parentRuntime(ctx: ExtensionContext): Promise<ModelRuntime> {
  const runtime = (ctx.modelRegistry as unknown as { runtime?: ModelRuntime }).runtime;
  return typeof runtime?.streamSimple === "function" ? runtime : ModelRuntime.create();
}
