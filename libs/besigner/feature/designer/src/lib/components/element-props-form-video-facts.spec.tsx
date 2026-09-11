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
 * The Duration field says which running time the published page uses
 * (AGL-2838).
 *
 * The page lays a placed film's current DAM records over its node, and the
 * asset's running time wins over the one the pick stored. The field still
 * edits the stored value, since nothing here writes a draft, so after a
 * replace it would show a running time the page no longer publishes — unless
 * it says so.
 */

import * as Aglyn from '@aglyn/aglyn'
import { act, render, screen } from '@testing-library/react'
import {
  createVideoAssetFactsStore,
  VideoAssetFactsContext,
  type VideoAssetFactsStore,
} from '../contexts/video-asset-facts-context'
import ElementPropsForm from './element-props-form.component'

const KEY = 'org:acme/film'
const DESCRIPTION = 'How long the video runs, in seconds.'

/** What the pick copied onto the node from the film as first uploaded. */
const PICKED = {
  src: 'media:org:acme/film',
  durationSeconds: 2,
  intrinsicWidth: 640,
  intrinsicHeight: 360,
}

const durationAttribute = {
  name: 'durationSeconds',
  label: 'Duration (seconds)',
  component: Aglyn.FieldComponentType.TEXT_FIELD,
  type: 'number',
  description: DESCRIPTION,
}

const mount = (store: VideoAssetFactsStore) =>
  render(
    <VideoAssetFactsContext.Provider value={store}>
      <ElementPropsForm
        node={
          {
            $id: 'film',
            type: 'node',
            componentId: 'video',
            props: { ...PICKED },
            componentSchema: { attributes: [durationAttribute] },
            nodes: [],
          } as never
        }
      />
    </VideoAssetFactsContext.Provider>,
  )

describe('the Duration field after a replace (AGL-2838)', () => {
  it('shows its own description while the film has no answer', async () => {
    mount(createVideoAssetFactsStore())
    expect(await screen.findByText(DESCRIPTION)).toBeTruthy()
    expect(screen.queryByText(/media library/)).toBeNull()
  })

  it('names the running time the page uses once the asset records another', async () => {
    const store = createVideoAssetFactsStore()
    mount(store)
    await screen.findByText(DESCRIPTION)
    act(() =>
      store.set(KEY, { video: { durationMs: 3000, width: 480, height: 480 } }),
    )
    expect(
      await screen.findByText(
        'The media library records 3 seconds for this film, and the published page uses that.',
      ),
    ).toBeTruthy()
  })

  it('says the page gives no running time once the asset records none', async () => {
    const store = createVideoAssetFactsStore()
    mount(store)
    await screen.findByText(DESCRIPTION)
    act(() => store.set(KEY, { poster: { width: 480, height: 480 } }))
    expect(
      await screen.findByText(/no longer records a running time for this film/),
    ).toBeTruthy()
  })

  it('stays quiet when the asset agrees with the field', async () => {
    const store = createVideoAssetFactsStore()
    mount(store)
    await screen.findByText(DESCRIPTION)
    act(() =>
      store.set(KEY, { video: { durationMs: 2000, width: 640, height: 360 } }),
    )
    expect(await screen.findByText(DESCRIPTION)).toBeTruthy()
    expect(screen.queryByText(/media library/)).toBeNull()
  })
})
