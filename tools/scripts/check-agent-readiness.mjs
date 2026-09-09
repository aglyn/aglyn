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

// Fails when the AI agents a site INVITES in `robots.txt` are not the same set
// the WAF ADMITS (AGL-2716).
//
//   npm run check:agent-readiness
//
// Nothing here touches the network. It reads two source files and compares two
// lists.
//
// ## Why this guard exists
//
// The invitation and the admission live in different languages, in different
// trees, for different runtimes:
//
//   robots.txt  `AI_AGENT_USER_AGENTS` in
//               libs/aglyn/src/lib/app-utils/search-indexing.ts
//   the WAF     the `AI agent bypass` rule's User-Agent alternation in
//               tools/scripts/lib/firewall-posture.mjs
//
// Neither can import the other — one is TypeScript compiled into the tenant
// bundle, the other is a plain module a node script reads — so the two lists
// are copies, and copies drift.
//
// The drift is SILENT and it fails in the worse direction. A site that names
// `ClaudeBot` in `robots.txt` and challenges it at the edge has published an
// invitation it does not honor: the agent reads the invitation, follows it, and
// gets a 429. Nothing reports that. The reverse — admitted at the edge, unnamed
// in `robots.txt` — is merely untidy, and this fails on it too, because a list
// that is allowed to be approximately right stops being evidence of anything.
//
// Exit codes:
//   0  the two lists match
//   1  they differ
//   2  cannot check: a file moved, or a list could not be parsed

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { EXPECTED_POSTURE } from './lib/firewall-posture.mjs'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const AGENTS_SOURCE = join(
  REPO_ROOT,
  'libs/aglyn/src/lib/app-utils/search-indexing.ts',
)
const RULE_NAME = 'AI agent bypass'

function fail(message) {
  console.error(`✖ ${message}`)
  process.exit(2)
}

/**
 * The `robots.txt` list, read out of the TypeScript source.
 *
 * A regex over source rather than an import, because this is a node script and
 * that is a TypeScript module inside an nx library — compiling it here would
 * cost a build step to read one array. The array is a flat literal of quoted
 * strings and the parse is anchored to its exported name, so the failure mode
 * is a loud "could not parse" rather than a quiet wrong answer.
 */
function readRobotsAgents() {
  let source
  try {
    source = readFileSync(AGENTS_SOURCE, 'utf8')
  } catch {
    return fail(`cannot read ${AGENTS_SOURCE} — did the module move?`)
  }
  const match =
    /export const AI_AGENT_USER_AGENTS: readonly string\[\] = \[([\s\S]*?)\]/.exec(
      source,
    )
  if (!match) {
    return fail(
      'could not find `AI_AGENT_USER_AGENTS` in search-indexing.ts. If it was ' +
        'renamed or reshaped, update this parser rather than deleting the check.',
    )
  }
  /*
    COMMENTS COME OUT FIRST. The entries are quoted strings, and an apostrophe
    inside a comment in the same array — `a person's behalf` — is a quote
    character to a regex that does not know it is in a comment. MEASURED: the
    first comment added inside this array made the guard report half a
    paragraph as a user-agent token.

    Stripped in the order that cannot mis-pair: line comments first, so a `//`
    containing `/*` cannot open a block that swallows real entries.
  */
  const body = match[1]
    .replace(/(^|[^:])\/\/.*$/gm, '$1 ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
  const agents = [...body.matchAll(/'([^']+)'/g)].map((entry) => entry[1])
  if (agents.length === 0) fail('`AI_AGENT_USER_AGENTS` parsed as empty')
  return agents
}

/** The WAF list, read from the declared posture table. */
function readFirewallAgents() {
  const found = new Map()
  for (const project of EXPECTED_POSTURE) {
    for (const rule of project.bypassRules ?? []) {
      if (rule.name !== RULE_NAME) continue
      const condition = (rule.conditions ?? []).find(
        (entry) => entry.type === 'user_agent' && typeof entry.value === 'string',
      )
      if (!condition) {
        fail(`the \`${RULE_NAME}\` rule on ${project.project} has no user_agent condition`)
      }
      found.set(project.project, condition.value.split('|'))
    }
  }
  if (found.size === 0) {
    fail(
      `no project declares a \`${RULE_NAME}\` rule. The WAF admits no AI agent, ` +
        'so every one of them meets a challenge it cannot solve.',
    )
  }
  return found
}

const robotsAgents = readRobotsAgents()
const firewallAgents = readFirewallAgents()

let drifted = false
for (const [project, agents] of firewallAgents) {
  const invited = new Set(robotsAgents)
  const admitted = new Set(agents)
  const invitedNotAdmitted = robotsAgents.filter((agent) => !admitted.has(agent))
  const admittedNotInvited = agents.filter((agent) => !invited.has(agent))
  if (invitedNotAdmitted.length === 0 && admittedNotInvited.length === 0) {
    console.log(`✔ ${project}: ${agents.length} AI agents, invited and admitted`)
    continue
  }
  drifted = true
  console.error(`✖ ${project}: robots.txt and the WAF disagree`)
  if (invitedNotAdmitted.length > 0) {
    console.error(
      `   invited in robots.txt, CHALLENGED by the WAF: ${invitedNotAdmitted.join(', ')}`,
    )
    console.error(
      '   → these agents are told they may read the site and then answered 429.',
    )
  }
  if (admittedNotInvited.length > 0) {
    console.error(
      `   admitted by the WAF, unnamed in robots.txt: ${admittedNotInvited.join(', ')}`,
    )
  }
}

if (drifted) {
  console.error(
    '\nFix by editing BOTH: `AI_AGENT_USER_AGENTS` in search-indexing.ts and ' +
      `the \`${RULE_NAME}\` rule in tools/scripts/lib/firewall-posture.mjs. ` +
      'Then PATCH the live rule — see the header of firewall-posture.mjs, and ' +
      'never use PUT.',
  )
  process.exit(1)
}
process.exit(0)
