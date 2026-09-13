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
 * An experiment variant names its site (AGL-2883).
 *
 * A visitor bucketed into a variant is served a separately composed tree,
 * swapped in for the published one. The composition fills host variables in
 * from the site it is handed and renders each as nothing without one, so a
 * variant composed without the site shows a blank where every other visitor
 * reads the business name. Both hops are pinned: the enricher hands its site
 * to the experiments reader, and the reader hands it to each variant's
 * composition.
 */

const mockCompose = jest.fn()
const mockGetScreenExperiments = jest.fn()

jest.mock('@aglyn/tenant-runtime/compose-screen-nodes', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockCompose(...args),
}))
jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collection: () => ({
          doc: () => ({
            collection: () => ({
              where: () => ({
                limit: () => ({
                  get: async () => ({
                    docs: [
                      {
                        id: 'exp-1',
                        data: () => ({
                          target: 'screen',
                          status: 'running',
                          variants: [
                            { id: 'control', versionId: 'v-published' },
                            { id: 'challenger', versionId: 'v-challenger' },
                          ],
                        }),
                      },
                    ],
                  }),
                }),
              }),
            }),
          }),
        }),
      }),
    }),
  },
}))
jest.mock('./get-screen-experiments', () => ({
  __esModule: true,
  getScreenExperiments: (...args: unknown[]) =>
    mockGetScreenExperiments(...args),
}))
jest.mock('./get-overlays', () => ({
  __esModule: true,
  default: jest.fn(async () => []),
}))
jest.mock('@aglyn/tenant-runtime/get-variables', () => ({
  __esModule: true,
  default: jest.fn(async () => ({})),
}))
jest.mock('./get-client-automations', () => ({
  __esModule: true,
  getClientAutomations: jest.fn(async () => []),
}))

import { marketingSitePageEnricher } from './site-page-enricher'

const SITE = { $id: 'host-1', displayName: 'Northwind Coffee' }
const SCREEN = { $id: 'home', versionId: 'v-published' }

beforeEach(() => {
  jest.clearAllMocks()
  mockCompose.mockResolvedValue({ root: {} })
  mockGetScreenExperiments.mockResolvedValue([])
})

describe('an experiment variant names its site (AGL-2883)', () => {
  it("composes each divergent variant against the page's site", async () => {
    const { getScreenExperiments } = jest.requireActual(
      './get-screen-experiments',
    ) as typeof import('./get-screen-experiments')

    const experiments = await getScreenExperiments({
      hostId: 'host-1',
      screenId: 'home',
      screen: SCREEN as never,
      host: SITE,
    })

    // Only the challenger diverges from the published version.
    expect(experiments[0]?.payloads).toEqual({
      control: null,
      challenger: { root: {} },
    })
    expect(mockCompose).toHaveBeenCalledTimes(1)
    expect(mockCompose.mock.calls[0][0]).toMatchObject({
      versionId: 'v-challenger',
      host: SITE,
    })
  })

  it('hands the page\'s site to the experiments reader', async () => {
    await marketingSitePageEnricher({
      hostId: 'host-1',
      host: SITE,
      // Business: A/B testing is entitled, so the reader is asked at all.
      org: { $id: 'org-1', plan: 'business', subscriptionStatus: 'active' },
      path: '/',
      slugSegments: [],
      screenId: 'home',
      screen: SCREEN,
      nodes: { root: {} },
    } as never)

    expect(mockGetScreenExperiments).toHaveBeenCalledTimes(1)
    expect(mockGetScreenExperiments.mock.calls[0][0]).toMatchObject({
      screenId: 'home',
      host: SITE,
    })
  })
})
