#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * The executable. Deliberately the only file that touches process state, so
 * everything worth testing lives in `runCli` and is tested without a process.
 */
import { createRequire } from 'node:module'
import { runCli } from './lib/cli.js'

const version = (() => {
  try {
    // The package's own version, read at runtime rather than inlined at build
    // time, so `aglyn --version` cannot disagree with what npm installed.
    return createRequire(import.meta.url)('../package.json').version as string
  } catch {
    return '0.0.0'
  }
})()

const code = await runCli(
  process.argv.slice(2),
  {
    fetch: globalThis.fetch,
    env: process.env,
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  },
  version,
)

/*
  `process.exitCode` rather than `process.exit()`: the latter tears the process
  down before a piped stdout has necessarily flushed, so `aglyn read … | head`
  can lose the tail of a long page. Setting the code lets Node exit normally
  once the streams drain.
*/
process.exitCode = code
