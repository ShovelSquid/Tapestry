/**
 * AgentRegistry — which agents may connect, and what their tokens prove.
 *
 * An agent's identity is the one thing it may not choose (D-06). The app mints
 * a token when Kaelen connects an agent, shows it once, and stores only its
 * SHA-256. A request carrying that token becomes `agent.<name>`; a request
 * carrying anything else is refused before a command runs.
 *
 * Only `node:crypto` and `node:fs` are used here. The MCP shim bundles this
 * module to compute the socket path, and the shim must not pull in electron or
 * the native addon.
 *
 * **Local-trust limit (T-02.2-16, accepted):** any process running as this user
 * can read the MCP client config holding the token. The token distinguishes
 * agents from each other; it is not a defence against the user's own account.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { isValidActorName } from '../commands/actor'

/**
 * Where the agent socket lives.
 *
 * A Unix socket path is limited to about 104 bytes on macOS, and Electron's
 * userData path can be long. When it will not fit, fall back to a per-user
 * directory under /tmp, which the socket server creates with mode 0700.
 */
export function agentSocketPath(userDataDir: string): string {
  const preferred = join(userDataDir, 'agents.sock')
  if (Buffer.byteLength(preferred) <= 100) return preferred
  const uid = process.getuid?.() ?? 'user'
  return join('/tmp', `tapestry-${uid}`, 'agents.sock')
}

export interface AgentRecord {
  name: string
  /** SHA-256 of the token, hex. The token itself is never stored. */
  tokenSha256: string
  createdAt: string
  lastConnectedAt: string | null
}

interface AgentsFile {
  version: 1
  agents: AgentRecord[]
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf-8').digest('hex')
}

export class AgentRegistry {
  private readonly filePath: string

  constructor(filePath: string) {
    this.filePath = filePath
  }

  /**
   * Read the stored agents.
   *
   * An unreadable or malformed file reads as **no agents** rather than
   * throwing: failing closed means a corrupt file refuses every token, which
   * is the safe direction. The problem is logged so it is not silent.
   */
  list(): AgentRecord[] {
    if (!existsSync(this.filePath)) return []
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf-8')) as Partial<AgentsFile>
      if (!parsed || !Array.isArray(parsed.agents)) return []
      return parsed.agents.filter(
        (a): a is AgentRecord =>
          !!a &&
          typeof a.name === 'string' &&
          typeof a.tokenSha256 === 'string' &&
          typeof a.createdAt === 'string',
      )
    } catch (err) {
      console.error('[AgentRegistry] could not read agents.json:', err)
      return []
    }
  }

  /**
   * Mint an agent and return its token **once**.
   *
   * The caller must show it to the user immediately; it cannot be recovered
   * afterwards, because only the digest is written.
   */
  create(name: string): { name: string; token: string } {
    if (!isValidActorName(name)) {
      throw new Error('Agent name must match ^[a-z0-9][a-z0-9_-]{0,31}$')
    }
    const agents = this.list()
    if (agents.some((a) => a.name === name)) {
      throw new Error(`agent.${name} already exists`)
    }

    const token = randomBytes(32).toString('base64url')
    agents.push({
      name,
      tokenSha256: sha256Hex(token),
      createdAt: new Date().toISOString(),
      lastConnectedAt: null,
    })
    this.write(agents)
    return { name, token }
  }

  remove(name: string): boolean {
    const agents = this.list()
    const remaining = agents.filter((a) => a.name !== name)
    if (remaining.length === agents.length) return false
    this.write(remaining)
    return true
  }

  /**
   * Resolve a token to its agent, or null.
   *
   * Every stored digest is compared with `timingSafeEqual` on equal-length
   * buffers, and the loop does not stop early, so the time taken does not
   * reveal how much of a guessed token was correct.
   */
  verify(token: string): AgentRecord | null {
    if (typeof token !== 'string' || token.length === 0) return null
    const candidate = Buffer.from(sha256Hex(token), 'utf-8')

    let match: AgentRecord | null = null
    for (const agent of this.list()) {
      const stored = Buffer.from(agent.tokenSha256, 'utf-8')
      if (stored.length !== candidate.length) continue
      if (timingSafeEqual(stored, candidate)) match = agent
    }
    return match
  }

  markConnected(name: string, at: Date): void {
    const agents = this.list()
    const agent = agents.find((a) => a.name === name)
    if (!agent) return
    agent.lastConnectedAt = at.toISOString()
    this.write(agents)
  }

  /**
   * Write atomically at mode 0600, and throw on failure.
   *
   * Unlike `last-opened.json`, this file decides who may write to the world,
   * so a failed write must not be swallowed as best-effort.
   */
  private write(agents: AgentRecord[]): void {
    const payload: AgentsFile = { version: 1, agents }
    const dir = dirname(this.filePath)
    mkdirSync(dir, { recursive: true })
    const tmp = `${this.filePath}.tmp`
    try {
      writeFileSync(tmp, JSON.stringify(payload, null, 2), { encoding: 'utf-8', mode: 0o600 })
      renameSync(tmp, this.filePath)
    } catch (err) {
      try {
        if (existsSync(tmp)) unlinkSync(tmp)
      } catch {
        // Nothing more to do; the original file is untouched.
      }
      throw new Error(
        `Could not write ${this.filePath}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }
}
