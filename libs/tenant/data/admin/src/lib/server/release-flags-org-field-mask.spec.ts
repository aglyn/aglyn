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
 * The per-org release-flag read fetches only the fields it uses (AGL-4121).
 *
 * The double below answers `getAll` the way Firestore does: it returns ONLY
 * the masked paths of the stored document. Each org shape is then resolved
 * twice, through the masked read and from the whole document, and the two
 * must agree. A field `resolveEffectivePlan` starts consulting without being
 * added to `ORG_RELEASE_FLAG_FIELDS` turns one of these red.
 */

import { resolveEffectivePlan } from '@aglyn/aglyn/server'

let mockStored: Record<string, unknown> | undefined
const mockMasks: string[][] = []
let mockReads = 0

/** Firestore's projection: only the dotted paths asked for, nested as stored. */
function mockProject(
  data: Record<string, unknown>,
  paths: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const path of paths) {
    const parts = path.split('.')
    let source: unknown = data
    for (const part of parts) {
      source =
        source && typeof source === 'object'
          ? (source as Record<string, unknown>)[part]
          : undefined
    }
    if (source === undefined) continue
    let target = out
    parts.slice(0, -1).forEach((part) => {
      target[part] = (target[part] as Record<string, unknown>) ?? {}
      target = target[part] as Record<string, unknown>
    })
    target[parts[parts.length - 1]] = source
  }
  return out
}

jest.mock('./firebase-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      remoteConfig: () => ({
        getTemplate: async () => {
          throw new Error('no Remote Config here')
        },
      }),
      firestore: () => ({
        collection: () => ({ doc: (id: string) => ({ id }) }),
        getAll: async (_ref: unknown, options: { fieldMask: string[] }) => {
          mockReads += 1
          mockMasks.push(options.fieldMask)
          await Promise.resolve()
          return [
            {
              data: () =>
                mockStored ? mockProject(mockStored, options.fieldMask) : undefined,
            },
          ]
        },
      }),
    }),
  },
}))

import {
  __resetReleaseFlagCaches,
  getOrgReleaseFlagTargeting,
  isServerReleaseFlagOnForLoadedOrg,
  ORG_RELEASE_FLAG_FIELDS,
} from './release-flags'

/** A large org, the way production documents carry far more than this read needs. */
const bulk = {
  name: 'Acme',
  usage: { months: Object.fromEntries(Array.from({ length: 24 }, (_, i) => [`m${i}`, i])) },
  seatAddons: { collaborators: 3 },
}

const ORGS: Record<string, Record<string, unknown>> = {
  'no plan': { ...bulk },
  'stored paid plan': { ...bulk, plan: 'business' },
  'live subscription': { ...bulk, plan: 'pro', subscription: { status: 'active', id: 'sub_1' } },
  'dead subscription': { ...bulk, plan: 'pro', subscription: { status: 'canceled' } },
  'mirrored status wins': {
    ...bulk,
    plan: 'pro',
    billingStatus: 'unpaid',
    subscription: { status: 'active' },
  },
  'comp on a dead subscription': {
    ...bulk,
    plan: 'pro',
    subscription: { status: 'canceled' },
    entitlements: { planComp: { plan: 'business', uncapped: true }, other: 1 },
  },
  'comp with no subscription': {
    ...bulk,
    entitlements: { planComp: { plan: 'pro' } },
  },
  'overrides only': { ...bulk, releaseFlags: { release_video_embed_posters: true } },
}

beforeEach(() => {
  __resetReleaseFlagCaches()
  mockMasks.length = 0
  mockReads = 0
  mockStored = undefined
})

describe('the org read is masked to the fields the answer uses (AGL-4121)', () => {
  it.each(Object.keys(ORGS))('resolves the same plan and overrides for: %s', async (name) => {
    mockStored = ORGS[name]
    const masked = await getOrgReleaseFlagTargeting('org-1')
    expect(masked.plan).toBe(resolveEffectivePlan(ORGS[name] as never))
    // The loaded-org path reads the WHOLE document and must agree with it.
    const loaded = await isServerReleaseFlagOnForLoadedOrg(
      'release_video_embed_posters',
      'org-1',
      ORGS[name],
    )
    const viaRead = (masked.overrides as Record<string, boolean>)['release_video_embed_posters'] === true
    expect(loaded).toBe(viaRead)
  })

  it('asks Firestore for exactly the declared fields', async () => {
    mockStored = ORGS['live subscription']
    await getOrgReleaseFlagTargeting('org-1')
    expect(mockMasks).toEqual([[...ORG_RELEASE_FLAG_FIELDS]])
  })

  it('keeps a missing document an UNKNOWN tier, not Free', async () => {
    mockStored = undefined
    await expect(getOrgReleaseFlagTargeting('org-1')).resolves.toEqual({
      overrides: {},
      plan: null,
    })
  })

  it('shares one read between concurrent misses for the same org', async () => {
    mockStored = ORGS['stored paid plan']
    const answers = await Promise.all([
      getOrgReleaseFlagTargeting('org-1'),
      getOrgReleaseFlagTargeting('org-1'),
      getOrgReleaseFlagTargeting('org-1'),
    ])
    expect(mockReads).toBe(1)
    expect(answers.every((answer) => answer.plan === 'business')).toBe(true)
  })

  it('the loaded-org verdict reads nothing at all', async () => {
    await isServerReleaseFlagOnForLoadedOrg('release_video_embed_posters', 'org-1', {
      releaseFlags: { release_video_embed_posters: true },
    })
    expect(mockReads).toBe(0)
  })
})
