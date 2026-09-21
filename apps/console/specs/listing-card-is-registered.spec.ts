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
 *
 * @jest-environment node
 */

/**
 * A listing link still unfurls as the listing (AGL-876, AGL-3080).
 *
 * The card used to be built by a console route that read
 * `marketplaceListings` itself. It is the marketplace plugin's now, declared
 * against the platform's route-metadata contract and asked for by the shell
 * — which is what lets that route move onto the generic plugin route without
 * the card changing.
 *
 * ⛔ AND WHICH MAKES THE LOADING ORDER THE WHOLE RISK. The declarations live
 * in a runtime registry; an unfilled one answers "nothing to add" for every
 * address, silently and exactly like the honest answer for a route nobody
 * declared. A shell that asked before loading the plugin's server surface
 * would drop every listing's card and stay green, which is the AGL-3025
 * shape.
 *
 * So this spec registers NOTHING. It calls what the layouts call, on a
 * deliberately empty registry, and the card coming back is the whole
 * assertion: the real manifest was loaded, the real registrar ran, and the
 * real declaration answered.
 *
 * The listing READ is doubled, because what is under test is the chain from
 * the address to the card and not the Admin SDK. What the card says about a
 * given document is held in the plugin's own
 * `listing-social-card.spec.ts`, and how it becomes tags in
 * `utils/plugin-route-head.spec.ts`.
 */

import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { pluginRouteMetadata } from '@aglyn/aglyn/plugin-manager/plugin-route-metadata'
import { pluginRouteHead } from '../utils/plugin-route-head'

/** The document the doubled read answers with, or `undefined` for no listing. */
let mockListing: Record<string, unknown> | undefined

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collection: () => ({
          doc: () => ({
            get: async () => ({
              exists: mockListing !== undefined,
              data: () => mockListing,
            }),
          }),
        }),
      }),
    }),
  },
}))

const PUBLISHED = {
  displayName: 'Northwind Pricing Table',
  description: 'A responsive pricing table with three tiers and a toggle.',
  previewImageUrl: 'https://cdn.example/preview.png',
  artifactType: 'component',
}

beforeEach(() => {
  mockListing = { ...PUBLISHED }
})

describe('the marketplace listing card, asked for the way the shell asks', () => {
  /**
   * ⛔ THE ONE THAT MATTERS, and it runs first on purpose.
   *
   * The registry is empty here, exactly as it is in a process that has
   * served no plugin API request yet. A shell that asked without loading
   * would get `null` — "nothing describes this address", indistinguishable
   * from the honest answer — and every listing link would unfurl as the
   * generic console card with nothing red anywhere. So the load is inside
   * `pluginRouteHead`, and this is the proof: no registrar is called by this
   * spec at all.
   *
   * It cannot be repeated: the loader memoizes per process, so a later reset
   * would leave the registry empty for good. Everything below runs on the
   * registrations this test caused.
   */
  it('loads the plugins itself, so a cold process still gets the card', async () => {
    resetPluginServicesForTests()
    expect(pluginRouteMetadata('marketplace')).toBeNull()

    const head = await pluginRouteHead('marketplace', ['listing-1'])

    expect(head).toMatchObject({
      title: 'Northwind Pricing Table',
      description: PUBLISHED.description,
      image: { url: 'https://cdn.example/preview.png' },
    })
  })

  it('is the marketplace that answers for `/marketplace`', () => {
    expect(pluginRouteMetadata('marketplace')?.pluginId).toBe('marketplace')
  })

  it('says nothing about a listing that is not there', async () => {
    mockListing = undefined

    // The shell keeps the title it built for itself — the same answer the
    // route gave before any of this existed.
    expect(await pluginRouteHead('marketplace', ['listing-1'])).toBeNull()
  })

  it('says nothing about the hub, or any deeper address', async () => {
    expect(await pluginRouteHead('marketplace', [])).toBeNull()
    expect(
      await pluginRouteHead('marketplace', ['listing-1', 'reviews']),
    ).toBeNull()
  })

  it('says nothing about a route no plugin describes', async () => {
    expect(await pluginRouteHead('crm', ['contact-1'])).toBeNull()
  })
})
