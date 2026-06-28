#!/usr/bin/env node

import { Command } from 'commander'
import { registerSendCommand } from './cli/send.js'
import { registerListCommand } from './cli/list.js'
import { registerReadCommand } from './cli/read.js'
import { registerSearchCommand } from './cli/search.js'
import { registerThreadCommand } from './cli/thread.js'
import { registerTrashCommand } from './cli/trash.js'
import { registerReplyCommand } from './cli/reply.js'
import { registerForwardCommand } from './cli/forward.js'
import { registerDownloadCommand } from './cli/download.js'
import { registerMeCommand } from './cli/accounts-me.js'
import { registerMcpCommand } from './cli/mcp.js'
import { registerModeCommand } from './cli/mode.js'
import { registerAccountCommand } from './cli/account.js'
import { registerInitCommand } from './cli/init.js'

const program = new Command()

program
  .name('ma')
  .version('0.1.0')
  .description(
    `Unified Email Agent Middleware — supports traditional mailboxes, private deployments, and Agent-native mailboxes`,
  )

registerSendCommand(program)
registerListCommand(program)
registerReadCommand(program)
registerSearchCommand(program)
registerThreadCommand(program)
registerTrashCommand(program)
registerReplyCommand(program)
registerForwardCommand(program)
registerDownloadCommand(program)
registerMeCommand(program)
registerMcpCommand(program)
registerModeCommand(program)
registerAccountCommand(program)
registerInitCommand(program)

program.parse()
