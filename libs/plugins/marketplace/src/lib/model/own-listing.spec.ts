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
 *
 * @jest-environment node
 */

import {
  isOwnListingInstall,
  isPublisherMemberElsewhere,
  landsInPublisherWorkspace,
  publisherMemberBuyReason,
} from './own-listing'

describe('landsInPublisherWorkspace (AGL-4047)', () => {
  it('is the install landing in the workspace that publishes the listing', () => {
    expect(landsInPublisherWorkspace('pub', 'pub')).toBe(true)
    expect(landsInPublisherWorkspace('pub', 'client')).toBe(false)
  })

  it.each([
    ['no publisher', undefined, 'pub'],
    ['an empty publisher', '', ''],
    ['no target', 'pub', undefined],
    ['an empty target', 'pub', ''],
    ['a publisher that is not an id', { id: 'pub' }, 'pub'],
    ['a target that is not an id', 'pub', ['pub']],
  ])('lands nowhere for %s', (_case, publisher, target) => {
    expect(landsInPublisherWorkspace(publisher, target)).toBe(false)
  })
})

describe('isOwnListingInstall (AGL-2484, AGL-4047)', () => {
  it('waives for a member of the publisher on the publisher’s own site', () => {
    expect(isOwnListingInstall({ publisherOrgId: 'pub', targetOrgId: 'pub', publisherMember: true })).toBe(true)
  })

  it('never for the same member on another workspace’s site', () => {
    expect(isOwnListingInstall({ publisherOrgId: 'pub', targetOrgId: 'client', publisherMember: true })).toBe(false)
  })

  it('never for someone outside the publisher, even on its own site', () => {
    expect(isOwnListingInstall({ publisherOrgId: 'pub', targetOrgId: 'pub', publisherMember: false })).toBe(false)
  })

  it('never for a listing nobody publishes', () => {
    expect(isOwnListingInstall({ publisherOrgId: '', targetOrgId: '', publisherMember: true })).toBe(false)
  })
})

describe('isPublisherMemberElsewhere (AGL-4047)', () => {
  it('is a member of the publisher buying for another workspace', () => {
    expect(isPublisherMemberElsewhere({ publisherOrgId: 'pub', targetOrgId: 'client', publisherMember: true })).toBe(true)
  })

  it('never on the publisher’s own site, where the listing is free', () => {
    expect(isPublisherMemberElsewhere({ publisherOrgId: 'pub', targetOrgId: 'pub', publisherMember: true })).toBe(false)
  })

  it('never for someone outside the publisher', () => {
    expect(isPublisherMemberElsewhere({ publisherOrgId: 'pub', targetOrgId: 'client', publisherMember: false })).toBe(false)
  })
})

describe('publisherMemberBuyReason (AGL-4047)', () => {
  it('names the publisher', () => {
    expect(publisherMemberBuyReason('Pub Studio')).toBe(
      "Someone in this workspace who isn't in Pub Studio needs to buy it.",
    )
  })

  it.each([[''], ['  '], [undefined], [null], [7]])('says it plainly with no name to give (%p)', (name) => {
    expect(publisherMemberBuyReason(name)).toBe(
      "Someone in this workspace who isn't in the publishing workspace needs to buy it.",
    )
  })
})
