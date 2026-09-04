/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored, and this suite needs `Response`.
 *
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
 * Can the create-and-publish probe actually go red? (AGL-2586)
 *
 * The first design constraint on the issue is that every check ships with a
 * proof it fails under the condition it exists to catch. The condition here
 * is not hypothetical: on 2026-09-04 the Firestore rules shipped late after a
 * promotion, the `publishOutbox` block was not live, and because that entry
 * rides the SAME client batch as the routing-map write, every publish on the
 * platform was refused whole for about twelve minutes. Every component check
 * stayed green.
 *
 * The first case below is that outage, reproduced against the real verdict
 * with the ruleset that was live at the time — a Firestore rules file with
 * no `publishOutbox` block — and it must be a 503.
 *
 * There is a second, independent guard in this file, and it is the reason the
 * live-rules check is allowed to answer "indeterminate" when the deployment's
 * credential cannot read the control plane: the REPO's own rules file must
 * cover the publish batch's write set. Together with the `Rules drift`
 * workflow — live ruleset versus the promoted repo file, daily and on every
 * push to `production` — that is a second road to the same guarantee, so no
 * single missing permission makes this silent.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { HEALTH_NO_STORE } from '@aglyn/aglyn/server'

import {
  PUBLISH_OUTBOX_FIELDS,
  PUBLISH_OUTBOX_MAX_ATTEMPTS,
  PUBLISH_OUTBOX_STALE_MS,
} from '../constants/publish-outbox'
import {
  createJourneyHealth,
  publishAnnounceHealth,
  publishRulesHealth,
  PUBLISH_BATCH_RULE_BLOCKS,
} from '../app/api/health/journeys/journeys-verdict'
import type { JourneysProbeResult } from '../app/api/health/journeys/journeys-probe'

/**
 * The route's own import, mocked WHOLESALE: the probe module reaches
 * Firestore and the rules control plane at call time, and a red-proof that
 * needed an admin credential to run would be a proof nobody could run.
 */
const PROBE = '../app/api/health/journeys/journeys-probe'

const REPO_ROOT = join(__dirname, '../../..')

/** The rules file as promoted. The live ruleset is supposed to equal it. */
const REPO_RULES = readFileSync(
  join(REPO_ROOT, 'cloud/firebase-firestore.rules'),
  'utf8',
)

/**
 * The ruleset as it was during the outage: everything the file has, with the
 * outbox block cut out. Derived from the real file rather than hand-written,
 * so it stays a realistic subject as the rules change.
 */
const RULES_WITHOUT_OUTBOX = REPO_RULES.replace(
  /match \/publishOutbox\//g,
  'match /somethingElse/',
)

async function routeWith(result: JourneysProbeResult) {
  jest.resetModules()
  jest.doMock(PROBE, () => ({
    __esModule: true,
    PROBE_TTL_MS: 5 * 60_000,
    probeJourneys: async () => result,
  }))
  return (await import('../app/api/health/journeys/route')) as {
    GET: () => Promise<Response>
    HEAD: () => Promise<Response>
  }
}

afterEach(() => {
  jest.resetModules()
  jest.dontMock(PROBE)
})

const HEALTHY: JourneysProbeResult = {
  create: createJourneyHealth({ kind: 'open' }, 1),
  publishRules: publishRulesHealth(REPO_RULES, 1),
  publishAnnounce: publishAnnounceHealth([], 1),
}

describe('the rules the publish batch needs', () => {
  /**
   * The guard that keeps the live check honest even where it cannot run:
   * whatever the publish batch writes, the promoted rules file must name.
   */
  it('is covered by the rules file in this repo', () => {
    const check = publishRulesHealth(REPO_RULES, 1)
    expect(check.uncovered).toEqual([])
    expect(check.ok).toBe(true)
    expect(check.determinate).toBeUndefined()
  })

  it('names every block the batch writes, derived and non-empty', () => {
    expect(PUBLISH_BATCH_RULE_BLOCKS.length).toBeGreaterThanOrEqual(3)
    for (const block of PUBLISH_BATCH_RULE_BLOCKS) {
      expect(REPO_RULES).toContain(block)
    }
  })

  /** THE 2026-09-04 OUTAGE. */
  it('goes red when the live ruleset has no publishOutbox block', () => {
    const check = publishRulesHealth(RULES_WITHOUT_OUTBOX, 1)
    expect(check.ok).toBe(false)
    expect(check.code).toBe('publish-rules-uncovered')
    expect(check.uncovered).toContain('match /publishOutbox/')
  })

  /**
   * The same drift one version later: a field added to the document the
   * client writes, with no rules deploy behind it. The outbox rule pins the
   * key set exactly, so the batch would be refused whole again.
   */
  it('goes red when the live outbox rule does not admit a field the client writes', () => {
    const dropped = REPO_RULES.replace(
      new RegExp(`'${PUBLISH_OUTBOX_FIELDS[1]}'`, 'g'),
      "'somethingElse'",
    )
    const check = publishRulesHealth(dropped, 1)
    expect(check.ok).toBe(false)
    expect(check.uncovered).toContain(`publishOutbox.${PUBLISH_OUTBOX_FIELDS[1]}`)
  })

  it('goes red when a host block the batch writes has gone', () => {
    const check = publishRulesHealth(
      REPO_RULES.replace(/match \/screens\/\{screenId\} \{/g, 'match /gone/{id} {'),
      1,
    )
    expect(check.ok).toBe(false)
    expect(check.uncovered).toContain('match /screens/{screenId} {')
  })

  /**
   * INDETERMINATE, not degraded — and it must not page. The deployment's
   * credential may not carry `firebaserules.releases.get`, and a permanent
   * red about our own configuration is the false alarm that teaches everyone
   * to ignore the board. The repo-side guard above and the `Rules drift`
   * workflow are what keep that from being silence.
   */
  it('reports "could not read" without paging, and says so in the body', () => {
    const check = publishRulesHealth(null, 1)
    expect(check.ok).toBe(true)
    expect(check.determinate).toBe(false)
    expect(check.code).toBe('rules-unreadable')
  })
})

describe('the create verdict', () => {
  it('passes when every preflight answered and nothing is refusing', () => {
    expect(createJourneyHealth({ kind: 'open' }, 1).ok).toBe(true)
  })

  it.each([
    ['platform-locked', 'platform-locked'],
    ['slugs-unavailable', 'org-slugs-unavailable'],
    ['subdomains-unavailable', 'subdomain-lookup-unavailable'],
    ['subject-squatted', 'probe-subject-exists'],
    ['unavailable', 'create-unavailable'],
  ])('goes red on %s', (kind, code) => {
    const check = createJourneyHealth({ kind } as never, 1)
    expect(check.ok).toBe(false)
    expect(check.code).toBe(code)
  })
})

describe('the publish announce verdict', () => {
  /**
   * An empty outbox is the HEALTHY state, and it is not the AGL-1843
   * mistake: a successful publish deletes its own entry, so absence here
   * means the fast path won rather than that nobody looked.
   */
  it('passes an empty outbox', () => {
    const check = publishAnnounceHealth([], 1)
    expect(check.ok).toBe(true)
    expect(check.pending).toBe(0)
  })

  it('passes entries that are simply in flight', () => {
    const check = publishAnnounceHealth([{ ageMs: 5_000, attempts: 0 }], 1)
    expect(check.ok).toBe(true)
    expect(check.pending).toBe(1)
  })

  /** A publish whose live page is still serving its old HTML. */
  it('goes red on an entry that has aged out', () => {
    const check = publishAnnounceHealth(
      [{ ageMs: PUBLISH_OUTBOX_STALE_MS + 1, attempts: 1 }],
      1,
    )
    expect(check.ok).toBe(false)
    expect(check.code).toBe('announce-stale')
    expect(check.stale).toBe(1)
  })

  it('goes red on an entry that spent its attempts', () => {
    const check = publishAnnounceHealth(
      [{ ageMs: 1_000, attempts: PUBLISH_OUTBOX_MAX_ATTEMPTS }],
      1,
    )
    expect(check.ok).toBe(false)
    expect(check.code).toBe('announce-stalled')
    expect(check.stalled).toBe(1)
  })

  it('treats an unreadable outbox as degraded, never as calm', () => {
    const check = publishAnnounceHealth(null, 1)
    expect(check.ok).toBe(false)
    expect(check.code).toBe('outbox-unavailable')
  })
})

describe('/api/health/journeys', () => {
  it('answers 200 when create and publish are both fine', async () => {
    const route = await routeWith(HEALTHY)
    const response = await route.GET()
    expect(response.status).toBe(200)
    expect((await response.json()).status).toBe('ok')
    expect((await route.HEAD()).status).toBe(200)
  })

  /** THE 2026-09-04 OUTAGE, through the real route handler. */
  it('answers 503 when the live rules refuse the publish batch', async () => {
    const route = await routeWith({
      ...HEALTHY,
      publishRules: publishRulesHealth(RULES_WITHOUT_OUTBOX, 1),
    })
    const response = await route.GET()
    expect(response.status).toBe(503)
    expect((await response.json()).checks.publishRules.code).toBe(
      'publish-rules-uncovered',
    )
  })

  /**
   * HEAD is not a formality: several uptime providers use it by default, and
   * a HEAD that cannot go red is the fifty-one-hour blindness in a different
   * method.
   */
  it('answers 503 on HEAD too', async () => {
    const route = await routeWith({
      ...HEALTHY,
      create: createJourneyHealth({ kind: 'platform-locked' }, 1),
    })
    expect((await route.HEAD()).status).toBe(503)
  })

  it('is uncacheable on the failure response, which is the one that matters', async () => {
    const route = await routeWith({
      ...HEALTHY,
      publishAnnounce: publishAnnounceHealth(null, 1),
    })
    const response = await route.GET()
    expect(response.headers.get('cache-control')).toBe(HEALTH_NO_STORE)
    expect(response.headers.get('retry-after')).toBe('30')
  })

  /**
   * An indeterminate rules read must not turn the endpoint red on its own —
   * that is the whole point of the third state.
   */
  it('stays 200 when the live rules could not be read', async () => {
    const route = await routeWith({ ...HEALTHY, publishRules: publishRulesHealth(null, 1) })
    expect((await route.GET()).status).toBe(200)
  })

  /**
   * The body is public. Rule BLOCK names describe our own schema and are
   * fine; an org, a site, a slug or a uid is not.
   */
  it('publishes no customer identifier', async () => {
    const route = await routeWith({
      ...HEALTHY,
      publishRules: publishRulesHealth(RULES_WITHOUT_OUTBOX, 1),
    })
    const serialized = JSON.stringify(await (await route.GET()).json())
    expect(serialized).not.toMatch(/@|password|secret|token|Bearer|sk_/i)
  })
})
