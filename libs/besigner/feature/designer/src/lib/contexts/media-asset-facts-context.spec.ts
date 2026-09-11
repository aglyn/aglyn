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
 * The store the canvas's asset answers live in (AGL-2838, AGL-2856).
 *
 * The host app renders one live read per asset this store says is held, so
 * the count is what decides how many listeners an open canvas keeps: one per
 * asset however many placements draw it, and none once nothing does. An
 * answer that changes has to be announced, and one that does not exist must
 * not be.
 */

import { createMediaAssetFactsStore } from './media-asset-facts-context'

const FILM = { scope: 'org:acme', mediaId: 'film' }
const KEY = 'org:acme/film'
const REPLACED = { video: { durationMs: 3000, width: 480, height: 480 } }

describe('createMediaAssetFactsStore (AGL-2838)', () => {
  it('holds an asset once however many placements retain it', () => {
    const store = createMediaAssetFactsStore()
    const first = store.retain(FILM)
    const second = store.retain({ ...FILM })
    expect(store.getRetained()).toEqual([FILM])
    first()
    expect(store.getRetained()).toEqual([FILM])
    second()
    expect(store.getRetained()).toEqual([])
  })

  it('counts a release called twice once', () => {
    const store = createMediaAssetFactsStore()
    const first = store.retain(FILM)
    store.retain(FILM)
    first()
    first()
    expect(store.getRetained()).toEqual([FILM])
  })

  it('keeps the held list the same array until the held set changes', () => {
    const store = createMediaAssetFactsStore()
    const listener = jest.fn()
    store.subscribeRetained(listener)
    store.retain(FILM)
    const held = store.getRetained()
    store.retain(FILM)
    expect(store.getRetained()).toBe(held)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('files an answer, announces it, and withdraws it', () => {
    const store = createMediaAssetFactsStore()
    const listener = jest.fn()
    store.subscribe(listener)
    const before = store.getVersion()
    store.set(KEY, REPLACED)
    expect(store.get(KEY)).toBe(REPLACED)
    expect(store.getVersion()).not.toBe(before)
    expect(listener).toHaveBeenCalledTimes(1)
    store.set(KEY, undefined)
    expect(store.get(KEY)).toBeUndefined()
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('announces nothing when an asset with no answer is withdrawn', () => {
    const store = createMediaAssetFactsStore()
    const listener = jest.fn()
    store.subscribe(listener)
    const before = store.getVersion()
    store.set(KEY, undefined)
    expect(listener).not.toHaveBeenCalled()
    expect(store.getVersion()).toBe(before)
  })

  it('stops calling a listener that unsubscribed', () => {
    const store = createMediaAssetFactsStore()
    const listener = jest.fn()
    store.subscribe(listener)()
    store.set(KEY, REPLACED)
    expect(listener).not.toHaveBeenCalled()
  })
})
