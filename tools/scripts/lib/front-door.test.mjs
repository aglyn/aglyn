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

// The front-door grader (AGL-2709).
//
// The defect this suite exists for is not a wrong verdict, it is a check that
// cannot produce a red one. `Published sites` and `Marketing site` both read
// 100.000% with no downtime recorded through ten minutes of every tenant page
// answering HTTP 500 — because they ask a health route, and a health route
// answers from inside a route handler that never enters the ISR path.
//
// So every case here is written from BOTH sides: the response shape that must
// pass, and the response shape that must not. A grader asserted only on its
// happy path is satisfied by a function that returns `{ok: true}`.

import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  FRONT_DOORS,
  FRONT_DOOR_PATH,
  cacheNote,
  evaluateFrontDoorReaders,
  frontDoorPlan,
  gradeFrontDoor,
  readCacheState,
} from './front-door.mjs'
import { DEFAULT_TARGETS, markPendingDeployments } from './uptime-targets.mjs'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const CANARY_DIR = join(REPO_ROOT, 'apps/tenant/app/api/health/render')

/** The canaries the tenant app actually ships, read from disk. */
function canaryRoutesOnDisk() {
  return readdirSync(CANARY_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}

/**
 * A response that a healthy front door produces.
 *
 * Trimmed from a real production render: the DOCTYPE, the asset references
 * Next emits into the head, and the closing tag. Everything the grader looks
 * for is in here, so a case below removes exactly one thing at a time.
 */
const HEALTHY = {
  status: 200,
  contentType: 'text/html; charset=utf-8',
  body:
    '<!DOCTYPE html><html lang="en"><head>' +
    '<script src="/_next/static/chunks/16owe5felk__g.js" async=""></script>' +
    '<meta name="generator" content="Aglyn"/></head>' +
    '<body><main>Fresh sourdough</main></body></html>',
}

describe('a healthy page — the positive control', () => {
  it('passes', () => {
    const verdict = gradeFrontDoor(HEALTHY)
    assert.equal(verdict.ok, true)
    assert.equal(verdict.challenged, false)
    assert.match(verdict.detail, /visitor gets a page/)
  })
})

describe('the outage this exists for (AGL-2708)', () => {
  /**
   * THE CASE. Every tenant page answered 500 with a `DYNAMIC_SERVER_USAGE`
   * digest; Next serves its own error document, which is valid HTML. Only the
   * status separates it from a page, so the status has to be graded.
   */
  it('fails a 500, even though the body is real HTML', () => {
    const verdict = gradeFrontDoor({
      status: 500,
      contentType: 'text/html; charset=utf-8',
      body: '<!DOCTYPE html><html><body>Application error</body></html>',
    })
    assert.equal(verdict.ok, false)
    assert.equal(verdict.detail, 'HTTP 500')
  })

  it('fails a 503 and a 404 the same way', () => {
    assert.equal(gradeFrontDoor({ status: 503, body: '' }).ok, false)
    assert.equal(gradeFrontDoor({ status: 404, body: '' }).ok, false)
  })
})

describe('the bot-protection checkpoint', () => {
  /**
   * The reason `marketing-home` and `customer-site` were repointed away from
   * real pages in the first place. It must be RED — a check that cannot see
   * the site has not verified it — and it must not read as an outage, because
   * a monitor that cries site-down over its own missing token is the false
   * alarm that got the coverage traded away.
   */
  it('is red, and says it is a challenge rather than an outage', () => {
    const verdict = gradeFrontDoor({
      status: 429,
      contentType: 'text/html; charset=utf-8',
      body: '<html><head><title>Vercel Security Checkpoint</title></head></html>',
    })
    assert.equal(verdict.ok, false)
    assert.equal(verdict.challenged, true)
    assert.match(verdict.detail, /CHALLENGED/)
    assert.match(verdict.detail, /not a verdict on the site/)
    assert.match(verdict.detail, /AGLYN_PROBE_TOKEN/)
  })

  /**
   * The status is not what identifies it. A challenge served as 200 would
   * otherwise be graded on its markers alone and reported as a broken render,
   * which points the reader at the app instead of at the firewall.
   */
  it('is recognized whatever status carries it', () => {
    const verdict = gradeFrontDoor({
      status: 200,
      contentType: 'text/html',
      body: '<html>Vercel Security Checkpoint</html>',
    })
    assert.equal(verdict.challenged, true)
  })
})

describe('a 200 that is not a page', () => {
  it('fails an incomplete document', () => {
    const verdict = gradeFrontDoor({
      ...HEALTHY,
      body: HEALTHY.body.replace('</html>', ''),
    })
    assert.equal(verdict.ok, false)
    assert.match(verdict.detail, /incomplete document/)
  })

  /**
   * A parked domain, a CDN error page and an origin-misconfiguration notice
   * are all complete, valid HTML documents served with a 200. None of them is
   * our render, and the asset references are what tell them apart.
   */
  it('fails a complete document that our app did not render', () => {
    const verdict = gradeFrontDoor({
      ...HEALTHY,
      body: '<!DOCTYPE html><html><body>This domain is parked.</body></html>',
    })
    assert.equal(verdict.ok, false)
    assert.match(verdict.detail, /not our render/)
  })

  it('fails a JSON body served at a page URL', () => {
    const verdict = gradeFrontDoor({
      status: 200,
      contentType: 'application/json',
      body: '{"status":"ok"}',
    })
    assert.equal(verdict.ok, false)
    assert.match(verdict.detail, /not HTML/)
  })

  it('fails a 200 with no content-type at all', () => {
    const verdict = gradeFrontDoor({ ...HEALTHY, contentType: null })
    assert.equal(verdict.ok, false)
    assert.match(verdict.detail, /absent/)
  })

  /**
   * The health-door blind spot, stated as a case. `/api/health/render/site`
   * answers 200 with `{"status":"ok"}` while every page 500s — which is
   * precisely what happened — so the grader must refuse to accept that body
   * as evidence about a page.
   */
  it('refuses a healthy render-canary body as evidence about a page', () => {
    const verdict = gradeFrontDoor({
      status: 200,
      contentType: 'application/json',
      body: '{"status":"ok","checks":{"render":{"ok":true,"nodeCount":107}}}',
    })
    assert.equal(verdict.ok, false)
  })
})

describe('a redirect is never followed', () => {
  /**
   * The AGL-786 defect: a base that 3xxes to the real host reports the
   * redirect target's health under the wrong name, and a monitor pointed at a
   * redirecting hostname failed every cron run for a week before anyone read
   * the logs. Name it instead of following it.
   */
  it('names the redirect target and fails', () => {
    const verdict = gradeFrontDoor({
      status: 308,
      location: 'https://demo.aglyn.app/',
      body: '',
    })
    assert.equal(verdict.ok, false)
    assert.match(verdict.detail, /redirects to https:\/\/demo\.aglyn\.app\//)
    assert.match(verdict.detail, /SERVES pages/)
  })
})

describe('what is watched', () => {
  it('probes the root of each front door', () => {
    const plan = frontDoorPlan()
    assert.equal(plan.length, Object.keys(FRONT_DOORS).length)
    for (const [name, base, path] of plan) {
      assert.match(name, /^front-door\//)
      assert.equal(path, FRONT_DOOR_PATH)
      assert.doesNotThrow(() => new URL(base))
    }
  })

  /**
   * The front door and the health door must measure the SAME deployment.
   * Otherwise the board can hold a green page on one hostname and a green
   * health route on another, and nothing has verified that either hostname
   * does both.
   */
  it('shares the tenant probe target hostname', () => {
    const tenant = DEFAULT_TARGETS.find(([name]) => name === 'tenant')
    assert.equal(new URL(FRONT_DOORS.site).host, new URL(tenant[1]).host)
  })

  /**
   * `*.aglyn.com` is the WORKSPACE-subdomain shape, whose root 404s: the
   * hostname that produced eight months of green on a page that never
   * existed. A front door on it would repeat that exactly.
   */
  it('does not put a front door on a workspace subdomain', () => {
    for (const base of Object.values(FRONT_DOORS)) {
      assert.equal(
        new URL(base).host.endsWith('.aglyn.com'),
        false,
        `${base} is a workspace subdomain — its root 404s`,
      )
    }
  })

  it('lets a front door be repointed for a local run', () => {
    const [row] = frontDoorPlan({ site: 'http://localhost:4500' })
    assert.deepEqual(row, ['front-door/site', 'http://localhost:4500', '/'])
  })

  /**
   * Only an override may carry a path. The local e2e fixture seeds `/home`
   * and `/survey` and no root screen, so a local run pinned to `/` would
   * report a 404 and say nothing about the code under it.
   */
  it('honors a path on an override, and only on an override', () => {
    const [row] = frontDoorPlan({ site: 'http://localhost:4500/home' })
    assert.deepEqual(row, ['front-door/site', 'http://localhost:4500', '/home'])
    for (const [, , path] of frontDoorPlan()) assert.equal(path, '/')
  })
})

describe('every render canary has a real page beside it', () => {
  it('finds the canaries on disk at all — the positive control', () => {
    assert.deepEqual(canaryRoutesOnDisk(), ['marketing', 'site'])
  })

  it('pairs each one with a front door', () => {
    const result = evaluateFrontDoorReaders(canaryRoutesOnDisk())
    assert.equal(
      result.ok,
      true,
      `canaries with no page probe: ${result.unpaired.join(', ')} · ` +
        `front doors with no canary: ${result.orphan.join(', ')}`,
    )
  })

  it('names a canary with no page probe — the red case', () => {
    const result = evaluateFrontDoorReaders([
      ...canaryRoutesOnDisk(),
      'checkout',
    ])
    assert.equal(result.ok, false)
    assert.deepEqual(result.unpaired, ['checkout'])
  })

  it('names a front door that no canary backs — the typo case', () => {
    const result = evaluateFrontDoorReaders(['site'], {
      site: 'https://demo.aglyn.app',
      marketting: 'https://aglyn.com',
    })
    assert.equal(result.ok, false)
    assert.deepEqual(result.orphan, ['marketting'])
  })
})

describe('a front-door row is never laundered into PENDING', () => {
  /**
   * `markPendingDeployments` forgives a 404 on a subsystem row while the
   * target's root is up, because `main` names health endpoints before
   * production is promoted to serve them. A page 404 is the opposite: it is
   * the AGL-786 defect, a hostname that serves no page, and reporting it as
   * "pending promotion" would be the same silence in a new place.
   */
  it('leaves a 404 page row DOWN', () => {
    const [, page] = markPendingDeployments([
      { name: 'tenant', status: 200, ok: true, detail: 'healthy' },
      {
        name: 'front-door/site',
        kind: 'page',
        status: 404,
        ok: false,
        detail: 'HTTP 404',
      },
    ])
    assert.equal(page.pending, undefined)
    assert.equal(page.ok, false)
  })
})

describe('a 200 says where the bytes came from (AGL-2709)', () => {
  /**
   * ⛔ THE HEADER THE PROBE USED TO READ IS NOT SENT.
   *
   * Measured 2026-09-09 against both front doors, from a client carrying the
   * bypass token: `demo.aglyn.app/` answered `x-vercel-cache: STALE, age: 105`
   * and `aglyn.com/` answered `x-vercel-cache: HIT, age: 50`. Neither carried
   * `x-nextjs-cache` — Vercel's edge answers in its own header — so the note
   * that was supposed to acknowledge the ISR cache never appeared on a single
   * production row.
   */
  it('reads the header Vercel actually sends, with the age', () => {
    assert.deepEqual(
      readCacheState({ vercelCache: 'STALE', nextCache: null, age: '105' }),
      {
        state: 'STALE',
        header: 'x-vercel-cache',
        rendered: false,
        ageSeconds: 105,
      },
    )
  })

  /** The probe can be pointed at a local `next start`, which has no edge. */
  it('falls back to Next.js own header off Vercel', () => {
    const cache = readCacheState({ nextCache: 'HIT' })
    assert.equal(cache.header, 'x-nextjs-cache')
    assert.equal(cache.state, 'HIT')
    assert.equal(cache.rendered, false)
  })

  it('knows which states mean a render just ran', () => {
    for (const state of ['MISS', 'BYPASS', 'REVALIDATED']) {
      assert.equal(readCacheState({ vercelCache: state }).rendered, true, state)
    }
    for (const state of ['HIT', 'STALE', 'PRERENDER']) {
      assert.equal(
        readCacheState({ vercelCache: state }).rendered,
        false,
        state,
      )
    }
  })

  /** No header at all is "we do not know", never "it was rendered". */
  it('reports an absent header as unknown rather than as a render', () => {
    const cache = readCacheState({})
    assert.equal(cache.state, null)
    assert.equal(cache.rendered, null)
    assert.equal(cacheNote(cache), null)
  })

  /**
   * ⚠️ The note is the whole closure of the reporting half. A green row that
   * says nothing implies it verified the render, and that implication is what
   * let both page monitors read 100.000% through the outage.
   */
  it('a cached 200 says plainly what it does NOT prove', () => {
    const note = cacheNote(readCacheState({ vercelCache: 'HIT', age: '50' }))
    assert.match(note, /cache=HIT age=50s/)
    assert.match(note, /not evidence the render works/)
    assert.match(note, /check-render-errors/)
  })

  it('a rendered 200 makes no such disclaimer', () => {
    const note = cacheNote(readCacheState({ vercelCache: 'MISS' }))
    assert.match(note, /rendered now/)
    assert.doesNotMatch(note, /not evidence/)
  })

  /**
   * Recorded, NEVER graded. Grading a cache hit red would fire on ordinary
   * traffic every fifteen minutes — the false alarm that got the two GCP page
   * checks repointed off real pages in the first place.
   */
  it('does not change the verdict — a stale page is still a page', () => {
    assert.equal(gradeFrontDoor(HEALTHY).ok, true)
  })
})
