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
 * The site's transactional emails as a usage corpus (AGL-3287).
 *
 * A header or footer placed in a booking confirmation is grafted into every
 * one sent, so "Find where this is used" has to read those designs too. They
 * live at `hosts/{h}/emailTemplates/{key}`, with the tree on the published
 * version like a screen's — compressed, as the email besigner saves it — and
 * their documents carry no name, so the catalog's is used.
 */

import { compress } from '@aglyn/aglyn/app-utils/compress'
import {
  readUsageCandidates,
  scanComponentUsage,
  screenIdsUsingComponentDeep,
} from './live-page-usage'

const PLACES_HEADER = {
  '_@_': { $id: '_@_', componentId: 'div', nodes: ['hdr'] },
  hdr: {
    $id: 'hdr',
    componentId: 'reusableInstance',
    parentId: '_@_',
    props: { refId: 'header-1' },
    nodes: [],
  },
}

/** A host document reference over path-keyed documents. */
function hostRefOver(documents: Record<string, Record<string, unknown>>) {
  const snapshot = (path: string) => {
    const data = documents[path]
    return {
      id: path.split('/').pop() as string,
      exists: data !== undefined,
      get: (field: string) => data?.[field],
      ref: docRef(path),
    }
  }
  const docRef = (path: string): any => ({
    get: async () => snapshot(path),
    collection: (name: string) => ({
      doc: (id: string) => docRef(`${path}/${name}/${id}`),
    }),
  })
  return {
    collection: (name: string) => ({
      limit: (max: number) => ({
        get: async () => {
          const prefix = `hosts/h1/${name}/`
          const docs = Object.keys(documents)
            .filter(
              (key) =>
                key.startsWith(prefix) &&
                !key.slice(prefix.length).includes('/'),
            )
            .sort()
            .slice(0, max)
            .map(snapshot)
          return { size: docs.length, docs }
        },
      }),
    }),
  } as never
}

describe('readUsageCandidates over the site’s emails (AGL-3287)', () => {
  const hostRef = hostRefOver({
    'hosts/h1/emailTemplates/booking-confirmed': { versionId: 'v1' },
    'hosts/h1/emailTemplates/booking-confirmed/versions/v1': {
      nodes: Buffer.from(compress(PLACES_HEADER)),
    },
    // Designed once, never pointed at a version: nothing sends from it.
    'hosts/h1/emailTemplates/order-receipt': {},
  })

  it('reads each email’s published tree, decoded, under the catalog’s name', async () => {
    const read = await readUsageCandidates(hostRef, 'emailTemplates', {
      withNodes: true,
      limit: 200,
    })
    expect(read.truncated).toBe(false)
    expect(read.candidates).toEqual([
      expect.objectContaining({
        id: 'booking-confirmed',
        displayName: 'Booking confirmed',
        versionId: 'v1',
        nodes: PLACES_HEADER,
      }),
      expect.objectContaining({
        id: 'order-receipt',
        displayName: 'Order receipt',
        nodes: null,
      }),
    ])
  })

  it('lists the email that places the component, and only that one', async () => {
    const { candidates } = await readUsageCandidates(
      hostRef,
      'emailTemplates',
      {
        withNodes: true,
        limit: 200,
      },
    )
    expect(
      scanComponentUsage('header-1', {
        screens: [],
        layouts: [],
        components: [],
        emailTemplates: candidates,
      }),
    ).toEqual([
      {
        type: 'emailTemplate',
        id: 'booking-confirmed',
        name: 'Booking confirmed',
        via: ['id'],
        versionId: 'v1',
      },
    ])
  })
})

/**
 * A campaign's email is a `kind: 'email'` screen document that is never a page
 * (AGL-3287). Reported as a `screen`, the "Used by" card sent the reader to the
 * page settings — a slug, SEO and a Publish that would route the email — and
 * the publish-time cache drop went looking for a page it could not have.
 */
describe('a campaign email design is an email, not a page (AGL-3287)', () => {
  const hostRef = hostRefOver({
    'hosts/h1/screens/launch': {
      displayName: 'Launch email',
      kind: 'email',
      versionId: 'v2',
    },
    'hosts/h1/screens/launch/versions/v2': {
      nodes: Buffer.from(compress(PLACES_HEADER)),
    },
    'hosts/h1/screens/home': { displayName: 'Home', versionId: 'v9' },
    'hosts/h1/screens/home/versions/v9': {
      nodes: Buffer.from(compress(PLACES_HEADER)),
    },
  })

  it('reads a screen’s kind, and only when it has one', async () => {
    const { candidates } = await readUsageCandidates(hostRef, 'screens', {
      withNodes: true,
      limit: 200,
    })
    expect(candidates.find((entry) => entry.id === 'launch')).toMatchObject({
      kind: 'email',
    })
    expect(candidates.find((entry) => entry.id === 'home')).not.toHaveProperty(
      'kind',
    )
  })

  it('reports the email design as one, beside the page that places the same block', async () => {
    const { candidates } = await readUsageCandidates(hostRef, 'screens', {
      withNodes: true,
      limit: 200,
    })
    const sources = { screens: candidates, layouts: [], components: [] }
    expect(scanComponentUsage('header-1', sources)).toEqual([
      {
        type: 'screen',
        id: 'home',
        name: 'Home',
        via: ['id'],
        versionId: 'v9',
      },
      {
        type: 'emailDesign',
        id: 'launch',
        name: 'Launch email',
        via: ['id'],
        versionId: 'v2',
      },
    ])
    // Only the page has a cache to drop when the block is published.
    expect(screenIdsUsingComponentDeep('header-1', sources)).toEqual(['home'])
  })
})
