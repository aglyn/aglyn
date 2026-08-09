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
 * `Event.image` must be an absolute URL (AGL-1351).
 *
 * The third surface of the AGL-1337 / AGL-1343 defect: this node emitted
 * `event.coverImage` exactly as stored, and an event's cover is a free-text
 * "Cover image URL" field, so a site-relative path an author typed reached the
 * structured data unfetchable. The browser resolved it against the page and
 * showed the thumbnail, which is precisely why nobody noticed — the only
 * consumer that suffers is the one reading the markup out of band.
 */

import { eventJsonLd, type EventItem } from './event-list'

const anEvent = (overrides: Partial<EventItem> = {}): EventItem => ({
  $id: 'e1',
  title: 'Launch party',
  startsAtMs: Date.UTC(2026, 7, 20, 18),
  endsAtMs: Date.UTC(2026, 7, 20, 21),
  ...overrides,
})

const nodeFor = (overrides: Partial<EventItem> = {}) =>
  JSON.parse(eventJsonLd(anEvent(overrides)))

describe('the Event node’s image (AGL-1351)', () => {
  it('emits an absolute cover unchanged', () => {
    expect(
      nodeFor({ coverImage: 'https://acme.example/party.jpg' }).image,
    ).toEqual(['https://acme.example/party.jpg'])
  })

  it('emits a protocol-relative cover as https', () => {
    // The scheme is the only thing missing, and every consumer of this is
    // https — so this one is recoverable rather than dropped.
    expect(nodeFor({ coverImage: '//cdn.example/party.jpg' }).image).toEqual([
      'https://cdn.example/party.jpg',
    ])
  })

  it('omits a site-relative path rather than emitting one a crawler cannot follow', () => {
    // The shape of the bug: this used to reach the markup as `/uploads/…`,
    // which resolves against the page for a browser and against nothing at
    // all for a validator fetching the URL on its own. The block has no
    // origin to fix it with, so the honest answer is to say nothing.
    const node = nodeFor({ coverImage: '/uploads/party.jpg' })

    expect(node.image).toBeUndefined()
    expect(
      eventJsonLd(anEvent({ coverImage: '/uploads/party.jpg' })),
    ).not.toContain('image')
  })

  it('omits a media reference, which needs an origin this surface has not got', () => {
    expect(nodeFor({ coverImage: 'media:host-1/cover' }).image).toBeUndefined()
  })

  it('omits the field for a missing or cleared cover', () => {
    // `strictNullChecks` is off repo-wide — nothing but the guard stops
    // `"image": [null]` here.
    expect(nodeFor({}).image).toBeUndefined()
    expect(nodeFor({ coverImage: '' }).image).toBeUndefined()
    expect(nodeFor({ coverImage: null }).image).toBeUndefined()
  })

  it('leaves the rest of the node intact', () => {
    // An omission, not a bail-out: the fields that made this markup worth
    // emitting are all still here.
    const node = nodeFor({
      location: 'Austin',
      organizer: 'Acme',
      description: 'Doors at six',
    })

    expect(node).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'Event',
      name: 'Launch party',
      startDate: '2026-08-20T18:00:00.000Z',
      endDate: '2026-08-20T21:00:00.000Z',
      location: { '@type': 'Place', name: 'Austin' },
      organizer: { '@type': 'Organization', name: 'Acme' },
      description: 'Doors at six',
    })
  })

  it('escapes a title that would otherwise break out of the script tag', () => {
    // The node is rendered through `dangerouslySetInnerHTML`, and an event
    // title is author-typed (AGL-496).
    const raw = eventJsonLd(anEvent({ title: 'A </script> party' }))

    expect(raw).not.toContain('</script>')
    expect(JSON.parse(raw).name).toBe('A </script> party')
  })
})
