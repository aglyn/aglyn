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

import { DEAL_CONTACT_ROLES_MAX, effectiveCrmPicklist } from '@aglyn/aglyn'
import {
  dealContactRoleAddProblem,
  dealContactRolesAdded,
  dealContactRolesSave,
  dealContactRolesWithRole,
} from './deal-contact-roles'

/*
 * The deal page's Contact roles card (AGL-3521): each edit as a list, and
 * one save as the fields it writes — the Primary always `contactId`.
 */
describe('the contact roles card', () => {
  const list = effectiveCrmPicklist('opportunityContactRole', undefined)
  const roles = [
    { contactId: 'c1', role: 'Decision Maker', primary: true },
    { contactId: 'c2', primary: false },
  ]

  it('refuses a contact already on the deal, nobody, and one past the cap', () => {
    expect(dealContactRoleAddProblem(roles, '')).toBe('Pick a contact.')
    expect(dealContactRoleAddProblem(roles, 'c2')).toBe('That contact is already on this deal.')
    expect(dealContactRoleAddProblem(roles, 'c3')).toBeNull()
    const full = Array.from({ length: DEAL_CONTACT_ROLES_MAX }, (_, at) => ({ contactId: `x${at}`, primary: false }))
    expect(dealContactRoleAddProblem(full, 'c3')).toMatch(/at most 50/)
  })

  it('adds a contact, taking the Primary when asked', () => {
    expect(dealContactRolesAdded(roles, { contactId: 'c3', role: 'Evaluator', primary: false })).toEqual([
      ...roles,
      { contactId: 'c3', role: 'Evaluator', primary: false },
    ])
    expect(dealContactRolesAdded(roles, { contactId: 'c3', primary: true }).map((row) => row.primary)).toEqual([
      false,
      false,
      true,
    ])
  })

  it('sets and clears one contact’s role', () => {
    expect(dealContactRolesWithRole(roles, 'c2', 'Influencer')[1]).toEqual({
      contactId: 'c2',
      role: 'Influencer',
      primary: false,
    })
    expect(dealContactRolesWithRole(roles, 'c1', '')[0]).toEqual({ contactId: 'c1', primary: true })
  })

  it('saves the judged list with its Primary as contactId, and says when the Primary moved', () => {
    const deal = { contactId: 'c1', contactRoles: roles }
    expect(dealContactRolesSave(deal, dealContactRolesWithRole(roles, 'c2', 'evaluator'), list)).toEqual({
      ok: true,
      contactRoles: [
        { contactId: 'c1', role: 'Decision Maker', primary: true },
        { contactId: 'c2', role: 'Evaluator', primary: false },
      ],
      contactId: 'c1',
      primaryChanged: false,
    })
    expect(dealContactRolesSave(deal, [roles[1]], list)).toMatchObject({ contactId: null, primaryChanged: true })
    expect(dealContactRolesSave(deal, dealContactRolesWithRole(roles, 'c2', 'Coach'), list)).toMatchObject({
      ok: false,
    })
  })
})
