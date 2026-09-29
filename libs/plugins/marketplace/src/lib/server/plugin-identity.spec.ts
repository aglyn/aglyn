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

import {
  claimPluginIdentity,
  componentNamespaceRefusal,
  pluginIdentityFor,
} from './plugin-identity'

/** A Firestore double holding one collection of claim docs. */
function claimStore() {
  const docs = new Map<string, Record<string, unknown>>()
  const firestore = {
    collection: () => ({ doc: (id: string) => ({ id }) }),
    runTransaction: async <T>(
      work: (transaction: unknown) => Promise<T>,
    ): Promise<T> =>
      work({
        get: async (ref: { id: string }) => ({
          exists: docs.has(ref.id),
          get: (field: string) => docs.get(ref.id)?.[field],
        }),
        create: (ref: { id: string }, data: Record<string, unknown>) => {
          if (docs.has(ref.id)) throw new Error('already exists')
          docs.set(ref.id, data)
        },
      }),
  }
  return { docs, firestore: firestore as unknown as FirebaseFirestore.Firestore }
}

describe('plugin identity (AGL-3390)', () => {
  it('is the publisher handle and the manifest id', () => {
    expect(pluginIdentityFor('aglyn', 'calculator')).toBe('aglyn.calculator')
  })

  it("accepts site components in the plugin's own namespace", () => {
    expect(
      componentNamespaceRefusal('aglyn.calculator', {
        site: {
          components: ['aglyn.calculator.scope', 'aglyn.calculator.showWhen'],
        },
      }),
    ).toBeNull()
    expect(componentNamespaceRefusal('aglyn.calculator', undefined)).toBeNull()
  })

  it('refuses one outside it, or with no role, or a nested role', () => {
    const refusal = componentNamespaceRefusal('aglyn.calculator', {
      site: {
        components: [
          'aglyn.calculator.scope',
          'button',
          'aglyn.calculatorx.scope',
          'aglyn.calculator.',
          'aglyn.calculator.a.b',
        ],
      },
    })
    expect(refusal).toContain(
      'button, aglyn.calculatorx.scope, aglyn.calculator., aglyn.calculator.a.b',
    )
    expect(refusal).not.toContain('aglyn.calculator.scope,')
  })

  it('claims an identity for the first listing, and keeps it for that one', async () => {
    const { docs, firestore } = claimStore()
    const claim = { identity: 'aglyn.calculator', listingId: 'listing-1', profileId: 'org-1' }

    expect(await claimPluginIdentity(firestore, claim)).toBe(true)
    // A republish of the same listing finds its own claim.
    expect(await claimPluginIdentity(firestore, claim)).toBe(true)
    expect(docs.get('aglyn.calculator')?.['listingId']).toBe('listing-1')
  })

  it('refuses the identity to any other listing, for good', async () => {
    const { firestore } = claimStore()
    await claimPluginIdentity(firestore, {
      identity: 'aglyn.calculator',
      listingId: 'listing-1',
      profileId: 'org-1',
    })

    expect(
      await claimPluginIdentity(firestore, {
        identity: 'aglyn.calculator',
        listingId: 'listing-2',
        profileId: 'org-2',
      }),
    ).toBe(false)
  })
})
