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

// Proves the tenant's "Site import crawler bypass" both ways (AGL-4085).
//
//   node --env-file=<scratch>/edge.env tools/scripts/prove-site-import-edge.mjs
//   node --env-file=<scratch>/edge.env tools/scripts/prove-site-import-edge.mjs --url=https://aglyn.com/pricing
//
// READ-ONLY: seven GETs, no redirect followed, nothing written anywhere. The
// cases and the verdict are in `lib/site-import-edge-proof.mjs`; the short
// version is that the secret with AglynBot must pass and every near miss
// (no secret, a wrong one, another user agent) must still be challenged.
//
// The secret is read from SITE_IMPORT_EDGE_TOKEN, the value the console holds
// and the rule matches. It is never printed, and it is only ever sent to
// aglyn.com or one <name>.aglyn.app, the hosts the tenant project serves for
// Aglyn. Bring it in without echoing it or putting it in shell history: a
// scratch env file outside the repo holding one line,
// `SITE_IMPORT_EDGE_TOKEN=<the value>`, read by Node itself:
//
//   node --env-file=<scratch>/edge.env tools/scripts/prove-site-import-edge.mjs
//
// then delete the scratch file.
//
// Exit codes: 0 proved; 1 a case answered against the rule; 2 cannot prove
// (no secret, a refused URL, or the control was not admitted from here).

import {
  DEFAULT_PROOF_URL,
  proofCases,
  targetProblem,
  tokenProblem,
  verdict,
  wrongTokenFor,
} from './lib/site-import-edge-proof.mjs'

const args = process.argv.slice(2)
if (args.includes('--help') || args.includes('-h')) {
  console.log(
    'Usage: SITE_IMPORT_EDGE_TOKEN=… node tools/scripts/prove-site-import-edge.mjs [--url=<https://aglyn.com/…>] [--json]\n\n' +
      'Read-only. Sends the site import secret with AglynBot to one page of a site the tenant\n' +
      'project serves for Aglyn, and the near misses beside it, and says whether the edge\n' +
      'answered each one as "Site import crawler bypass" requires.\n\n' +
      'Exit codes: 0 proved, 1 a case answered against the rule, 2 cannot prove.',
  )
  process.exit(0)
}
const JSON_OUT = args.includes('--json')
const target = args.find((arg) => arg.startsWith('--url='))?.slice('--url='.length) ?? DEFAULT_PROOF_URL
const unknown = args.filter((arg) => arg !== '--json' && !arg.startsWith('--url='))
if (unknown.length) {
  console.error(`Unknown argument(s): ${unknown.join(' ')} (try --help)`)
  process.exit(2)
}

const refusedTarget = targetProblem(target)
if (refusedTarget) {
  console.error(`Refusing the target: ${refusedTarget}.`)
  process.exit(2)
}
const token = String(process.env['SITE_IMPORT_EDGE_TOKEN'] ?? '').trim()
const refusedToken = tokenProblem(token)
if (refusedToken) {
  console.error(
    `${refusedToken}. Exiting 2: without the value the rule matches, nothing here can be proved, ` +
      'and a run that sent nothing must never read as a pass. See the header of this file for ' +
      'bringing it into the environment without printing it.',
  )
  process.exit(2)
}

const targetUrl = new URL(target)
const robotsUrl = new URL('/robots.txt', targetUrl)

async function ask(url, headers) {
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      headers: { accept: 'text/html,*/*;q=0.8', ...headers },
      signal: AbortSignal.timeout(15_000),
    })
    await response.body?.cancel().catch(() => undefined)
    return { status: response.status, mitigated: response.headers.get('x-vercel-mitigated') }
  } catch (error) {
    return { status: 0, mitigated: null, error: String(error?.name ?? error) }
  }
}

const results = []
for (const proofCase of proofCases(token, wrongTokenFor(token))) {
  const url = proofCase.path === 'robots' ? robotsUrl : targetUrl
  const answer = await ask(url, proofCase.headers)
  results.push({ id: proofCase.id, name: proofCase.name, expect: proofCase.expect, control: proofCase.control, ...answer })
}

const { exitCode, lines } = verdict(results)
if (JSON_OUT) {
  // Names, expectations and answers only: the headers sent are never in it.
  console.log(
    JSON.stringify(
      {
        target: targetUrl.toString(),
        exitCode,
        results: results.map(({ id, name, expect, status, mitigated, error }) => ({ id, name, expect, status, mitigated, error })),
      },
      null,
      2,
    ),
  )
} else {
  console.log(`Proving "Site import crawler bypass" against ${targetUrl}:\n`)
  console.log(lines.join('\n'))
}
process.exit(exitCode)
