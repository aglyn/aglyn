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
 * RUN A SHORT SCRIPT ON REQUEST, SO IT IS BILLED FOR THE SECONDS IT USES
 *
 * The GitHub dispatchers and the edge sampler do two to ten seconds of work,
 * and they ran as Cloud Run JOBS. Jobs carry a one-minute minimum per instance
 * and refuse anything under 1 vCPU, so each run billed 60 vCPU-seconds: 168 runs
 * a day came to 10,143 vCPU-seconds on the October invoice, for about five
 * minutes of real work.
 *
 * A Cloud Run SERVICE bills per request and may run on a quarter of a vCPU, so
 * this wraps the same scripts in the smallest possible HTTP server. Cloud
 * Scheduler keeps its rows, its schedules and its cadence; only the address it
 * POSTs to changes.
 *
 * ## The script stays a script
 *
 * It runs as a child process rather than being imported. Both scripts exit the
 * process when they finish, and the dispatcher holds a key that should live no
 * longer than the run does. A child gives each run the same clean process it
 * had as a job, and neither script has to know it is being served.
 *
 * ## What it answers
 *
 * 204 when the script exits 0, 500 when it does not. Scheduler records a
 * non-2xx as a failed attempt, which is what makes a broken run visible.
 *
 * ⛔ Nothing here authenticates. The service is deployed with no public invoker
 * and internal ingress, so Cloud Run has already checked the OIDC token before
 * a request arrives. Do not deploy this with --allow-unauthenticated.
 */

import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT ?? 8080)

/**
 * Staged beside this file at deploy time:
 *
 *   { "script": "scripts/x.mjs", "routes": { "/name": { "ENV_VAR": "value" } } }
 *
 * A file rather than the request, so a caller can only choose between runs the
 * deploy already allowed, and can never name a script or an environment.
 */
const { script, routes } = JSON.parse(
  readFileSync(join(HERE, 'run-once-routes.json'), 'utf8'),
)

/** Under the service's own request timeout, so a hung script still answers. */
const SCRIPT_TIMEOUT_MS = Number(process.env.RUN_ONCE_TIMEOUT_MS ?? 110_000)

function runScript(env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(HERE, script)], {
      cwd: HERE,
      env: { ...process.env, ...env },
      stdio: 'inherit',
      timeout: SCRIPT_TIMEOUT_MS,
    })
    child.on('error', (error) => {
      console.error(`could not start ${script}: ${error.message}`)
      resolve(false)
    })
    child.on('exit', (code) => resolve(code === 0))
  })
}

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost')
  const env = Object.hasOwn(routes, pathname) ? routes[pathname] : null
  if (req.method !== 'POST' || env === null) {
    res.writeHead(404).end()
    return
  }
  req.resume()
  const ok = await runScript(env)
  res.writeHead(ok ? 204 : 500).end()
})

server.listen(PORT)
