/**
 * The chat engine seam (D-16).
 *
 * ChatService and the chat panel talk only to this interface. The Claude Code
 * CLI engine (claude-cli-engine.ts) is its first implementation; an API-key
 * engine comes later (02.7-07) and must fit the same shape.
 *
 * `ChatStartOptions` holds only what every engine shares. Anything specific to
 * one engine (a binary path, an MCP config file, a model) belongs in that
 * engine's constructor.
 *
 * No Electron and no child_process import here: this file is pure types.
 */

/** Why a turn failed, in categories the panel can explain in plain words. */
export type ChatErrorKind =
  | 'not-installed'
  | 'signed-out'
  | 'crashed'
  | 'protocol'
  | 'bridge-off'
  | 'tools-unavailable'
  | 'session-lost'
  | 'timeout'
  // For the API-key engine (02.7-07).
  | 'no-key'
  | 'refused'

/** One thing that happened in a chat, in the order it happened. */
export type ChatEvent =
  /** The engine's conversation id, known before the first reply. */
  | { type: 'session'; sessionId: string }
  /** A message the person sent. */
  | { type: 'user'; text: string }
  /** A piece of assistant text as it is written. */
  | { type: 'text-delta'; text: string }
  /** A complete assistant text block; replaces the deltas streamed for it. */
  | { type: 'text'; text: string }
  | { type: 'tool-call'; id: string; name: string; input: unknown }
  | { type: 'tool-result'; id: string; isError: boolean; text: string }
  /** Something worth saying that is not an error. */
  | { type: 'notice'; text: string }
  | { type: 'error'; kind: ChatErrorKind; message: string }
  /** The turn ended. */
  | { type: 'done'; ok: boolean; reason?: string }
  /**
   * What the session's agent says it is doing (`set_status`, D-13), with its
   * level already clamped to the ceiling. ChatService records and emits it;
   * an engine never does. Chrome, never history: no passage holds it (D-10).
   */
  | { type: 'status'; text: string; needs: boolean; level: number }

export interface ChatStartOptions {
  /** The workspace root the engine works in. */
  cwd: string
  /** Continue this conversation rather than starting a new one. */
  resumeSessionId?: string
}

export interface ChatEngine {
  readonly kind: 'claude-cli' | 'anthropic-api'

  /**
   * Prepare a conversation. Returns its id and whether it continues an
   * earlier one. Starting may be lazy: nothing needs to run until `send`.
   */
  start(options: ChatStartOptions): Promise<{ sessionId: string; resumed: boolean }>

  /** Send one message. Throws while a turn is still running. */
  send(text: string): void

  /** Subscribe to events. Returns an unsubscribe function. */
  onEvent(listener: (event: ChatEvent) => void): () => void

  /** True while a turn is running. */
  readonly busy: boolean

  /** End the running turn. The conversation stays resumable. */
  stop(): Promise<void>

  /**
   * The chat's shell switch (D-15), from the next message on. Engines with no
   * shell (the API-key engine) leave it out. Resolves once any process that
   * had the old tools and was idle has ended.
   */
  setAllowShell?(on: boolean): Promise<void>

  /** Stop and release everything this engine holds. */
  dispose(): Promise<void>

  /**
   * Kill everything this engine started, synchronously and without waiting.
   * Only for app quit, where nothing can be awaited. Engines with no process
   * of their own may leave it out.
   */
  killNow?(): void
}
