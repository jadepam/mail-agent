import { Command } from 'commander'
import { startMcpServer } from '../mcp-server.js'

export function registerMcpCommand(program: Command): void {
  program
    .command('mcp')
    .description(`Start as MCP Server (see ma mcp -h for details)`)
    .action(async () => {
      await startMcpServer()
    })
}
