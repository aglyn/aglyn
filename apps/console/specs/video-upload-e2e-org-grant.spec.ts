/**
 * @jest-environment node
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

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { code } from './source-text'

/**
 * The seeded e2e org may store a video, and an org without its grant may not
 * (AGL-2830).
 *
 * `release_video_uploads` ships off, so every path that stores a video refuses
 * one. `npm run e2e:dam` uploads two films as the primary e2e org, which
 * `seed-e2e.mjs` grants the flag through the per-org override (AGL-1635): the
 * grant staff make for one customer, not a flag switched on for everyone and
 * not a looser gate.
 *
 * `video-upload-pause.spec.ts` fakes the verdict. This file keeps it real: the
 * seed's own grant, loaded from the module the seed imports, goes through
 * `isServerReleaseFlagOnForOrg` and the refusal helper, with only Firestore and
 * Remote Config faked. The console's media library resolves the same override
 * through the same two registry functions (`hooks/use-release-flags.tsx`).
 */

const REPO_ROOT = join(__dirname, '..', '..', '..')
const GRANT_MODULE = join(REPO_ROOT, 'tools/scripts/lib/e2e-release-flags.mjs')
const SEED = 'tools/scripts/seed-e2e.mjs'

/** The seed's `E2E_UID`, which is also the primary e2e org's document id. */
const E2E_ORG_ID = 'e2e-owner'
/** The seed's second org for the same owner, which it gives no override. */
const UNGRANTED_ORG_ID = 'e2e-owner-studio'

const mockGetTemplate = jest.fn()
const mockOrgDocs = new Map<string, Record<string, unknown>>()

jest.mock('../../../libs/tenant/data/admin/src/lib/server/firebase-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      remoteConfig: () => ({ getTemplate: mockGetTemplate }),
      firestore: () => ({
        collection: (name: string) => ({
          doc: (id: string) => ({
            get: async () => ({
              data: () => (name === 'orgs' ? mockOrgDocs.get(id) : undefined),
            }),
          }),
        }),
      }),
    }),
  },
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  // The REAL resolver, reached through its defining file: the package barrel
  // pulls in `render-cache.ts` -> `next/cache`, which throws under this test
  // environment. The resolver's `./firebase-admin` is the fake above.
  ...jest.requireActual(
    '../../../libs/tenant/data/admin/src/lib/server/release-flags',
  ),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  // The REAL registry, override parser, flag verdict and plan resolution the
  // resolver imports, so the only stand-ins are the two reads above.
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/plan-entitlements'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/release-flags'),
}))

import { parseOrgReleaseFlagOverrides } from '@aglyn/aglyn/app-utils/release-flags'
import { UPLOAD_TYPES } from '../utils/media-upload-limits'
import {
  videoUploadPausedRefusal,
  videoUploadsOpenForOrg,
} from '../utils/server/video-uploads'

/** The same module instance the resolver above caches in. */
const { __resetReleaseFlagCaches } = jest.requireActual(
  '../../../libs/tenant/data/admin/src/lib/server/release-flags',
) as { __resetReleaseFlagCaches: () => void }

const VIDEO_TYPES = UPLOAD_TYPES.filter((spec) =>
  spec.contentType.startsWith('video/'),
).map((spec) => spec.contentType)

/**
 * The grant, read by running the seed's module in plain node: this TypeScript
 * suite cannot import an ES module, and a copy of the literal here would test
 * the copy.
 */
const GRANT: Record<string, unknown> = JSON.parse(
  execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `const grants = await import(${JSON.stringify(pathToFileURL(GRANT_MODULE).href)});` +
        'process.stdout.write(JSON.stringify(grants.E2E_ORG_RELEASE_FLAGS))',
    ],
    { encoding: 'utf8' },
  ),
)

/** An org document on the e2e org's plan, with or without an override map. */
const orgDocument = (releaseFlags?: Record<string, unknown>) => ({
  plan: 'business',
  subscription: { status: 'active' },
  ...(releaseFlags ? { releaseFlags } : {}),
})

const REMOTE_CONFIG: Array<[string, () => void]> = [
  [
    'unreachable, as under the emulator',
    () => mockGetTemplate.mockRejectedValue(new Error('no Remote Config here')),
  ],
  [
    'publishing the flag off',
    () =>
      mockGetTemplate.mockResolvedValue({
        parameters: {
          release_video_uploads: { defaultValue: { value: '{"enabled":false}' } },
        },
      }),
  ],
]

beforeEach(() => {
  __resetReleaseFlagCaches()
  mockGetTemplate.mockReset()
  mockOrgDocs.clear()
})

describe('the grant the e2e seed writes (AGL-2830)', () => {
  it('grants release_video_uploads, under a key the override parser keeps', () => {
    expect(GRANT).toMatchObject({ release_video_uploads: true })
    // The parser drops a misspelled or retired key without a word, and the
    // e2e would meet that as a 403 on its first film.
    expect(parseOrgReleaseFlagOverrides(GRANT)).toEqual(GRANT)
  })

  it('is written onto the primary e2e org, and onto no other', () => {
    const seed = code(readFileSync(join(REPO_ROOT, SEED), 'utf8'), SEED)
    expect(seed).toContain(
      "import { E2E_ORG_RELEASE_FLAGS } from './lib/e2e-release-flags.mjs'",
    )
    expect(seed).toContain(`export const E2E_UID = '${E2E_ORG_ID}'`)
    expect(seed).toContain('const orgId = E2E_UID')

    const orgWrite = seed.indexOf(
      "await put(firestore.collection('orgs').doc(orgId), {",
    )
    const grant = seed.indexOf('releaseFlags: E2E_ORG_RELEASE_FLAGS')
    expect(orgWrite).toBeGreaterThan(-1)
    expect(grant).toBeGreaterThan(orgWrite)
    expect(grant).toBeLessThan(seed.indexOf('await put(', orgWrite + 1))
    expect(seed.match(/releaseFlags/g)).toHaveLength(1)
  })
})

describe('the video-upload gate, resolved for real (AGL-2830)', () => {
  it('has video types to gate, so the cases below are not over nothing', () => {
    expect(VIDEO_TYPES.length).toBeGreaterThanOrEqual(3)
  })

  it.each(REMOTE_CONFIG)(
    'lets the seeded e2e org store a video with Remote Config %s',
    async (_state, arrange) => {
      arrange()
      mockOrgDocs.set(E2E_ORG_ID, orgDocument(GRANT))

      await expect(videoUploadsOpenForOrg(E2E_ORG_ID)).resolves.toBe(true)
      for (const contentType of VIDEO_TYPES) {
        await expect(
          videoUploadPausedRefusal({ contentType, orgId: E2E_ORG_ID }),
        ).resolves.toBeNull()
      }
    },
  )

  it.each(REMOTE_CONFIG)(
    'still refuses an org without the override, on the same plan, with Remote Config %s',
    async (_state, arrange) => {
      arrange()
      mockOrgDocs.set(E2E_ORG_ID, orgDocument(GRANT))
      mockOrgDocs.set(UNGRANTED_ORG_ID, orgDocument())

      await expect(videoUploadsOpenForOrg(UNGRANTED_ORG_ID)).resolves.toBe(false)
      for (const contentType of VIDEO_TYPES) {
        const refusal = await videoUploadPausedRefusal({
          contentType,
          orgId: UNGRANTED_ORG_ID,
        })
        expect(refusal?.status).toBe(403)
        expect(await refusal?.json()).toMatchObject({
          code: 'video_uploads_paused',
        })
      }
      // Asked in the same process after the refusal, so a verdict cached for
      // one org cannot be what answered for the other.
      await expect(videoUploadsOpenForOrg(E2E_ORG_ID)).resolves.toBe(true)
    },
  )

  it('refuses an org whose document cannot be read', async () => {
    REMOTE_CONFIG[0][1]()
    const refusal = await videoUploadPausedRefusal({
      contentType: 'video/mp4',
      orgId: 'org-with-no-document',
    })
    expect(refusal?.status).toBe(403)
  })
})
