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
 * AGL-3466 — platform staff and owner handoffs take none of a customer's
 * seats, at every counter.
 *
 * A Free workspace has one team seat. When the staff member who built it
 * held that seat, the client it was built for could not be invited without a
 * hand-written override. The counters are where that is decided, so they are
 * where it is pinned.
 */

import {
  collaboratorSeatKeys,
  countCollaboratorSeats,
  countManagerSeats,
  countManagerSeatsExcluding,
  isStaffSeat,
  managerSeatKeys,
  parseOwnerHandoff,
  usesCustomerSeat,
} from './organizations'

const HOST = 'host-1'

describe('usesCustomerSeat (AGL-3466)', () => {
  it('a plain row or invite uses a seat', () => {
    expect(usesCustomerSeat({})).toBe(true)
    expect(usesCustomerSeat({ staffSeat: false })).toBe(true)
  })

  it('a staff-stamped entry does not', () => {
    expect(usesCustomerSeat({ staffSeat: true })).toBe(false)
    expect(isStaffSeat({ staffSeat: true })).toBe(true)
  })

  it('an owner-handoff invite does not', () => {
    expect(usesCustomerSeat({ handoff: { previousOwner: 'stay' } })).toBe(false)
  })

  it('only a literal true is a staff stamp', () => {
    // A stamp that read truthy strings would hand a free seat to anything
    // that wrote "yes" into the field.
    expect(usesCustomerSeat({ staffSeat: 'true' as never })).toBe(true)
    expect(isStaffSeat({ staffSeat: 1 as never })).toBe(false)
  })

  it('nothing is no seat', () => {
    expect(usesCustomerSeat(null)).toBe(false)
    expect(usesCustomerSeat(undefined)).toBe(false)
  })
})

describe('the manager counters skip staff and handoffs (AGL-3466)', () => {
  /** A Free workspace a staff member built, with the client invited as owner. */
  const staffBuilt = [
    { uid: 'staff', email: 'zed@aglyn.test', role: 'owner', allHosts: true, staffSeat: true },
    {
      email: 'client@acme.test',
      role: 'owner',
      allHosts: true,
      handoff: { previousOwner: 'stay' },
    },
  ]

  it('the staff owner and the pending handoff count zero seats', () => {
    expect(countManagerSeats(staffBuilt as never)).toBe(0)
    expect(managerSeatKeys(staffBuilt).size).toBe(0)
    expect(countManagerSeatsExcluding(staffBuilt)).toBe(0)
  })

  it('a staff admin beside a customer admin leaves one seat used', () => {
    const roster = [
      { uid: 'owner', email: 'owner@acme.test', role: 'owner', allHosts: true },
      { uid: 'staff', email: 'zed@aglyn.test', role: 'admin', allHosts: true, staffSeat: true },
    ]
    expect(countManagerSeats(roster as never)).toBe(1)
    expect(countManagerSeatsExcluding(roster)).toBe(1)
  })

  it('a staff-stamped pending invite reserves nothing', () => {
    const entries = [
      { uid: 'owner', email: 'owner@acme.test', role: 'owner', allHosts: true },
      { email: 'zed@aglyn.test', role: 'admin', allHosts: true, staffSeat: true },
    ]
    expect(countManagerSeats(entries as never)).toBe(1)
  })
})

describe('the collaborator counters skip staff (AGL-3466)', () => {
  it('a staff collaborator on a site holds no collaborator seat there', () => {
    const entries = [
      { uid: 'client', email: 'client@acme.test', role: 'editor', allHosts: false, hostAccess: { [HOST]: 'editor' } },
      { uid: 'staff', email: 'zed@aglyn.test', role: 'viewer', allHosts: false, hostAccess: { [HOST]: 'admin' }, staffSeat: true },
    ]
    expect([...collaboratorSeatKeys(entries, HOST)]).toEqual(['client@acme.test'])
    expect(countCollaboratorSeats(entries, HOST)).toBe(1)
  })
})

describe('parseOwnerHandoff (AGL-3466)', () => {
  it('reads the two choices', () => {
    expect(parseOwnerHandoff({ previousOwner: 'stay' })).toEqual({ previousOwner: 'stay' })
    expect(parseOwnerHandoff({ previousOwner: 'leave' })).toEqual({ previousOwner: 'leave' })
  })

  it('refuses anything else rather than guessing', () => {
    expect(parseOwnerHandoff({ previousOwner: 'go' })).toBeNull()
    expect(parseOwnerHandoff({})).toBeNull()
    expect(parseOwnerHandoff('stay')).toBeNull()
    expect(parseOwnerHandoff(null)).toBeNull()
  })

  it('drops anything beside the choice, so a body cannot smuggle a plan in', () => {
    expect(
      parseOwnerHandoff({ previousOwner: 'leave', plan: 'pro', extra: 1 }),
    ).toEqual({ previousOwner: 'leave' })
  })
})
