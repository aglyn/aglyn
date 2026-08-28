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
 * Attaching a name that SERVES the console reconciles the bucket's upload
 * CORS; attaching a redirect does not (AGL-1452).
 *
 * `attachProjectDomain` is the one seam every console name goes through — org
 * workspace subdomains via `attachWorkspaceDomain`, white-label console
 * domains via `activateConsoleDomain`. Putting the reconcile here is what
 * makes "remember to add the origin to the bucket" stop being a thing anyone
 * has to remember.
 *
 * The redirect distinction is the whole of the correctness argument, and it is
 * measured rather than reasoned: `console.aglyn.com` 308s and `app.aglyn.io`
 * 307s to `app.aglyn.com`, neither is in the bucket's CORS list, and neither
 * is broken — because the browser is already at the target before it uploads.
 * `zgover.aglyn.com` serves the console at 200, is not in the list, and cannot
 * complete a large upload.
 */

export {}

const reconcile = jest.fn()
const release = jest.fn()

jest.mock('./upload-cors-reconcile', () => ({
  reconcileUploadCors: (...args: unknown[]) => reconcile(...args),
  releaseUploadCors: (...args: unknown[]) => release(...args),
  liveBucketCorsIO: () => ({ bucket: 'test-bucket' }),
}))

const ENV = {
  VERCEL_TOKEN: 'tok_test',
  VERCEL_CONSOLE_PROJECT_ID: 'prj_test',
  // Both projects, or `configured('tenant')` is false and every tenant-scope
  // attach comes back `skipped` — which would pass the "does not reconcile"
  // cases below for the wrong reason entirely.
  VERCEL_TENANT_PROJECT_ID: 'prj_tenant_test',
  VERCEL_TEAM_ID: 'team_test',
  NEXT_PUBLIC_WORKSPACE_DOMAIN: 'aglyn.com',
}

async function load() {
  jest.resetModules()
  Object.assign(process.env, ENV)
  return import('./workspace-domains')
}

function respond(status: number, body: unknown = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

const PERMITTED = {
  origin: 'https://acme.example.com',
  permitted: true,
  added: ['https://acme.example.com'],
  remedy: null,
  detail: null,
}

describe('attachProjectDomain reconciles upload CORS (AGL-1452)', () => {
  let fetchMock: jest.SpyInstance

  beforeEach(() => {
    reconcile.mockReset()
    reconcile.mockResolvedValue(PERMITTED)
    fetchMock = jest.spyOn(global, 'fetch' as never)
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => jest.restoreAllMocks())

  it('reconciles the origin of a name it attached to SERVE', async () => {
    fetchMock.mockResolvedValue(respond(200))
    const { attachProjectDomain } = await load()
    const result = await attachProjectDomain('acme.example.com')
    expect(result.outcome).toBe('attached')
    expect(reconcile).toHaveBeenCalledWith('acme.example.com')
    expect(result.uploadCors).toEqual(PERMITTED)
  })

  it('reconciles a name that was ALREADY attached', async () => {
    // The healing path. Five workspace subdomains served the console on
    // 2026-08-20 and none of them could upload; a reconcile pass over names
    // that already exist is what closes that without a migration.
    fetchMock.mockResolvedValue(
      respond(409, { error: { code: 'domain_already_in_use' } }),
    )
    const { attachProjectDomain } = await load()
    const result = await attachProjectDomain('acme.example.com')
    expect(result.outcome).toBe('already-exists')
    expect(reconcile).toHaveBeenCalledWith('acme.example.com')
  })

  it('does NOT reconcile a name attached as a redirect', async () => {
    // A redirect never becomes a browser origin, so an entry for it would be
    // permission granted for nothing — and every unnecessary origin is one
    // more site that could spend a leaked signed URL.
    fetchMock.mockResolvedValue(respond(200))
    const { attachProjectDomain } = await load()
    const result = await attachProjectDomain('www.acme.example.com', {
      redirectTo: 'acme.example.com',
    })
    expect(result.outcome).toBe('attached')
    expect(reconcile).not.toHaveBeenCalled()
    expect(result.uploadCors ?? null).toBeNull()
  })

  it('does NOT reconcile a TENANT name, however it was attached', async () => {
    // A published site is not a page that uploads. The signed direct-to-GCS
    // path has one client — the console's media library — and it ships only in
    // the console bundle, so a customer's own domain issues no signed `PUT`.
    // An entry for it would be standing permission on a bucket where the
    // signed URL is the authorization, held by a host somebody else controls.
    fetchMock.mockResolvedValue(respond(200))
    const { attachProjectDomain } = await load()
    const result = await attachProjectDomain('shop.acme.com', {}, 'tenant')
    expect(result.outcome).toBe('attached')
    expect(reconcile).not.toHaveBeenCalled()
    expect(result.uploadCors ?? null).toBeNull()
  })

  it('does NOT reconcile a tenant name that was ALREADY attached', async () => {
    // The re-register in `/api/domains/detach` lands here: it puts the platform
    // subdomain back as a plain serving entry after dropping its redirect. That
    // must not be the thing that quietly grants a tenant origin.
    fetchMock.mockResolvedValue(
      respond(409, { error: { code: 'domain_already_in_use' } }),
    )
    const { attachProjectDomain } = await load()
    const result = await attachProjectDomain('acme.aglyn.app', {}, 'tenant')
    expect(result.outcome).toBe('already-exists')
    expect(reconcile).not.toHaveBeenCalled()
  })

  it('still reconciles CONSOLE scope when it is passed explicitly', async () => {
    // Anti-vacuity for the two above: they must be passing because the SCOPE
    // is tenant, not because passing a third argument at all suppresses the
    // grant. Workspace subdomains serve the console and genuinely need entries.
    fetchMock.mockResolvedValue(respond(200))
    const { attachProjectDomain } = await load()
    const result = await attachProjectDomain('acme.example.com', {}, 'console')
    expect(reconcile).toHaveBeenCalledWith('acme.example.com')
    expect(result.uploadCors).toEqual(PERMITTED)
  })

  it('does not reconcile when the attach itself failed', async () => {
    fetchMock.mockResolvedValue(respond(400, { error: { code: 'invalid_domain' } }))
    const { attachProjectDomain } = await load()
    const result = await attachProjectDomain('acme.example.com')
    expect(result.outcome).toBe('failed')
    expect(reconcile).not.toHaveBeenCalled()
  })

  it('still reports the attach as attached when the bucket could not be updated', async () => {
    // The realistic production case: no storage.buckets.update on the runtime
    // service account. The domain IS attached and the console DOES serve on
    // it — refusing the attach over an upload-path gap would be a worse
    // outcome than reporting it. The verdict carries the command.
    reconcile.mockResolvedValue({
      origin: 'https://acme.example.com',
      permitted: false,
      added: [],
      remedy: 'run this: gcloud storage buckets update …',
      detail: 'write-failed',
    })
    fetchMock.mockResolvedValue(respond(200))
    const { attachProjectDomain } = await load()
    const result = await attachProjectDomain('acme.example.com')
    expect(result.outcome).toBe('attached')
    expect(result.uploadCors?.permitted).toBe(false)
    expect(result.uploadCors?.remedy).toContain('gcloud storage buckets update')
  })

  it('never lets a reconcile failure take the attach down', async () => {
    // Same contract as everything else in this file: a domain must not fail
    // to attach because a storage API was unavailable.
    reconcile.mockRejectedValue(new Error('boom'))
    fetchMock.mockResolvedValue(respond(200))
    const { attachProjectDomain } = await load()
    await expect(attachProjectDomain('acme.example.com')).resolves.toEqual(
      expect.objectContaining({ outcome: 'attached' }),
    )
  })
})

describe('detachProjectDomain reclaims the upload origin (AGL-1452)', () => {
  let fetchMock: jest.SpyInstance

  beforeEach(() => {
    release.mockReset()
    release.mockResolvedValue({
      origin: 'https://acme.example.com',
      revoked: true,
      detail: null,
    })
    fetchMock = jest.spyOn(global, 'fetch' as never)
  })

  afterEach(() => {
    fetchMock.mockRestore()
  })

  it('releases the origin of a name it detached', async () => {
    fetchMock.mockResolvedValue(respond(200))
    const { detachProjectDomain } = await load()
    const result = await detachProjectDomain('acme.example.com')

    expect(result.outcome).toBe('detached')
    // Without this the allowlist only ever grows, which is exactly why the
    // live bucket carried five `agl1514-smoke-*` origins on 2026-08-24.
    expect(release).toHaveBeenCalledWith('acme.example.com')
    expect(result.uploadCorsRelease).toEqual({
      origin: 'https://acme.example.com',
      revoked: true,
      detail: null,
    })
  })

  it('releases a TENANT name even though attach no longer grants one', async () => {
    // The deliberate asymmetry with the attach half. Bucket state outlives a
    // release: every tenant origin an earlier build added is still on the
    // allowlist, and this is the only path that takes one back off. Mirroring
    // the scope narrowing here would strand exactly those entries.
    fetchMock.mockResolvedValue(respond(200))
    const { detachProjectDomain } = await load()
    const result = await detachProjectDomain('shop.acme.com', 'tenant')

    expect(result.outcome).toBe('detached')
    expect(release).toHaveBeenCalledWith('shop.acme.com')
  })

  it('does NOT release for a name that was never on the project', async () => {
    fetchMock.mockResolvedValue(respond(404))
    const { detachProjectDomain } = await load()
    const result = await detachProjectDomain('never-ours.example.com')

    expect(result.outcome).toBe('not-found')
    expect(release).not.toHaveBeenCalled()
  })

  it('still reports the detach when the release could not write', async () => {
    fetchMock.mockResolvedValue(respond(200))
    release.mockResolvedValue({
      origin: 'https://acme.example.com',
      revoked: false,
      detail: 'write-failed',
    })
    const { detachProjectDomain } = await load()
    const result = await detachProjectDomain('acme.example.com')

    // A domain must not fail to detach because a storage API refused — but the
    // standing permission has to be visible, not swallowed.
    expect(result.outcome).toBe('detached')
    expect(result.uploadCorsRelease?.revoked).toBe(false)
    expect(result.uploadCorsRelease?.detail).toBe('write-failed')
  })

  it('does not fail the detach when the release throws', async () => {
    fetchMock.mockResolvedValue(respond(200))
    release.mockRejectedValue(new Error('storage unreachable'))
    const { detachProjectDomain } = await load()

    await expect(detachProjectDomain('acme.example.com')).resolves.toMatchObject({
      outcome: 'detached',
    })
  })
})

describe('pendingUploadCorsRemedy', () => {
  const remedy = 'gcloud storage buckets update gs://b --cors-file=cors.json'

  it('is null when nothing is owed', async () => {
    const { pendingUploadCorsRemedy } = await load()
    expect(
      pendingUploadCorsRemedy([
        { outcome: 'attached', domain: 'a.example', uploadCors: PERMITTED },
        { outcome: 'attached', domain: 'b.example' },
      ]),
    ).toBeNull()
  })

  it('returns the command when a serving name still cannot upload', async () => {
    const { pendingUploadCorsRemedy } = await load()
    expect(
      pendingUploadCorsRemedy([
        { outcome: 'attached', domain: 'a.example', uploadCors: PERMITTED },
        {
          outcome: 'attached',
          domain: 'b.example',
          uploadCors: { ...PERMITTED, permitted: false, remedy },
        },
      ]),
    ).toBe(remedy)
  })

  it('is null for an empty set rather than throwing', async () => {
    const { pendingUploadCorsRemedy } = await load()
    expect(pendingUploadCorsRemedy([])).toBeNull()
  })
})
