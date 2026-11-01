#!/usr/bin/env node
import { main } from '../dist/context-cli.js'
import { formatCliError } from '../dist/cli-error.js'
main().catch(err => {
  process.stderr.write(formatCliError(err))
  process.exitCode = 1
})
