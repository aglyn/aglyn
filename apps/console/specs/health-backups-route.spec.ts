/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and this runs on jsdom, where the route's `Response`
 * helpers are unavailable.
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
 * AGL-1843 — the backups health route, invoked in-process.
 *
 * `backupsHealth` and `exportsHealth` are spec-covered branch by branch in
 * the shared health lib. This drives the ROUTE around them against stubbed
 * upstream responses, because the defect was never in the verdict function
 * alone: it was the route deciding, before the verdict function ever ran,
 * that "the listing could not be read" and "the backups failed" were the same
 * thing. Only `fetch` and the admin app are stubbed — a mocked
 * `healthHttpStatus` would let the route pass while wired to nothing.
 *
 * The endpoint answered **503 `backup-failed` for four and a half days** with
 * healthy backups behind it, against a monitor that emails every five
 * minutes. So the tests that matter come in pairs: for each state, the status
 * code an operator's mailbox actually sees, AND — for every state now allowed
 * to answer 200 — a sibling proving the check can still go red.
 *
 * Each test imports the route FRESH (`jest.resetModules` + dynamic import):
 * both probe memos are module-level with a five-minute TTL, so a shared
 * module would serve every test the first test's answer.
 */

// This suite has no STATIC imports — the route is loaded dynamically so each
// test gets a fresh probe memo — which would leave the file a global script,
// colliding with the sibling route specs' `RouteModule` in the one program
// `tsc` builds over `apps/console`. Jest does not care; the typecheck does.
export {}

/** A backup as `ListBackupsResponse` hands it back. */
type Backup = { state?: string; snapshotTime?: string }

/** What the stubbed Firestore Admin listing should answer with. */
let backupsResponse: {
  status: number
  body?: { backups?: Backup[]; unreachable?: string[] }
  /** Set to make the transport itself throw. */
  throws?: boolean
  /** Set to return a 200 whose body is not JSON. */
  garbled?: boolean
}
/** What the stubbed GCS listing should answer with. Healthy unless a test says otherwise. */
let exportsResponse: { status: number; body?: { items?: { timeCreated?: string }[] } }

/** Every URL the route fetched, so a route wired to the wrong API fails here. */
let fetched: string[]

jest.mock('firebase-admin/app', () => ({
  __esModule: true,
  getApp: () => ({
    options: {
      projectId: 'aglyn-test',
      credential: { getAccessToken: async () => ({ access_token: 'stub-token' }) },
    },
  }),
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {},
}))

const DAY = 86_400_000
/** An ISO timestamp `n` days before now, as the API formats `snapshotTime`. */
const days = (n: number) => new Date(Date.now() - n * DAY).toISOString()

type RouteModule = typeof import('../app/api/health/backups/route')

async function freshRoute(): Promise<RouteModule> {
  jest.resetModules()
  return import('../app/api/health/backups/route')
}

/** Drive GET and read back the parts a monitor and an operator each see. */
async function probe(): Promise<{
  status: number
  backups: Record<string, unknown>
  exports: Record<string, unknown>
  body: Record<string, unknown>
}> {
  const { GET } = await freshRoute()
  const response = await GET()
  const body = (await response.json()) as Record<string, unknown>
  const checks = body['checks'] as Record<string, Record<string, unknown>>
  return {
    status: response.status,
    backups: checks['backups'],
    exports: checks['exports'],
    body,
  }
}

beforeEach(() => {
  fetched = []
  backupsResponse = { status: 200, body: { backups: [] } }
  // Healthy by default: the backups check is the subject, and a red exports
  // check would mask its status code.
  exportsResponse = { status: 200, body: { items: [{ timeCreated: days(1) }] } }

  global.fetch = jest.fn(async (url: string) => {
    fetched.push(String(url))
    const target = String(url).includes('firestore.googleapis.com')
      ? backupsResponse
      : exportsResponse
    if ('throws' in target && target.throws) {
      throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })
    }
    return {
      ok: target.status >= 200 && target.status < 300,
      status: target.status,
      json: async () => {
        if ('garbled' in target && target.garbled) throw new SyntaxError('Unexpected token <')
        return target.body ?? {}
      },
    }
  }) as unknown as typeof fetch
})

describe('/api/health/backups — the five upstream states', () => {
  it('1. a healthy completed backup → 200 ok', async () => {
    backupsResponse = {
      status: 200,
      body: {
        backups: [
          // The live production shape, 2026-08-24, verbatim from
          // `gcloud firestore backups list --location='-'`.
          { state: 'READY', snapshotTime: days(22) },
          { state: 'READY', snapshotTime: days(15) },
          { state: 'READY', snapshotTime: days(8) },
          { state: 'READY', snapshotTime: days(0.8) },
        ],
      },
    }
    const { status, backups } = await probe()
    expect(status).toBe(200)
    expect(backups['ok']).toBe(true)
    expect(backups['code']).toBeUndefined()
    expect(backups['determinate']).toBeUndefined()
    expect(backups['states']).toEqual({ READY: 4 })
    // It read the real thing, aggregated across locations.
    expect(fetched.some((url) => url.includes('/locations/-/backups'))).toBe(true)
  })

  it('2. a genuinely failed backup → 503, and the body says which fact broke', async () => {
    // Nothing usable inside the age budget. This is the state the endpoint
    // exists for, and it is the one that must survive every relaxation above.
    backupsResponse = {
      status: 200,
      body: { backups: [{ state: 'READY', snapshotTime: days(30) }] },
    }
    const { status, backups, body } = await probe()
    expect(status).toBe(503)
    expect(body['status']).toBe('degraded')
    expect(backups['ok']).toBe(false)
    expect(backups['code']).toBe('backup-stale')
    expect(backups['determinate']).toBeUndefined()
  })

  it('2b. the schedule stops producing entirely → 503', async () => {
    backupsResponse = { status: 200, body: { backups: [] } }
    const { status, backups } = await probe()
    expect(status).toBe(503)
    expect(backups['code']).toBe('no-ready-backup')
  })

  it('3. a backup in progress → 200, NOT a hard failure', async () => {
    // The Sunday window. Paging weekly on a run that is mid-flight is how an
    // operator learns to filter the alert.
    backupsResponse = {
      status: 200,
      body: {
        backups: [
          { state: 'CREATING', snapshotTime: days(0) },
          { state: 'READY', snapshotTime: days(7) },
        ],
      },
    }
    const { status, backups } = await probe()
    expect(status).toBe(200)
    expect(backups['ok']).toBe(true)
    expect(backups['newestReadyAgeDays']).toBe(7)
  })

  it('3b. a run in flight cannot hold the check green past the budget', async () => {
    // The bound on the tolerance above: a schedule that starts a backup every
    // week and never finishes one still goes red on the READY backup's age.
    backupsResponse = {
      status: 200,
      body: {
        backups: [
          { state: 'CREATING', snapshotTime: days(0) },
          { state: 'READY', snapshotTime: days(30) },
        ],
      },
    }
    const { status, backups } = await probe()
    expect(status).toBe(503)
    expect(backups['code']).toBe('backup-stale')
  })

  it('4. no completed run yet → 200 indeterminate, never `backup-failed`', async () => {
    backupsResponse = {
      status: 200,
      body: { backups: [{ state: 'CREATING', snapshotTime: days(0) }] },
    }
    const { status, backups } = await probe()
    expect(status).toBe(200)
    expect(backups['ok']).toBe(true)
    expect(backups['determinate']).toBe(false)
    expect(backups['code']).toBe('backups-not-ready-yet')
  })

  it('5. an upstream that errors transiently → 200 indeterminate', async () => {
    backupsResponse = { status: 503 }
    const { status, backups } = await probe()
    expect(status).toBe(200)
    expect(backups['ok']).toBe(true)
    expect(backups['determinate']).toBe(false)
    expect(backups['code']).toBe('http-503')
    // No verdict was invented from a read that never happened.
    expect(backups['states']).toEqual({})
    expect(backups['newestReadyAgeDays']).toBeNull()
  })

  it('5b. a PERMANENT upstream refusal stays RED — the fail-open bound', async () => {
    // A revoked `roles/datastore.backupsViewer` does not heal on its own. If
    // 403 were indeterminate, this check could be silently retired forever by
    // an IAM change and nobody would learn it had stopped watching.
    backupsResponse = { status: 403 }
    const { status, backups } = await probe()
    expect(status).toBe(503)
    expect(backups['ok']).toBe(false)
    expect(backups['code']).toBe('http-403')
  })

  it('5c. a transport fault → 200 indeterminate, and leaks no error text', async () => {
    backupsResponse = { status: 0, throws: true }
    const { status, backups } = await probe()
    expect(status).toBe(200)
    expect(backups['determinate']).toBe(false)
    expect(backups['code']).toBe('ECONNRESET')
    expect(JSON.stringify(backups)).not.toContain('socket hang up')
  })

  it('5d. an unreadable body → 200 indeterminate, not a measured zero', async () => {
    backupsResponse = { status: 200, garbled: true }
    const { status, backups } = await probe()
    expect(status).toBe(200)
    expect(backups['determinate']).toBe(false)
    expect(backups['states']).toEqual({})
  })

  it('5e. a PARTIAL listing is indeterminate, not "no READY backup"', async () => {
    // `ListBackupsResponse.unreachable`. Dropping the field turned an
    // unreachable location into a confident 503.
    backupsResponse = {
      status: 200,
      body: { backups: [], unreachable: ['projects/aglyn-test/locations/nam5'] },
    }
    const { status, backups } = await probe()
    expect(status).toBe(200)
    expect(backups['determinate']).toBe(false)
    expect(backups['code']).toBe('backups-partial')
  })
})

describe('an unreadable backups check cannot fail open', () => {
  it('goes 503 when the independent GCS export is stale too', async () => {
    // The escalation that makes 200-on-unknown safe. "We cannot read the
    // managed backups" answers 200 only while a fresh independent copy is
    // provable; when neither is, the endpoint pages.
    backupsResponse = { status: 503 }
    exportsResponse = { status: 200, body: { items: [{ timeCreated: days(40) }] } }
    const { status, backups, exports } = await probe()
    expect(status).toBe(503)
    expect(backups['determinate']).toBe(false)
    expect(exports['ok']).toBe(false)
    expect(exports['code']).toBe('export-stale')
  })

  it('goes 503 when the export listing is unreadable too', async () => {
    backupsResponse = { status: 500 }
    exportsResponse = { status: 500 }
    const { status } = await probe()
    expect(status).toBe(503)
  })

  it('keeps the two layers as SEPARATE checks — never one blended verdict', async () => {
    backupsResponse = { status: 503 }
    const { backups, exports } = await probe()
    expect(backups['determinate']).toBe(false)
    expect(exports['ok']).toBe(true)
  })
})

describe('the public contract', () => {
  it('HEAD answers exactly what GET would, including on a red', async () => {
    backupsResponse = { status: 200, body: { backups: [] } }
    const { GET, HEAD } = await freshRoute()
    const get = await GET()
    const head = await HEAD()
    expect(get.status).toBe(503)
    expect(head.status).toBe(503)
    expect(head.headers.get('Cache-Control')).toBe(get.headers.get('Cache-Control'))
  })

  it('carries no bucket names, project ids or resource paths', async () => {
    backupsResponse = { status: 403 }
    exportsResponse = { status: 403 }
    const { body } = await probe()
    const serialized = JSON.stringify(body['checks'])
    expect(serialized).not.toContain('aglyn-test')
    expect(serialized).not.toContain('googleapis.com')
    expect(serialized).not.toContain('projects/')
  })
})
