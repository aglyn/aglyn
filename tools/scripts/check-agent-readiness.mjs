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

// Fails when a site publishes an invitation the edge does not honor.
//
//   npm run check:agent-readiness
//
// Two invariants, the same shape — something we PUBLISH measured against what
// the WAF ADMITS — and both silent when they break:
//
//   1. The AI agents `robots.txt` INVITES are the agents the WAF ADMITS
//      (AGL-2716).
//   2. Every concrete path `/openapi.json` ADVERTISES is one an UNNAMED machine
//      client can actually reach (AGL-2748).
//   3. The MCP server (AGL-4225): every address it advertises composes to a
//      route in the console tree, every document that names the issuer or the
//      resource takes it from the one origin helper, the tenant API catalog
//      and the MCP Registry entry name what the console serves, and every
//      machine path is admitted at the edge or NAMED as still owed a bypass.
//      See `lib/agent-readiness.mjs`.
//
// Nothing here touches the network. It reads source files and compares lists.
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

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  advertisedConnectorPaths,
  catalogProblems,
  originAgreementProblems,
  readDiscoveryRoutes,
  readPathConstants,
  registryEntryProblems,
  routeFileFor,
} from './lib/agent-readiness.mjs'
import { EXPECTED_POSTURE } from './lib/firewall-posture.mjs'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const AGENTS_SOURCE = join(
  REPO_ROOT,
  'libs/aglyn/src/lib/app-utils/search-indexing.ts',
)
const OPENAPI_SOURCE = join(
  REPO_ROOT,
  'libs/aglyn/src/lib/app-utils/agent-openapi.ts',
)
const RULE_NAME = 'AI agent bypass'
const TENANT_PROJECT = 'aglyn-tenant'
const CONSOLE_PROJECT = 'aglyn-console'

/**
 * Console machine paths the MCP surface advertises that the declared WAF
 * posture does NOT yet admit to a stranger (AGL-4225).
 *
 * Production answers `POST /api/mcp` with a 429 challenge to a client whose
 * User-Agent is not on the browser path — which is every MCP client. The
 * bypass is live configuration: it is applied with PATCH `rules.insert`, never
 * from a code change, and only with the owner's go-ahead. Until it is, these
 * are listed here BY NAME so the gap is printed on every run instead of
 * hidden, and the check fails the moment one becomes admitted and is still
 * listed — so the list can only shrink.
 */
const OWED_CONSOLE_BYPASS = new Set([
  '/api/mcp',
  '/api/mcp/server-card',
  '/api/oauth/register',
  '/api/oauth/token',
  '/api/oauth/revoke',
])

/**
 * Advertised paths that answer HTML to a person, whose posture is a product
 * decision rather than a defect.
 *
 * `/search` renders a page. The challenge is doing real work there — a search
 * endpoint is the most expensive thing an unnamed crawler can hammer — and the
 * agents named in `robots.txt` still reach it through the User-Agent rule.
 * Contrast `/api/host` and `/api/screen`, which exist only for machines and
 * have no reader that could ever solve a challenge.
 *
 * Adding to this set is a deliberate act. That is what the set is for.
 */
const PAGE_PATHS = new Set(['/search'])

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
}

/**
 * The paths the tenant's OpenAPI document advertises.
 *
 * Two spellings, because two of them are conditional on the customer's own
 * content and are assigned rather than declared: a quoted key inside the
 * `paths` object, and a `paths['…'] =` assignment for the feed and the search
 * page. Both anchor to a quoted literal, so a path assembled by concatenation
 * would be missed — which is why the pass line prints the count. Compare it
 * against the operation count in the served document if you ever doubt it.
 */
function readAdvertisedPaths() {
  let source
  try {
    source = readFileSync(OPENAPI_SOURCE, 'utf8')
  } catch {
    return fail(`cannot read ${OPENAPI_SOURCE} — did the builder move?`)
  }
  const declared = [...source.matchAll(/^ {4}'(\/[^']*)': \{$/gm)]
  const assigned = [...source.matchAll(/^\s*paths\['(\/[^']*)'\] = \{$/gm)]
  const paths = [...new Set([...declared, ...assigned].map((entry) => entry[1]))]
  if (paths.length === 0) {
    return fail(
      'no paths parsed out of agent-openapi.ts. If the `paths` object was ' +
        'reshaped, update this parser rather than deleting the check.',
    )
  }
  return paths
}

/** Whether one declared path condition matches `path`. */
function pathConditionMatches(condition, path) {
  const values = condition.valueAnyOf ?? [condition.value]
  if (condition.op === 'eq') return values.includes(path)
  if (condition.op === 'pre') return values.some((value) => path.startsWith(value))
  if (condition.op === 're') return values.some((value) => new RegExp(value).test(path))
  // An op this guard does not model is not evidence of admission.
  return false
}

/**
 * The rule that admits an UNNAMED machine client to `path`, or null.
 *
 * A group admits only when EVERY condition in it is a path condition, and that
 * is the whole subtlety. The plugin job runner is bypassed by path AND a shared
 * secret, so a stranger does not reach it. The `AI agent bypass` is a
 * User-Agent alone, so it admits two dozen names and nobody else. Counting
 * either as admission would report the reachable set as larger than it is —
 * the direction that hides the bug instead of showing it.
 */
function admittingRule(project, path) {
  for (const rule of project.bypassRules ?? []) {
    const groups = [
      rule.conditions ?? [],
      ...(rule.alsoRequiresGroups ?? []).map((condition) => [condition]),
    ]
    for (const group of groups) {
      if (group.length === 0) continue
      const admits = group.every(
        (condition) =>
          condition.type === 'path' && pathConditionMatches(condition, path),
      )
      if (admits) return rule.name
    }
  }
  return null
}

const tenant = EXPECTED_POSTURE.find(
  (project) => project.project === TENANT_PROJECT,
)
if (!tenant) fail(`no \`${TENANT_PROJECT}\` project in the declared posture`)

/*
  TEMPLATED PATHS ARE SKIPPED, and the reason is not laziness. `/{path}` is
  every page on the site, whose challenge is the product decision `PAGE_PATHS`
  describes; `/{collectionSlug}/rss.xml` has its admission asserted by the rule
  that declares it, as a regex anchored to the suffix. Matching a WAF pattern
  against an OpenAPI template would be comparing two approximations, and a
  guard that is allowed to be approximately right stops being evidence.
*/
const unreachable = []
let examined = 0
for (const path of readAdvertisedPaths()) {
  if (path.includes('{') || PAGE_PATHS.has(path)) continue
  examined += 1
  if (!admittingRule(tenant, path)) unreachable.push(path)
}

if (unreachable.length === 0) {
  console.log(
    `✔ ${TENANT_PROJECT}: ${examined} advertised paths, every one admitted to ` +
      'a client whose User-Agent nobody has heard of',
  )
} else {
  console.error(
    `✖ ${TENANT_PROJECT}: /openapi.json advertises paths the WAF challenges`,
  )
  for (const path of unreachable) console.error(`   ${path}`)
  console.error(
    '   → an agent reads the contract, calls what it names, and is answered a\n' +
      '     429 challenge it cannot solve. A document that can be read but not\n' +
      '     acted on spends the caller trust it earned and then refuses them.',
  )
  console.error(
    '\nFix by adding the path to a bypass rule in ' +
      'tools/scripts/lib/firewall-posture.mjs — exact paths, not a prefix, ' +
      'unless the whole namespace under it is public. Then PATCH the live ' +
      'rule; never use PUT. If the path genuinely belongs to a human-facing ' +
      `page, add it to \`PAGE_PATHS\` above and say why.`,
  )
}

// ── The MCP server (AGL-4225) ─────────────────────────────────────────────

const read = (relative) => {
  try {
    return readFileSync(join(REPO_ROOT, relative), 'utf8')
  } catch {
    return fail(`cannot read ${relative} — did it move?`)
  }
}

const discoverySource = read('libs/aglyn/src/lib/app-utils/connector-discovery.ts')
const constants = readPathConstants(discoverySource)
const discoveryRoutes = readDiscoveryRoutes(discoverySource, constants)
if (!discoveryRoutes) fail('could not parse CONNECTOR_DISCOVERY_ROUTES out of connector-discovery.ts')

const mcpProblems = []
const exists = (relative) => existsSync(join(REPO_ROOT, relative))
const advertised = advertisedConnectorPaths(constants)
for (const { path, what } of advertised) {
  if (!routeFileFor(path, discoveryRoutes, exists)) {
    mcpProblems.push(`${what} ${path} composes to no route in apps/console/app`)
  }
}

mcpProblems.push(
  ...originAgreementProblems({
    routeSources: Object.fromEntries(
      [
        'apps/console/app/api/mcp/route.ts',
        'apps/console/app/api/mcp/server-card/route.ts',
        'apps/console/app/api/oauth/metadata/protected-resource/route.ts',
        'apps/console/app/api/oauth/metadata/authorization-server/route.ts',
      ].map((file) => [file, read(file)]),
    ),
    builderSource: read('libs/tenant/data/admin/src/lib/server/connector-oauth.ts'),
  }),
  ...catalogProblems(read('apps/tenant/app/api/api-catalog/route.ts')),
)

let registryEntry = null
try {
  registryEntry = JSON.parse(read('integrations/mcp-registry/server.json'))
} catch {
  mcpProblems.push('integrations/mcp-registry/server.json is not JSON')
}
if (registryEntry) mcpProblems.push(...registryEntryProblems(registryEntry, constants))

const consoleProject = EXPECTED_POSTURE.find((project) => project.project === CONSOLE_PROJECT)
if (!consoleProject) fail(`no \`${CONSOLE_PROJECT}\` project in the declared posture`)
const owed = []
for (const { path, kind } of advertised) {
  if (kind !== 'machine') continue
  const admitted = admittingRule(consoleProject, path)
  if (admitted && OWED_CONSOLE_BYPASS.has(path)) {
    mcpProblems.push(
      `${path} is admitted by \`${admitted}\` but still listed in OWED_CONSOLE_BYPASS — remove it`,
    )
  } else if (!admitted && !OWED_CONSOLE_BYPASS.has(path)) {
    mcpProblems.push(`${path} is advertised and challenged at the edge, and not named as owed a bypass`)
  } else if (!admitted) {
    owed.push(path)
  }
}

if (mcpProblems.length === 0) {
  console.log(
    `✔ MCP: ${advertised.length} advertised addresses compose to console routes; ` +
      'one origin; the API catalog and the registry entry agree',
  )
} else {
  console.error('✖ MCP: what is published about the MCP server disagrees with the source')
  for (const problem of mcpProblems) console.error(`   ${problem}`)
}
if (owed.length > 0) {
  console.log(
    `⚠ ${CONSOLE_PROJECT}: ${owed.length} MCP machine paths still owe a WAF bypass ` +
      `(live config, applied by hand): ${owed.join(', ')}`,
  )
}

if (drifted || unreachable.length > 0 || mcpProblems.length > 0) process.exit(1)
process.exit(0)
