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
 * The console answers the besigner canvas's placed images and films from their
 * DAM documents (AGL-2838, AGL-2856).
 *
 * The canvas lays whatever this files over a node's render copy, so what it
 * files has to be what the published page would use: the document the
 * composition reads, decided by the composition's own function, for the site
 * the canvas edits — and nothing at all while the read is pending, after it
 * fails, or when the page keeps the node's stored props. A replace rewrites the
 * document under a live listener, so the answer has to follow it.
 */

import { act, render, screen } from '@testing-library/react'
import { useContext, useEffect, useSyncExternalStore } from 'react'

type MockDocState = {
  status: 'loading' | 'success' | 'error'
  data?: Record<string, unknown>
}

const mockDocuments = new Map<string, MockDocState>()
const mockListeners = new Set<() => void>()
const mockOpenPaths: string[] = []
let mockVersion = 0

/** What a live listener on `path` delivers next. */
function mockDeliver(path: string, state: MockDocState) {
  mockDocuments.set(path, state)
  mockVersion += 1
  for (const listener of [...mockListeners]) listener()
}

jest.mock('@aglyn/tenant-feature-instance', () => {
  const react = jest.requireActual('react')
  return {
    useFirestore: () => 'firestore',
    // A live listener in miniature: its caller re-renders whenever
    // `mockDeliver` hands a path a new state, and an open read is recorded
    // for as long as the caller is mounted.
    useFirestoreDoc: (buildRef: () => { path: string } | null) => {
      react.useSyncExternalStore(
        (listener: () => void) => {
          mockListeners.add(listener)
          return () => mockListeners.delete(listener)
        },
        () => mockVersion,
      )
      const path = buildRef()?.path
      react.useEffect(() => {
        if (!path) return undefined
        mockOpenPaths.push(path)
        return () => {
          mockOpenPaths.splice(mockOpenPaths.indexOf(path), 1)
        }
      }, [path])
      const state = path ? mockDocuments.get(path) : undefined
      return {
        data: state?.data,
        status: state?.status ?? 'loading',
        error: undefined,
        hasPendingWrites: false,
        fromCache: false,
        serverDenied: false,
      }
    },
  }
})

jest.mock('firebase/firestore', () => ({
  doc: (_firestore: unknown, path: string) => ({ path }),
}))

import { mediaAssetFactsKey } from '@aglyn/aglyn/app-utils/media-asset-facts'
import { hostScopeToken } from '@aglyn/aglyn/server'
import { MediaAssetFactsContext } from '@aglyn/besigner-ui/contexts/media-asset-facts-context'
import BesignerMediaAssetFactsProvider from '../components/besigner-media-asset-facts-provider.component'

type Asset = { scope: string; mediaId: string }

const ORG_FILM: Asset = { scope: 'org:acme', mediaId: 'film' }
const SITE_FILM: Asset = { scope: 'site1', mediaId: 'clip' }
const SITE_PHOTO: Asset = { scope: 'site1', mediaId: 'photo' }
const FIRST = { durationMs: 2000, width: 640, height: 360 }
const REPLACED = { durationMs: 3000, width: 480, height: 480 }
const POSTER = { width: 480, height: 480, variants: [320] }
const noSubscription = () => () => undefined
const noVersion = () => 0

/** Holds an asset the way a canvas leaf does, and prints what it is answered. */
function CanvasAsset(props: { asset: Asset }) {
  const { asset } = props
  const source = useContext(MediaAssetFactsContext)
  useEffect(() => source?.retain(asset), [source, asset])
  useSyncExternalStore(
    source ? source.subscribe : noSubscription,
    source ? source.getVersion : noVersion,
  )
  const answer = source?.get(mediaAssetFactsKey(asset))
  return (
    <output data-testid={mediaAssetFactsKey(asset)}>
      {JSON.stringify(answer ?? null)}
    </output>
  )
}

const answerFor = (asset: Asset) =>
  JSON.parse(screen.getByTestId(mediaAssetFactsKey(asset)).textContent ?? 'null')

const canvas = (assets: Asset[], hostId = 'site1') => (
  <BesignerMediaAssetFactsProvider hostId={hostId}>
    {assets.map((asset) => (
      <CanvasAsset key={mediaAssetFactsKey(asset)} asset={asset} />
    ))}
  </BesignerMediaAssetFactsProvider>
)

beforeEach(() => {
  mockDocuments.clear()
  mockListeners.clear()
  mockOpenPaths.length = 0
})

describe('BesignerMediaAssetFactsProvider (AGL-2838, AGL-2856)', () => {
  it("reads an org film from the org library and a site film from the site's own", () => {
    render(canvas([ORG_FILM, SITE_FILM]))
    expect([...mockOpenPaths].sort()).toEqual([
      'hosts/site1/media/clip',
      'orgs/acme/media/film',
    ])
  })

  it('answers with what the document records, and follows a replace', () => {
    render(canvas([ORG_FILM]))
    act(() =>
      mockDeliver('orgs/acme/media/film', {
        status: 'success',
        data: { video: FIRST, visibleTo: ['org'] },
      }),
    )
    expect(answerFor(ORG_FILM)).toEqual({ video: FIRST })
    // `/api/media/replace` rewrites the records under the same id.
    act(() =>
      mockDeliver('orgs/acme/media/film', {
        status: 'success',
        data: { video: REPLACED, poster: POSTER, visibleTo: ['org'] },
      }),
    )
    expect(answerFor(ORG_FILM)).toEqual({ video: REPLACED, poster: POSTER })
  })

  it("answers an image with its document's pixel pair, and follows a replace", () => {
    render(canvas([SITE_PHOTO]))
    expect(mockOpenPaths).toEqual(['hosts/site1/media/photo'])
    act(() =>
      mockDeliver('hosts/site1/media/photo', {
        status: 'success',
        data: { width: 1200, height: 630 },
      }),
    )
    expect(answerFor(SITE_PHOTO)).toEqual({ width: 1200, height: 630 })
    act(() =>
      mockDeliver('hosts/site1/media/photo', {
        status: 'success',
        data: { width: 480, height: 480 },
      }),
    )
    expect(answerFor(SITE_PHOTO)).toEqual({ width: 480, height: 480 })
  })

  it('answers nothing while the read is pending, or once it has failed', () => {
    render(canvas([ORG_FILM]))
    expect(answerFor(ORG_FILM)).toBeNull()
    act(() =>
      mockDeliver('orgs/acme/media/film', {
        status: 'success',
        data: { video: FIRST, visibleTo: ['org'] },
      }),
    )
    expect(answerFor(ORG_FILM)).toEqual({ video: FIRST })
    act(() => mockDeliver('orgs/acme/media/film', { status: 'error' }))
    expect(answerFor(ORG_FILM)).toBeNull()
  })

  it('answers nothing for an asset the published page keeps at its stored props', () => {
    const restricted = { scope: 'org:acme', mediaId: 'restricted' }
    const gone = { scope: 'site1', mediaId: 'gone' }
    const hidden = { scope: 'site1', mediaId: 'hidden' }
    const assets = [ORG_FILM, SITE_FILM, restricted, gone, hidden]
    render(canvas(assets))
    act(() => {
      // An org film with no scope at all: the CDN serves it under no URL.
      mockDeliver('orgs/acme/media/film', {
        status: 'success',
        data: { video: FIRST },
      })
      mockDeliver('orgs/acme/media/restricted', {
        status: 'success',
        data: { width: 1200, height: 630, visibleTo: [hostScopeToken('site9')] },
      })
      mockDeliver('hosts/site1/media/clip', {
        status: 'success',
        data: { video: FIRST, deletedAt: 1 },
      })
      mockDeliver('hosts/site1/media/gone', { status: 'success' })
      mockDeliver('hosts/site1/media/hidden', {
        status: 'success',
        data: { width: 1200, height: 630, private: true },
      })
    })
    for (const asset of assets) expect(answerFor(asset)).toBeNull()
  })

  it('asks visibility of the site the canvas edits', () => {
    const sharedWithSite9 = {
      status: 'success' as const,
      data: { video: FIRST, visibleTo: [hostScopeToken('site9')] },
    }
    const onSite1 = render(canvas([ORG_FILM], 'site1'))
    act(() => mockDeliver('orgs/acme/media/film', sharedWithSite9))
    expect(answerFor(ORG_FILM)).toBeNull()
    onSite1.unmount()
    render(canvas([ORG_FILM], 'site9'))
    expect(answerFor(ORG_FILM)).toEqual({ video: FIRST })
  })

  it('reads one asset once however many placements draw it', () => {
    render(
      <BesignerMediaAssetFactsProvider hostId="site1">
        <CanvasAsset asset={ORG_FILM} />
        <CanvasAsset asset={{ ...ORG_FILM }} />
      </BesignerMediaAssetFactsProvider>,
    )
    expect(mockOpenPaths).toEqual(['orgs/acme/media/film'])
  })

  it('stops reading an asset nothing on the canvas draws any more', () => {
    const { rerender } = render(canvas([ORG_FILM, SITE_FILM]))
    rerender(canvas([ORG_FILM]))
    expect(mockOpenPaths).toEqual(['orgs/acme/media/film'])
  })
})
