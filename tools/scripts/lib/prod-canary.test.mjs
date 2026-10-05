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

// The production canary's decisions (AGL-3567). No network: every response,
// project and deployment list here is a literal shaped like what Vercel and
// GitHub returned on 2026-10-05.
//
// Written from both sides, as `front-door.test.mjs` is: a canary that cannot
// say red is the 18 minutes beta.222 served 504s, and a canary that says red
// on a bot challenge or one customer's broken page rolls production back for
// nothing and turns auto-assign off behind it.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  DEFAULT_TENANT_HOSTS,
  EXIT,
  PROJECTS,
  alreadyGraded,
  automationBypassFrom,
  canaryPlan,
  canaryRecord,
  classifyResponse,
  decideVerdict,
  formatReport,
  freshHostSpelling,
  gradeRound,
  hostOf,
  parseHostList,
  pickRollbackTarget,
  projectForEnvironment,
  recordDescription,
  servingState,
  siteSpelling,
  slackPayload,
  spellingCapacity,
} from './prod-canary.mjs'

const PAGE = '<!DOCTYPE html><html><head><script src="/_next/static/chunks/a.js"></script></head><body>x</body></html>'
const HTML = 'text/html; charset=utf-8'
const CHECKPOINT = '<html><title>Vercel Security Checkpoint</title></html>'

// ---------------------------------------------------------------- classify --

test('a 504 and a timeout are the deployment failing', () => {
  assert.equal(classifyResponse({ kind: 'miss', status: 504, contentType: HTML, body: 'An error occurred' }).outcome, 'server')
  assert.equal(classifyResponse({ kind: 'page', status: 500, contentType: HTML, body: PAGE }).outcome, 'server')
  const hang = classifyResponse({ kind: 'miss', error: { name: 'TimeoutError' }, budgetMs: 15_000 })
  assert.equal(hang.outcome, 'server')
  assert.match(hang.detail, /15000 ms/)
})

test('the not-found render on a fresh path is a pass — that is the uncached layout', () => {
  const miss = classifyResponse({ kind: 'miss', status: 404, contentType: HTML, body: PAGE })
  assert.equal(miss.outcome, 'ok')
  assert.match(miss.detail, /not-found/)
  // …but only a COMPLETE render of our app.
  assert.equal(classifyResponse({ kind: 'miss', status: 404, contentType: HTML, body: '<html>' }).outcome, 'server')
})

test('a real page that 404s is the deployment’s, not a pass', () => {
  assert.equal(classifyResponse({ kind: 'page', status: 404, contentType: HTML, body: PAGE }).outcome, 'server')
  assert.equal(classifyResponse({ kind: 'page', status: 200, contentType: HTML, body: PAGE }).outcome, 'ok')
})

test('what the canary cannot see is never a verdict on the site', () => {
  assert.equal(classifyResponse({ kind: 'page', status: 429, contentType: HTML, body: CHECKPOINT }).outcome, 'canary')
  // A checkpoint served as 200 is still a checkpoint.
  assert.equal(classifyResponse({ kind: 'page', status: 200, contentType: HTML, body: CHECKPOINT }).outcome, 'canary')
  assert.equal(classifyResponse({ kind: 'page', status: 429, contentType: HTML, body: 'slow down' }).outcome, 'canary')
  assert.equal(classifyResponse({ kind: 'page', status: 307, location: 'https://x' }).outcome, 'canary')
  assert.equal(classifyResponse({ kind: 'page', status: 403, contentType: HTML, body: '' }).outcome, 'canary')
  for (const code of ['ENOTFOUND', 'ECONNRESET', 'UND_ERR_CONNECT_TIMEOUT']) {
    assert.equal(classifyResponse({ kind: 'page', error: { name: 'TypeError', code } }).outcome, 'canary')
  }
  assert.equal(classifyResponse({ kind: 'health', status: 429, contentType: HTML, body: CHECKPOINT }).outcome, 'canary')
})

test('health: a JSON answer that reports a dependency down is degraded, a crash is server', () => {
  const ok = classifyResponse({
    kind: 'health',
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ status: 'ok', commit: '9af0a1b' }),
  })
  assert.deepEqual([ok.outcome, /9af0a1b/.test(ok.detail)], ['ok', true])
  assert.equal(
    classifyResponse({ kind: 'health', status: 503, contentType: 'application/json', body: '{"status":"degraded"}' }).outcome,
    'degraded',
  )
  assert.equal(classifyResponse({ kind: 'health', status: 500, contentType: HTML, body: 'Internal' }).outcome, 'server')
  assert.equal(classifyResponse({ kind: 'health', status: 200, contentType: HTML, body: PAGE }).outcome, 'server')
})

// ------------------------------------------------------------------- plan --

test('host list: commas or spaces, schemes dropped, paths merged per host, root always', () => {
  assert.deepEqual(
    parseHostList('demo.aglyn.app, https://EDR.aglyn.app/services\nedr.aglyn.app/about/ edr.aglyn.app/services'),
    [
      { host: 'demo.aglyn.app', paths: ['/'] },
      { host: 'edr.aglyn.app', paths: ['/', '/services', '/about'] },
    ],
  )
  assert.deepEqual(parseHostList(''), [])
  assert.throws(() => parseHostList('not a host!'), /not a hostname/)
})

test('the tenant plan renders a fresh path per host and only grades tenant rows', () => {
  const rows = canaryPlan({
    project: PROJECTS.tenant,
    tenantHosts: parseHostList('demo.aglyn.app aglyn.com/pricing'),
    consoleHost: 'app.aglyn.com',
    nonce: 'n1',
  })
  const urls = rows.map((row) => row.url)
  assert.ok(urls.includes('https://demo.aglyn.app/?__canary=n1'))
  assert.ok(urls.includes('https://aglyn.com/pricing?__canary=n1'))
  assert.ok(urls.includes('https://demo.aglyn.app/__aglyn-canary-n1'))
  assert.ok(urls.includes('https://aglyn.com/__aglyn-canary-n1'))
  const consoleHealth = rows.find((row) => row.host === 'app.aglyn.com')
  assert.equal(consoleHealth.counts, false, 'a console failure must never roll the tenant back')
  assert.ok(rows.filter((row) => row.host !== 'app.aglyn.com').every((row) => row.counts))
})

test('the console plan grades the console', () => {
  const rows = canaryPlan({ project: PROJECTS.console, tenantHosts: [], consoleHost: 'app.aglyn.com', nonce: 'n' })
  assert.deepEqual(rows.map((row) => row.kind).sort(), ['health', 'miss', 'page'])
  assert.ok(rows.every((row) => row.counts && row.host === 'app.aglyn.com'))
})

test('a GitHub deployment environment maps to its project; previews and docs do not', () => {
  assert.equal(projectForEnvironment('Production – aglyn-tenant'), PROJECTS.tenant)
  assert.equal(projectForEnvironment('Production – aglyn-console'), PROJECTS.console)
  assert.equal(projectForEnvironment('Production – aglyn-docs'), null)
  assert.equal(projectForEnvironment('Preview – aglyn-console'), null)
  assert.equal(projectForEnvironment(undefined), null)
})

// ------------------------------------------------------------------ rounds --

const row = (host, outcome, counts = true) => ({ host, outcome, counts })

test('a round is red only when enough hosts fail at once', () => {
  const two = [row('a', 'server'), row('b', 'server'), row('c', 'ok')]
  assert.equal(gradeRound(two).status, 'red')
  assert.deepEqual(gradeRound(two).failingHosts, ['a', 'b'])
  // One customer site breaking its own content is not a platform rollback.
  assert.equal(gradeRound([row('a', 'server'), row('b', 'ok')]).status, 'isolated')
  // With one host in the plan, that host is enough.
  assert.equal(gradeRound([row('a', 'server'), row('a', 'ok')]).status, 'red')
  assert.equal(gradeRound([row('a', 'server'), row('b', 'ok')], { minFailingHosts: 1 }).status, 'red')
})

test('informational rows and blind rows decide nothing', () => {
  assert.equal(gradeRound([row('a', 'ok'), row('x', 'server', false), row('y', 'server', false)]).status, 'green')
  assert.equal(gradeRound([row('a', 'canary'), row('b', 'canary')]).status, 'inconclusive')
  assert.equal(gradeRound([row('a', 'canary'), row('b', 'ok')]).status, 'green')
  assert.equal(gradeRound([row('a', 'degraded')]).status, 'green')
})

const rounds = (...statuses) => statuses.map((status) => ({ status }))

test('only N consecutive red rounds roll back', () => {
  assert.equal(decideVerdict(rounds('red', 'red', 'red')), 'rollback')
  assert.equal(decideVerdict(rounds('green', 'red', 'red', 'red')), 'rollback')
  assert.equal(decideVerdict(rounds('red', 'red')), 'pending')
  assert.equal(decideVerdict(rounds('red', 'red'), { consecutive: 2 }), 'rollback')
})

test('a flap is reported, never acted on', () => {
  assert.equal(decideVerdict(rounds('red', 'green')), 'recovered')
  assert.equal(decideVerdict(rounds('red', 'red', 'green')), 'recovered')
  assert.equal(decideVerdict(rounds('red', 'green', 'red', 'green', 'red'), { final: true }), 'degraded')
  assert.equal(decideVerdict(rounds('green')), 'green')
  assert.equal(decideVerdict(rounds('inconclusive', 'green')), 'green')
})

test('failures that never span enough hosts are degraded; blindness is inconclusive', () => {
  assert.equal(decideVerdict(rounds('isolated', 'isolated', 'isolated')), 'degraded')
  assert.equal(decideVerdict(rounds('red', 'isolated', 'red')), 'degraded')
  assert.equal(decideVerdict(rounds('inconclusive', 'inconclusive', 'inconclusive')), 'inconclusive')
  assert.equal(decideVerdict([], { final: true }), 'inconclusive')
  assert.equal(decideVerdict(rounds('inconclusive'), { final: true }), 'inconclusive')
})

test('every verdict a human must read exits non-zero', () => {
  assert.equal(EXIT.green, 0)
  assert.equal(EXIT.recovered, 0)
  for (const verdict of ['rollback', 'degraded', 'not-serving', 'inconclusive', 'error']) {
    assert.notEqual(EXIT[verdict], 0, verdict)
  }
})

// ---------------------------------------------------------------- rollback --

// The tenant's production list on 2026-10-05, newest first, as /v6 returns it.
const dep = (uid, created, sha, extra = {}) => ({
  uid,
  created,
  createdAt: created,
  state: 'READY',
  readyState: 'READY',
  target: 'production',
  isRollbackCandidate: true,
  meta: { githubCommitSha: sha },
  ...extra,
})
const beta222 = dep('dpl_Exr', 500, 'sha222')
const beta221 = dep('dpl_CJs', 400, 'sha221')
const beta220c = dep('dpl_67X', 300, 'sha220')
const beta220b = dep('dpl_pgF', 200, 'sha220')
const LIST = [beta222, beta221, beta220c, beta220b]

test('rolls back to the newest READY production deployment older than the bad one', () => {
  const { target } = pickRollbackTarget({ deployments: LIST, bad: beta222 })
  assert.equal(target.uid, 'dpl_CJs')
})

test('never to the bad deployment, a newer one, or a redeploy of the same commit', () => {
  const redeploy = dep('dpl_redeploy', 450, 'sha222')
  const newer = dep('dpl_newer', 900, 'sha999')
  const { target } = pickRollbackTarget({ deployments: [newer, beta222, redeploy, beta221], bad: beta222 })
  assert.equal(target.uid, 'dpl_CJs')
})

test('skips what is not READY, not production, or not a rollback candidate', () => {
  const list = [
    dep('dpl_err', 450, 'shaE', { state: 'ERROR', readyState: 'ERROR' }),
    dep('dpl_prev', 440, 'shaP', { target: null }),
    dep('dpl_nope', 430, 'shaN', { isRollbackCandidate: false }),
    beta221,
  ]
  assert.equal(pickRollbackTarget({ deployments: list, bad: beta222 }).target.uid, 'dpl_CJs')
})

test('a commit recorded red is skipped; one recorded green wins over a newer unverified one', () => {
  // beta.223 fails after beta.222 was rolled back by hand and never recorded:
  // without records the picker would land on the known-bad beta.222.
  const beta223 = dep('dpl_223', 600, 'sha223')
  const list = [beta223, beta222, beta221, beta220c]
  assert.equal(pickRollbackTarget({ deployments: list, bad: beta223 }).target.uid, 'dpl_Exr')
  assert.equal(
    pickRollbackTarget({ deployments: list, bad: beta223, redShas: new Set(['sha222']) }).target.uid,
    'dpl_CJs',
  )
  const green = pickRollbackTarget({ deployments: list, bad: beta223, greenShas: new Set(['sha221']) })
  assert.equal(green.target.uid, 'dpl_CJs')
  assert.match(green.reason, /recorded green/)
})

test('no candidate is said in words, not guessed', () => {
  const result = pickRollbackTarget({ deployments: [beta222], bad: beta222 })
  assert.equal(result.target, null)
  assert.match(result.reason, /no READY production deployment/)
})

test('the v13 single-deployment shape (`id`, `createdAt`) is a valid bad deployment', () => {
  const bad = { id: 'dpl_Exr', createdAt: 500, meta: { githubCommitSha: 'sha222' } }
  assert.equal(pickRollbackTarget({ deployments: LIST, bad }).target.uid, 'dpl_CJs')
})

test('the newest canary status per commit is its record', () => {
  const context = 'prod-canary/aglyn-tenant'
  assert.equal(canaryRecord([{ context, state: 'failure' }, { context, state: 'success' }], context), 'red')
  assert.equal(canaryRecord([{ context: 'main-gate/fast', state: 'failure' }, { context, state: 'success' }], context), 'green')
  assert.equal(canaryRecord([], context), null)
  assert.equal(canaryRecord(null, context), null)
})

test('serving state reads the production alias, not the project target', () => {
  // 2026-10-05: the console's `targets.production` named a deployment still
  // BUILDING while `app.aglyn.com` served the previous release.
  const project = { targets: { production: { id: 'dpl_building' } }, autoAssignCustomDomains: false }
  const alias = { deploymentId: 'dpl_CJs' }
  assert.deepEqual(servingState({ alias, project }, 'dpl_CJs'), { serving: true, productionId: 'dpl_CJs', autoAssign: false })
  assert.equal(servingState({ alias, project }, 'dpl_building').serving, false)
  assert.equal(servingState({}, 'dpl_Exr').productionId, null)
  assert.equal(servingState({ alias }, null).serving, false)
  assert.equal(servingState({ alias, project: {} }, 'dpl_CJs').autoAssign, true)
})

test('every canaried project names the alias that proves what production serves', () => {
  assert.equal(PROJECTS.tenant.alias, '*.aglyn.app')
  assert.equal(PROJECTS.console.alias, 'app.aglyn.com')
})

// ------------------------------------------------------------------ report --

test('a dry run says so in the headline and the body', () => {
  const payload = slackPayload({
    project: PROJECTS.tenant,
    verdict: 'rollback',
    deployment: beta222,
    rollback: { action: 'would-roll-back', target: beta221, reason: 'r' },
    dryRun: true,
  })
  assert.match(payload.text, /DRY RUN/)
  assert.match(payload.text, /WOULD be rolled back/)
  assert.match(payload.blocks[0].text.text, /DRY RUN/)
})

test('a real rollback tells the reader auto-assign is now off', () => {
  const payload = slackPayload({
    project: PROJECTS.tenant,
    verdict: 'rollback',
    deployment: beta222,
    rollback: { action: 'rolled-back', target: beta221, reason: 'r', after: 'green' },
  })
  assert.match(payload.text, /ROLLED BACK to dpl_CJs/)
  assert.match(payload.blocks[0].text.text, /auto-assign OFF/)
  assert.doesNotMatch(payload.text, /DRY RUN/)
})

test('the report names every row, its verdict and what it was not counted for', () => {
  const lines = formatReport({
    project: PROJECTS.tenant,
    verdict: 'green',
    deployment: beta221,
    rounds: [
      {
        status: 'green',
        failingHosts: [],
        results: [
          { kind: 'miss', url: 'https://demo.aglyn.app/__aglyn-canary-n', outcome: 'ok', detail: 'd', ms: 600, cache: 'MISS', counts: true },
          { kind: 'health', url: 'https://app.aglyn.com/api/health', outcome: 'ok', detail: 'h', ms: 90, counts: false },
        ],
      },
    ],
  })
  assert.match(lines[0], /GREEN/)
  assert.ok(lines.some((line) => /✓ miss .*cache=MISS/.test(line)))
  assert.ok(lines.some((line) => /\[informational\]/.test(line)))
})

// ------------------------------------------------------ candidate (AGL-3571) --

// What `normalizeHostAlias` (apps/tenant/utils/get-host.ts) does to a
// `?tenantHost=` value, restated so these literals can be checked here; the
// tenant spec `probe-host-spelling.spec.ts` checks the same literals against
// the real resolver.
const resolve = (spelling) => {
  const trimmed = spelling.trim().toLowerCase()
  if (trimmed.startsWith('cname--')) return trimmed
  const bare = trimmed.replace(/\.+$/, '')
  if (!bare.includes('.')) return bare
  return bare.endsWith('.aglyn.app') ? bare.slice(0, -'.aglyn.app'.length) : `cname--${bare}`
}

test('fresh spellings: literals the tenant resolver spec pins too', () => {
  assert.equal(freshHostSpelling('ready-to-roll.aglyn.app', 0), 'ready-to-roll.aglyn.app')
  assert.equal(freshHostSpelling('ready-to-roll.aglyn.app', 5), 'ReAdy-to-roll.aglyn.app')
  assert.equal(spellingCapacity('ready-to-roll.aglyn.app'), 2 ** 19)
  assert.equal(freshHostSpelling('ready-to-roll.aglyn.app', 2 ** 19 + 1), 'Ready-to-roll.aglyn.app.')
  assert.equal(freshHostSpelling('aglyn.com', 3), 'cname--AGlyn.com')
  // The custom-domain form has no dots to spend, so it cycles.
  assert.equal(freshHostSpelling('aglyn.com', 256 + 3), 'cname--AGlyn.com')
})

test('every fresh spelling names the same site, and no two numbers share one', () => {
  for (const host of ['ready-to-roll.aglyn.app', 'edr-construction.aglyn.app', 'demo.aglyn.app', 'aglyn.com']) {
    const seen = new Set()
    const limit = Math.min(4 * spellingCapacity(host), 2000)
    for (let n = 0; n < limit; n++) {
      const spelling = freshHostSpelling(host, n)
      assert.equal(resolve(spelling), siteSpelling(host), spelling)
      if (n < spellingCapacity(host) || host.endsWith('.aglyn.app')) {
        assert.ok(!seen.has(spelling), `${host} #${n} repeats ${spelling}`)
      }
      seen.add(spelling)
      // The canonical-domain redirect tests the raw segment for this prefix.
      if (!host.endsWith('.aglyn.app')) assert.ok(spelling.startsWith('cname--'))
    }
  }
  assert.equal(siteSpelling('ready-to-roll.aglyn.app'), 'ready-to-roll')
  assert.equal(siteSpelling('aglyn.com'), 'cname--aglyn.com')
})

test('the candidate plan renders real pages fresh on the deployment URL, never the public domain', () => {
  const tenantHosts = parseHostList(DEFAULT_TENANT_HOSTS)
  const plan = (nonce) =>
    canaryPlan({
      project: PROJECTS.tenant,
      tenantHosts,
      consoleHost: 'app.aglyn.com',
      nonce,
      deploymentHost: 'aglyn-tenant-ayy9d9vq5-aglyn.vercel.app',
    })
  const rows = plan('n1')
  const tenantRows = rows.filter((row) => row.counts)
  assert.ok(tenantRows.every((row) => row.url.startsWith('https://aglyn-tenant-ayy9d9vq5-aglyn.vercel.app/')))
  const pages = rows.filter((row) => row.kind === 'page')
  // Every default real page: ready-to-roll's home and EDR's three.
  for (const [host, path] of [
    ['ready-to-roll.aglyn.app', '/'],
    ['edr-construction.aglyn.app', '/'],
    ['edr-construction.aglyn.app', '/services'],
    ['edr-construction.aglyn.app', '/contact'],
  ]) {
    const row = pages.find((page) => page.host === host && page.path === path)
    assert.ok(row?.fresh, `${host}${path}`)
    const url = new URL(row.url)
    assert.equal(url.pathname, path)
    assert.equal(resolve(url.searchParams.get('tenantHost')), siteSpelling(host))
  }
  const spellings = pages.map((row) => new URL(row.url).searchParams.get('tenantHost'))
  // Two paths of one site never share a spelling, and neither does the next round.
  const keys = pages.map((row, i) => `${row.path}|${spellings[i]}`)
  assert.equal(new Set(spellings.filter((_, i) => pages[i].host === 'edr-construction.aglyn.app')).size, 3)
  const next = plan('n2').filter((row) => row.kind === 'page').map((row) => `${row.path}|${new URL(row.url).searchParams.get('tenantHost')}`)
  assert.ok(next.every((key) => !keys.includes(key)))
  // The layout row per site, under the spelling its visitors' requests carry.
  const miss = rows.find((row) => row.kind === 'miss' && row.host === 'aglyn.com')
  assert.equal(new URL(miss.url).searchParams.get('tenantHost'), 'cname--aglyn.com')
  assert.match(new URL(miss.url).pathname, /^\/__aglyn-canary-n1$/)
  assert.ok(rows.some((row) => row.kind === 'health' && row.url.endsWith('.vercel.app/api/health') && row.counts))
  assert.equal(rows.find((row) => row.host === 'app.aglyn.com').counts, false)
})

test('a fresh row answered from a cache is blind, not a pass and not a failure', () => {
  const hit = classifyResponse({ kind: 'page', status: 200, contentType: HTML, body: PAGE, fresh: true, cache: 'HIT' })
  assert.equal(hit.outcome, 'canary')
  assert.match(hit.detail, /proves no render/)
  assert.equal(classifyResponse({ kind: 'page', status: 200, contentType: HTML, body: PAGE, fresh: true, cache: 'STALE' }).outcome, 'canary')
  assert.equal(classifyResponse({ kind: 'page', status: 200, contentType: HTML, body: PAGE, fresh: true, cache: 'MISS' }).outcome, 'ok')
  // A public-domain page row keeps AGL-3567's reading: cached is still a pass.
  assert.equal(classifyResponse({ kind: 'page', status: 200, contentType: HTML, body: PAGE, cache: 'HIT' }).outcome, 'ok')
  // The beta.223 shape: a fresh render that hangs is the deployment failing.
  assert.equal(classifyResponse({ kind: 'page', error: { name: 'TimeoutError' }, fresh: true }).outcome, 'server')
})

test('the automation bypass is read from the project map, which is keyed by the secret', () => {
  assert.equal(
    automationBypassFrom({ protectionBypass: { s3cr3t: { scope: 'automation-bypass', createdAt: 1 }, other: { scope: 'shareable-link' } } }),
    's3cr3t',
  )
  assert.equal(automationBypassFrom({ protectionBypass: { other: { scope: 'shareable-link' } } }), null)
  assert.equal(automationBypassFrom({}), null)
  assert.equal(automationBypassFrom(null), null)
})

test('a deployment URL or bare host reduces to its host', () => {
  assert.equal(hostOf('https://aglyn-tenant-ayy9d9vq5-aglyn.vercel.app/'), 'aglyn-tenant-ayy9d9vq5-aglyn.vercel.app')
  assert.equal(hostOf('aglyn-tenant-ayy9d9vq5-aglyn.vercel.app'), 'aglyn-tenant-ayy9d9vq5-aglyn.vercel.app')
  assert.equal(hostOf(''), '')
})

test('records name the deployment, so the scheduled run grades only what nobody has', () => {
  const context = 'prod-canary/aglyn-tenant'
  assert.equal(recordDescription('green', 'dpl_7Zv', false), 'canary green on dpl_7Zv (candidate)')
  assert.equal(recordDescription('red', 'dpl_7Zv', true), 'canary red on dpl_7Zv (serving)')
  const statuses = [
    { context, state: 'success', description: recordDescription('green', 'dpl_CJs', false) },
    { context: 'main-gate/fast', state: 'success', description: 'dpl_Exr' },
  ]
  assert.equal(alreadyGraded(statuses, context, 'dpl_CJs'), true)
  // Same commit, another deployment of it, or another check naming it: ungraded.
  assert.equal(alreadyGraded(statuses, context, 'dpl_Exr'), false)
  assert.equal(alreadyGraded(null, context, 'dpl_CJs'), false)
  assert.equal(alreadyGraded(statuses, context, null), false)
})

test('a red candidate production does not serve says do not promote, and exits non-zero', () => {
  assert.notEqual(EXIT['candidate-red'], 0)
  const payload = slackPayload({ project: PROJECTS.tenant, verdict: 'candidate-red', deployment: beta222 })
  assert.match(payload.text, /Do NOT promote/)
  assert.doesNotMatch(payload.text, /ROLLED BACK/)
})
