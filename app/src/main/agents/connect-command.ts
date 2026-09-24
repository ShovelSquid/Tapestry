/**
 * The `claude mcp add` command Kaelen runs to connect an agent.
 *
 * The command is **built, never typed**. Every interpolated value — the token,
 * the userData path, the executable paths — goes through shellQuote, so a
 * folder with a space in it ("House Party", the first vault) stays one
 * argument and nothing inside a value can end the quoting and start a command
 * of its own (T-02.2-23).
 *
 * The server name leads, directly after `add`. The CLI's usage is
 * `claude mcp add [options] <name> <commandOrUrl> [args...]`, and its env
 * option is variadic (`-e, --env <env...>`), so it keeps eating following
 * non-option tokens until an option or `--` stops it. A name placed after the
 * env flags is therefore read as one more environment variable and rejected
 * outright: `Invalid environment variable format: tapestry`. The `--` sits
 * directly before the runtime command for the same reason — it terminates that
 * variadic list, so no env value can run on into the command the agent client
 * executes. The order is load-bearing, not cosmetic.
 *
 * Two runtimes, because the shim needs Node 20+ and the same N-API ABI:
 *  - **development:** system `node` runs `app/out/main/mcp.js` directly.
 *  - **packaged:** the Tapestry binary runs it with `ELECTRON_RUN_AS_NODE`
 *    set, which is Electron's own way of behaving as plain Node (RESEARCH
 *    Pattern 2).
 *
 * This module touches no state and imports nothing from electron, so it can be
 * tested as a pure function.
 */

import { join } from 'node:path'

/** The MCP server name the agent client registers Tapestry under. */
const SERVER_NAME = 'tapestry'

/** Where the built stdio shim sits, relative to its runtime root. */
const SHIM_RELATIVE = join('out', 'main', 'mcp.js')

/**
 * Quote a value for a POSIX shell.
 *
 * Single quotes suspend every kind of expansion, so the only character needing
 * care is the single quote itself: the string is closed, an escaped quote is
 * appended, and the string reopens — the standard `'\''` idiom.
 */
export function shellQuote(value: string): string {
  return `'${value.split("'").join("'\\''")}'`
}

export interface ConnectCommandOptions {
  /** Shown once and never stored in plaintext (T-02.2-20). */
  token: string
  userDataDir: string
  isPackaged: boolean
  /** `app.getAppPath()` — the app directory in development. */
  appPath: string
  /** `process.execPath` — the Tapestry binary when packaged. */
  execPath: string
  /** `process.resourcesPath` — where app.asar sits when packaged. */
  resourcesPath: string
}

/**
 * Build the whole command as one copyable line.
 *
 * The token appears exactly once, because the Agents panel shows it exactly
 * once: only its SHA-256 is stored, so a command that dropped or duplicated it
 * could not be reconstructed afterwards.
 */
export function buildConnectCommand(options: ConnectCommandOptions): string {
  const parts = [
    'claude',
    'mcp',
    'add',
    SERVER_NAME,
    '--scope',
    'user',
    '--transport',
    'stdio',
    '--env',
    shellQuote(`TAPESTRY_AGENT_TOKEN=${options.token}`),
    '--env',
    shellQuote(`TAPESTRY_USER_DATA=${options.userDataDir}`),
  ]

  if (options.isPackaged) {
    parts.push('--env', shellQuote('ELECTRON_RUN_AS_NODE=1'))
  }

  parts.push('--')

  if (options.isPackaged) {
    parts.push(
      shellQuote(options.execPath),
      shellQuote(join(options.resourcesPath, 'app.asar', SHIM_RELATIVE)),
    )
  } else {
    parts.push('node', shellQuote(join(options.appPath, SHIM_RELATIVE)))
  }

  return parts.join(' ')
}
