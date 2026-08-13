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
 * AGL-1462: the card's half of ⇧-click.
 *
 * `media-selection.spec.ts` proves what a range MEANS; this proves the card
 * actually reports the modifier, and — the part that is easy to get wrong —
 * that a ⇧-click does NOT also open the details drawer over the selection the
 * person is building.
 *
 * The whole grid is not rendered here on purpose: the library mounts a
 * Firestore listener stack and a dnd-kit surface, so a test of it is a test of
 * the mocks. The card is a plain component and this is the real one.
 */

import { fireEvent, render, screen } from '@testing-library/react'

import { MediaAssetCard } from './media-asset-card.component'

const MEDIA = {
  $id: 'm1',
  fileName: 'hero.png',
  contentType: 'image/png',
  sizeBytes: 1024,
  url: 'https://example.test/hero.png',
} as any

function renderCard(overrides: Record<string, any> = {}) {
  const onToggleSelect = jest.fn()
  const onDetails = jest.fn()
  render(
    <MediaAssetCard
      media={MEDIA}
      formatBytes={(bytes: number) => `${bytes} B`}
      selectable
      onToggleSelect={onToggleSelect}
      onDetails={onDetails}
      {...overrides}
    />,
  )
  return { onToggleSelect, onDetails }
}

/** The thumbnail, which is the card's primary click target. */
const tile = () => screen.getByRole('img', { name: 'hero.png' })

describe('⇧-click on a media card (AGL-1462)', () => {
  it('reports a range instead of opening the drawer', () => {
    const { onToggleSelect, onDetails } = renderCard()
    fireEvent.click(tile(), { shiftKey: true })
    expect(onToggleSelect).toHaveBeenCalledWith(true, { range: true })
    // Opening the details drawer would bury the selection being built.
    expect(onDetails).not.toHaveBeenCalled()
  })

  it('a plain click still opens the drawer and selects nothing', () => {
    const { onToggleSelect, onDetails } = renderCard()
    fireEvent.click(tile())
    expect(onDetails).toHaveBeenCalledTimes(1)
    expect(onToggleSelect).not.toHaveBeenCalled()
  })

  it('the checkbox reports the modifier too', () => {
    const { onToggleSelect } = renderCard()
    const checkbox = screen.getByRole('checkbox')
    fireEvent.click(checkbox, { shiftKey: true })
    expect(onToggleSelect).toHaveBeenCalledWith(true, { range: true })
  })

  it('the checkbox without ⇧ toggles just this card', () => {
    const { onToggleSelect } = renderCard()
    fireEvent.click(screen.getByRole('checkbox'))
    expect(onToggleSelect).toHaveBeenCalledWith(true, { range: false })
  })

  /**
   * Picker mode has no multi-select at all, so ⇧ must not swallow the click
   * that chooses the image.
   */
  it('leaves the picker alone', () => {
    const onSelect = jest.fn()
    const { onToggleSelect } = renderCard({
      selectable: false,
      onSelect,
      onDetails: undefined,
    })
    fireEvent.click(tile(), { shiftKey: true })
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onToggleSelect).not.toHaveBeenCalled()
  })
})
