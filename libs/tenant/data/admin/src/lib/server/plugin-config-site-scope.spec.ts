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
 * A per-site setting has to reach the SERVER, or it is not a setting.
 *
 * `getPluginConfig` is what `/api/bookings/slots` and the POS sale route
 * resolve their limits from. Both failures it can have are silent:
 *
 *  - it ignores the site's override, and the console shows an operator the
 *    horizon they typed while the endpoint keeps offering the workspace's;
 *  - it stops applying the workspace's value to a site that overrides
 *    nothing, and that site quietly reverts to schema defaults.
 *
 * Neither raises anything. Both are asserted here, together with the read
 * budget: the host document must be fetched only when a host is in scope, so
 * a request with no site does not pay for a document that cannot apply to it.
 */

import { registerPluginConfigSchema } from '@aglyn/aglyn/server'

/** Every `collection(...)` path this test's reads touched, in order. */
const touched: string[] = []
/** The documents the double serves, keyed by full path. */
const documents = new Map<string, Record<string, unknown>>()

const fakeFirestore = () => ({
  collection: (scope: string) => {
    touched.push(scope)
    return {
      doc: (scopeId: string) => ({
        collection: (sub: string) => ({
          doc: (docId: string) => ({
            get: async () => ({
              data: () => documents.get(`${scope}/${scopeId}/${sub}/${docId}`),
            }),
          }),
        }),
      }),
    }
  },
})

jest.mock('./firebase-admin', () => ({
  __esModule: true,
  firebaseAdmin: { app: () => ({ firestore: () => fakeFirestore() }) },
  default: { app: () => ({ firestore: () => fakeFirestore() }) },
}))
jest.mock('./organizations', () => ({
  __esModule: true,
  resolveOrgIdForHost: async () => 'org-1',
}))
jest.mock('../render-cache', () => ({
  __esModule: true,
  tenantDataTag: (hostId: string) => `tenant:${hostId}`,
  withRenderCache: async (options: { read: () => Promise<unknown> }) =>
    options.read(),
}))

const { getPluginConfig } = require('./realm-plugins') as {
  getPluginConfig: (
    orgId: string | null | undefined,
    pluginId: string,
    options?: { hostId?: string | null },
  ) => Promise<Record<string, unknown>>
}

registerPluginConfigSchema({
  pluginId: 'bookings-site-scope-spec',
  fields: [
    {
      key: 'horizonDays',
      label: 'Booking horizon',
      type: 'number',
      min: 1,
      max: 365,
    },
    { key: 'requireDeposit', label: 'Require a deposit', type: 'boolean' },
    { key: 'timeZone', label: 'Time zone', type: 'string' },
  ],
  defaults: { horizonDays: 60, requireDeposit: false, timeZone: 'UTC' },
})

const PLUGIN = 'bookings-site-scope-spec'

beforeEach(() => {
  touched.length = 0
  documents.clear()
})

describe('what a request resolves for one site', () => {
  it('THE CONTROL: the workspace answer, with no host in scope', async () => {
    /*
     * Every case below is worth something only because this proves the org
     * layer is read and applied at all — and because it is the call shape
     * every existing handler makes, unchanged.
     */
    documents.set(`orgs/org-1/pluginSettings/${PLUGIN}`, { horizonDays: 90 })
    await expect(getPluginConfig('org-1', PLUGIN)).resolves.toMatchObject({
      horizonDays: 90,
      timeZone: 'UTC',
    })
  })

  it('never reads a host document when no host is in scope', async () => {
    // The condition on the extra read. Without it every request that resolves
    // config pays for a document that could not have applied to it.
    documents.set(`orgs/org-1/pluginSettings/${PLUGIN}`, { horizonDays: 90 })
    await getPluginConfig('org-1', PLUGIN)
    expect(touched).toEqual(['orgs'])
  })

  it('applies the site override, and inherits every other key', async () => {
    /*
     * The whole point: one chain, one horizon, and the flagship branch taking
     * bookings further out — without restating the settings it agrees with.
     */
    documents.set(`orgs/org-1/pluginSettings/${PLUGIN}`, {
      horizonDays: 90,
      requireDeposit: true,
      timeZone: 'America/Chicago',
    })
    documents.set(`hosts/host-1/pluginSettings/${PLUGIN}`, {
      horizonDays: 365,
    })
    await expect(
      getPluginConfig('org-1', PLUGIN, { hostId: 'host-1' }),
    ).resolves.toEqual({
      horizonDays: 365,
      requireDeposit: true,
      timeZone: 'America/Chicago',
    })
    expect(touched).toEqual(['orgs', 'hosts'])
  })

  it('keeps following the workspace on a site that overrides nothing', async () => {
    // The half a "read the host too" change breaks by accident: a site with
    // no document of its own must be unaffected by the new read.
    documents.set(`orgs/org-1/pluginSettings/${PLUGIN}`, { horizonDays: 120 })
    await expect(
      getPluginConfig('org-1', PLUGIN, { hostId: 'host-1' }),
    ).resolves.toMatchObject({ horizonDays: 120 })
  })

  it('lets a site override be falsy and still be an override', async () => {
    // `0`, `false` and `''` are what a truthiness merge loses, and a branch
    // that switched deposits OFF against a workspace that requires them is
    // the override an operator would most notice failing.
    documents.set(`orgs/org-1/pluginSettings/${PLUGIN}`, {
      requireDeposit: true,
    })
    documents.set(`hosts/host-1/pluginSettings/${PLUGIN}`, {
      requireDeposit: false,
    })
    await expect(
      getPluginConfig('org-1', PLUGIN, { hostId: 'host-1' }),
    ).resolves.toMatchObject({ requireDeposit: false })
  })

  it('falls back to the WORKSPACE value on a malformed site value', async () => {
    // The direction that matters, and the reason this resolves through
    // `resolvePluginConfig` rather than spreading one document over another:
    // coercing per level would have one bad override discard a value the
    // operator can see in their own console and believes is in force.
    documents.set(`orgs/org-1/pluginSettings/${PLUGIN}`, { horizonDays: 90 })
    documents.set(`hosts/host-1/pluginSettings/${PLUGIN}`, {
      horizonDays: 'soon',
    })
    await expect(
      getPluginConfig('org-1', PLUGIN, { hostId: 'host-1' }),
    ).resolves.toMatchObject({ horizonDays: 90 })
  })
})
