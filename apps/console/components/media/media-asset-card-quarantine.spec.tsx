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
 * The DAM SHOWS a quarantined asset (AGL-1612).
 *
 * Before this, a file staff had disabled looked exactly like a file that was
 * broken — to the workspace that owns it and to the staff operator looking at
 * the same grid. `media-quarantine-owner-route.spec.ts` proves the state is
 * fetched safely; this proves the card renders it, and — the half that is
 * easy to get wrong — that a healthy asset stays unmarked.
 */

import { render, screen } from '@testing-library/react'

import { MediaAssetCard } from './media-asset-card.component'

const MEDIA = {
  $id: 'm1',
  fileName: 'hero.png',
  contentType: 'image/png',
  sizeBytes: 1024,
  url: 'https://example.test/hero.png',
} as any

const NOTICE = {
  reason: 'dmca',
  title: 'This file was disabled',
  body:
    'This file was disabled in response to a copyright takedown notice. It ' +
    'has not been deleted and still counts toward your storage.',
  contact: 'support@aglyn.com',
}

function renderCard(overrides: Record<string, any> = {}) {
  render(
    <MediaAssetCard
      media={MEDIA}
      formatBytes={(bytes: number) => `${bytes} B`}
      {...overrides}
    />,
  )
}

describe('AGL-1612 · a disabled asset is visible in the grid', () => {
  it('badges the asset', () => {
    renderCard({ quarantine: NOTICE })
    expect(screen.getByText('Disabled')).toBeTruthy()
  })

  it('carries the reason and the way back in the label', () => {
    // The chip is four letters; the explanation has to be reachable from it
    // or the badge is just a second kind of "broken".
    renderCard({ quarantine: NOTICE })
    const described = screen.getByLabelText(
      `${NOTICE.body} (${NOTICE.contact})`,
    )
    expect(described).toBeTruthy()
  })

  it('leaves a healthy asset completely unmarked', () => {
    // The common case by an enormous margin. A badge on every asset is the
    // noise that makes the real one invisible.
    renderCard({})
    expect(screen.queryByText('Disabled')).toBeNull()
  })

  it('stays unmarked when the probe answered "not quarantined"', () => {
    renderCard({ quarantine: null })
    expect(screen.queryByText('Disabled')).toBeNull()
  })

  it('does not confuse "disabled" with the private advisory beside it', () => {
    // Two different facts. Private means "needs a signed link"; disabled
    // means "this is not serving to anyone".
    renderCard({ media: { ...MEDIA, private: true }, quarantine: NOTICE })
    expect(screen.getByText('Private')).toBeTruthy()
    expect(screen.getByText('Disabled')).toBeTruthy()
  })
})
