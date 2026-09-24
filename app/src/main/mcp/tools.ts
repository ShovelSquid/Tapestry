/**
 * The MCP server surface: every tool in TOOL_DEFINITIONS, wired to a caller.
 *
 * This module knows nothing about how a tool call reaches Tapestry. The shim
 * supplies a caller that forwards over the Unix socket; a test can supply one
 * that calls the command layer directly. Keeping the transport out of here is
 * what lets Plan 14 add a loopback HTTP transport over the same tool set.
 *
 * `CommandResult` is imported **as a type only**, so nothing from the command
 * layer (and therefore nothing from the kernel bridge or electron) is bundled
 * into the shim.
 */

import { McpServer } from '@modelcontextprotocol/server'
import { TOOL_DEFINITIONS } from './schemas'
import type { CommandResult } from '../commands/notes'

export type ToolCallResult = CommandResult<unknown>

export interface ToolCaller {
  call(tool: string, args: unknown): Promise<ToolCallResult>
}

/**
 * Build the MCP server, registering every tool against `caller`.
 *
 * A refusal comes back as `isError: true` with the host's own message, so the
 * model is told *why* it was refused ("grewFrom n99 is not a live note...")
 * rather than simply failing.
 */
export function buildMcpServer(caller: ToolCaller): McpServer {
  const server = new McpServer({ name: 'tapestry', version: '0.1.0' })

  for (const definition of TOOL_DEFINITIONS) {
    server.registerTool(
      definition.name,
      {
        title: definition.title,
        description: definition.description,
        inputSchema: definition.schema,
        annotations: definition.annotations,
      },
      async (args: unknown) => {
        const result = await caller.call(definition.name, args)
        if (result.ok) {
          return { content: [{ type: 'text' as const, text: JSON.stringify(result.value) }] }
        }
        return {
          content: [{ type: 'text' as const, text: result.error }],
          isError: true,
        }
      },
    )
  }

  return server
}
