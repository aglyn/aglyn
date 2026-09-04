/**
 * @jest-environment jsdom
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored (feedback_jest_environment_pragma_shadowed_by_license).
 *
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
 * The entity-logo picker (AGL-2486).
 *
 * Two things are worth pinning:
 *
 * 1. It writes a `media:` REFERENCE, like every other picker (AGL-2538). It
 *    used to write an absolute url, on the sound-at-the-time grounds that
 *    `seo.entity.logo` was copied verbatim into the tenant's JSON-LD with no
 *    resolver in front of it. AGL-2486's `hostSeoEntityImageJsonLd` put a
 *    resolver there, and an absolute url then became actively worse: it bakes
 *    in an origin, so connecting or changing a custom domain strands the
 *    publisher mark on the old host — in structured data, where nothing
 *    surfaces the breakage until a rich result stops appearing.
 * 2. Clearing writes `''` to Firestore rather than dropping the key — the
 *    AGL-1191 shape that makes "Remove" in a form silently keep the old
 *    value.
 */

import { fireEvent, render, screen } from '@testing-library/react'
import EntityLogoCard from './entity-logo-card.component'

const mockSetDoc = jest.fn((..._args: any[]) => Promise.resolve())
const mockHostDoc: { data: any } = { data: {} }

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useHost: () => ({ doc: mockHostDoc, setDoc: mockSetDoc }),
  useHostOrgId: () => 'org1',
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))

/**
 * Stand-in for the canonical picker: the real one mounts the whole media
 * library (Firestore, Storage, folders). What this card is responsible for
 * is what it does with the media it is HANDED, so the double hands it one.
 */
let mockPicked: any = null
jest.mock('./media/media-picker-dialog.component', () => ({
  __esModule: true,
  default: ({ open, onPick }: any) =>
    open ? (
      <button type="button" onClick={() => onPick(mockPicked)}>
        {'pick-media'}
      </button>
    ) : null,
}))

const openPickerAndChoose = () => {
  fireEvent.click(screen.getByRole('button', { name: /from media/i }))
  fireEvent.click(screen.getByRole('button', { name: 'pick-media' }))
}

describe('EntityLogoCard writes a URL a crawler can fetch', () => {
  beforeEach(() => {
    mockSetDoc.mockClear()
    mockHostDoc.data = { $id: 'h1', subdomain: 'acme', seo: { entity: {} } }
    mockPicked = null
  })

  it('writes a media REFERENCE for a CDN asset, with no origin in it', () => {
    // A `mediaCdn`-entitled org: `cdnPath` is present, so `mediaNodeSrc`
    // mints the reference. Storing it is what keeps the value portable —
    // the scope is resolved for the site doing the rendering, rather than
    // frozen at pick time.
    mockPicked = {
      $id: 'm1',
      url: 'https://firebasestorage.googleapis.com/raw.png',
      cdnPath: '/api/media/cdn/org:org1/m1',
    }
    render(<EntityLogoCard hostId="h1" />)
    openPickerAndChoose()

    const written = mockSetDoc.mock.calls[0][0].seo.entity.logo
    expect(written).toBe('media:org:org1/m1')
    // The property Zach spotted, and the whole point of AGL-2538: no origin
    // is baked into the stored value, so a domain change cannot strand it.
    expect(written).not.toContain('aglyn.app')
    expect(written).not.toContain('https://')
  })

  it('stores the same value whatever domain the site is on today', () => {
    // The regression this replaces asserted the opposite — that the written
    // value CHANGED with the host's current domain. That is exactly the
    // coupling that strands a publisher mark on a rename.
    const pick = () => {
      mockSetDoc.mockClear()
      mockPicked = {
        $id: 'm1',
        url: 'https://x/raw.png',
        cdnPath: '/api/media/cdn/org:org1/m1',
      }
      const view = render(<EntityLogoCard hostId="h1" />)
      openPickerAndChoose()
      view.unmount()
      return mockSetDoc.mock.calls[0][0].seo.entity.logo
    }

    mockHostDoc.data = { $id: 'h1', subdomain: 'acme', seo: { entity: {} } }
    const onSubdomain = pick()

    mockHostDoc.data = {
      $id: 'h1',
      subdomain: 'acme',
      cname: 'www.acme.com',
      seo: { entity: {} },
    }
    const onCustomDomain = pick()

    expect(onSubdomain).toBe(onCustomDomain)
  })

  it('falls back to the raw storage URL for a free-tier asset', () => {
    // No `cdnPath` — the org is not entitled to CDN delivery — so there is
    // nothing site-relative to absolutize and the raw URL is already one.
    mockPicked = { $id: 'm1', url: 'https://firebasestorage.googleapis.com/raw.png' }
    render(<EntityLogoCard hostId="h1" />)
    openPickerAndChoose()

    expect(mockSetDoc.mock.calls[0][0].seo.entity.logo).toBe(
      'https://firebasestorage.googleapis.com/raw.png',
    )
  })

  it('writes the reference even for a host with no public origin yet', () => {
    // Neither a subdomain nor a domain. The old absolute writer had to fall
    // back to the raw storage url here, because there was no origin to
    // absolutize against (AGL-1160). A reference has no such dependency —
    // which is the point: the value is written once and resolved wherever
    // and whenever the site is eventually served.
    mockHostDoc.data = { $id: 'h1', seo: { entity: {} } }
    mockPicked = {
      $id: 'm1',
      url: 'https://firebasestorage.googleapis.com/raw.png',
      cdnPath: '/api/media/cdn/org:org1/m1',
    }
    render(<EntityLogoCard hostId="h1" />)
    openPickerAndChoose()

    expect(mockSetDoc.mock.calls[0][0].seo.entity.logo).toBe('media:org:org1/m1')
  })

  it('writes an EMPTY STRING on remove, not a dropped key', () => {
    mockHostDoc.data = {
      $id: 'h1',
      subdomain: 'acme',
      seo: { entity: { name: 'Acme', logo: 'https://acme.com/logo.png' } },
    }
    render(<EntityLogoCard hostId="h1" />)
    fireEvent.click(screen.getByRole('button', { name: /remove/i }))

    expect(mockSetDoc).toHaveBeenCalledWith(
      { seo: { entity: { logo: '' } } },
      { merge: true },
    )
  })

  it('says so when a logo is saved with no entity name to publish it', () => {
    // The tenant emits the `publisher` node only when the entity has a name,
    // and the logo hangs off that node — so this pair is a silent no-op.
    mockHostDoc.data = {
      $id: 'h1',
      subdomain: 'acme',
      seo: { entity: { logo: 'https://acme.com/logo.png' } },
    }
    render(<EntityLogoCard hostId="h1" />)
    expect(screen.getByText(/needs an entity NAME/i)).toBeTruthy()
  })

  it('stays quiet once the entity has a name', () => {
    mockHostDoc.data = {
      $id: 'h1',
      subdomain: 'acme',
      seo: { entity: { name: 'Acme', logo: 'https://acme.com/logo.png' } },
    }
    render(<EntityLogoCard hostId="h1" />)
    expect(screen.queryByText(/needs an entity NAME/i)).toBeNull()
  })
})

/**
 * A PERSON does not have a logo (AGL-2486).
 *
 * The Type select one field up may say Person — the common case for a
 * portfolio or a one-person consultancy — so no line on this card may talk
 * about a logo, a publisher's mark or the organization publishing the site.
 *
 * It is not only wording, which is why this is asserted rather than eyeballed:
 * `schema.org` gives `logo` to an Organization and `image` to a Person, so a
 * Person's picture emitted as `logo` sits under a property its own `@type`
 * does not define, and every consumer ignores it. `hostSeoEntityImageJsonLd`
 * settles the output; these assertions settle what the console claims about
 * it.
 *
 * The type is read from the SAVED document, not the form's live selection —
 * the card describes what is published, and nothing is published until Update.
 */
describe('the copy follows the entity TYPE', () => {
  beforeEach(() => {
    mockSetDoc.mockClear()
    mockPicked = null
  })

  it('says logo for an Organization', () => {
    mockHostDoc.data = {
      $id: 'h1',
      subdomain: 'acme',
      // The Select persists its option value as a STRING (its options are
      // template literals) — the shape that made an earlier `=== enum`
      // comparison always false, so a site could never publish `Person`.
      seo: { entity: { type: '1', name: 'Acme' } },
    }
    render(<EntityLogoCard hostId="h1" />)
    // Exact, because `/Entity logo/i` also matches "No entity logo set".
    expect(screen.getByText('Entity logo')).toBeTruthy()
    expect(screen.getByText(/No entity logo set/i)).toBeTruthy()
    expect(screen.queryByText(/Entity photo/i)).toBeNull()
  })

  it('says PHOTO for a Person, in every place logo appeared', () => {
    mockHostDoc.data = {
      $id: 'h1',
      subdomain: 'acme',
      seo: { entity: { type: '2', name: 'Ada Lovelace' } },
    }
    render(<EntityLogoCard hostId="h1" />)
    // Exact, because `/Entity photo/i` also matches "No entity photo set".
    expect(screen.getByText('Entity photo')).toBeTruthy()
    expect(screen.getByText(/No entity photo set/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Choose photo from media/i })).toBeTruthy()
    // The description, and the size advice, both change — a person's picture
    // is a photograph, not a mark, so the publisher-logo floor is the wrong
    // number to recommend for it.
    expect(screen.getByText(/picture of the person who publishes it/i)).toBeTruthy()
    expect(screen.getByText(/shown as a picture of a person rather than a mark/i)).toBeTruthy()
    expect(screen.queryByText(/publisher’s mark/i)).toBeNull()
  })

  it('reads the SAVED type, whatever shape it was stored in', () => {
    // A numeric enum and its string spelling must answer alike; the console
    // has written both, and an earlier `=== enum` comparison across the two
    // was always false — which is how no site could publish `Person` at all.
    for (const type of [2, '2'] as const) {
      mockHostDoc.data = {
        $id: 'h1',
        subdomain: 'acme',
        seo: { entity: { type, name: 'Ada' } },
      }
      const view = render(<EntityLogoCard hostId="h1" />)
      expect(screen.getByText('Entity photo')).toBeTruthy()
      view.unmount()
    }
  })
})
