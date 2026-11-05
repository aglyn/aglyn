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

import type { AglynOrgMember } from '../foundation'
import {
  deleteBeyondReach,
  deleteBeyondReachRefusal,
  oneSitePlacement,
  placementVerdict,
  stampedPlacementKey,
} from './site-placement'

/**
 * A resource placed on one site answers to that site (AGL-4047). The dataset
 * table (`dataset-access-table.spec.ts`, beside the plugin's keys) walks every
 * member kind through all of this; these are the seam's own edges.
 */

const PRESET = { admin: true, editor: true, author: false, viewer: false } as const
const member = (shape: Record<string, unknown>) => shape as Partial<AglynOrgMember>
/** Shared with all sites except b, and a is the only site left that it reaches. */
const DOWN_TO_ONE = { visibleTo: ['host:a'], scopeMode: 'allExcept', scopeExcept: ['host:b'] }

describe('oneSitePlacement', () => {
  it.each([
    [['host:a'], 'a'],
    [['org'], null],
    [['host:a', 'host:b'], null],
    [['host:a:b'], null],
    [['host:a/b'], null],
    [[], null],
    [undefined, null],
    ['host:a', null],
    [[1], null],
  ])('%j → %j', (visibleTo, site) => {
    expect(oneSitePlacement({ visibleTo })).toBe(site)
  })

  it('answers nothing for a document shared with all sites except some, however few it reaches', () => {
    expect(oneSitePlacement(DOWN_TO_ONE)).toBeNull()
  })

  it('reads either key present as marked, as the rule does, so damage fails closed', () => {
    expect(oneSitePlacement({ visibleTo: ['host:a'], scopeMode: null })).toBeNull()
    expect(oneSitePlacement({ visibleTo: ['host:a'], scopeExcept: null })).toBeNull()
    expect(oneSitePlacement({ visibleTo: ['host:a'], scopeMode: 'allExcept' })).toBeNull()
    expect(oneSitePlacement({ visibleTo: ['host:a'], scopeExcept: ['host:b'] })).toBeNull()
  })

  it('answers nothing for no document at all', () => {
    expect(oneSitePlacement(undefined)).toBeNull()
    expect(oneSitePlacement(null)).toBeNull()
  })
})

describe('placementVerdict', () => {
  const site = jest.fn((_hostId: string) => true)
  beforeEach(() => site.mockClear())
  const editor = member({ role: 'editor', allHosts: true })
  const narrowed = member({ role: 'editor', allHosts: true, hostAccess: { a: 'viewer' } })

  it('asks the workspace key alone on every site or several, and never the site', () => {
    expect(placementVerdict({ member: editor, placed: { visibleTo: ['org'] }, workspace: true, site })).toBe(true)
    expect(placementVerdict({ member: editor, placed: { visibleTo: ['host:a', 'host:b'] }, workspace: false, site })).toBe(false)
    expect(site).not.toHaveBeenCalled()
  })

  it('reads no site for a holder the site does not narrow', () => {
    expect(placementVerdict({ member: editor, placed: { visibleTo: ['host:a'] }, workspace: true, site })).toBe(true)
    expect(site).not.toHaveBeenCalled()
  })

  it('asks the site for a holder it narrows, and for a member without the key', () => {
    expect(placementVerdict({ member: narrowed, placed: { visibleTo: ['host:a'] }, workspace: true, site })).toBe(true)
    expect(placementVerdict({ member: member({ role: 'viewer' }), placed: { visibleTo: ['host:a'] }, workspace: false, site })).toBe(true)
    expect(site).toHaveBeenCalledTimes(2)
    expect(site).toHaveBeenLastCalledWith('a')
  })

  it('never asks the site about a marked document: a holder keeps it, a site Admin doesn’t gain it', () => {
    expect(placementVerdict({ member: narrowed, placed: DOWN_TO_ONE, workspace: true, site })).toBe(true)
    expect(placementVerdict({ member: member({ role: 'viewer' }), placed: DOWN_TO_ONE, workspace: false, site })).toBe(false)
    expect(site).not.toHaveBeenCalled()
  })

  it('a site that narrows them elsewhere is no concern here', () => {
    expect(placementVerdict({ member: narrowed, placed: { visibleTo: ['host:b'] }, workspace: true, site })).toBe(true)
    expect(site).not.toHaveBeenCalled()
  })
})

describe('stampedPlacementKey', () => {
  const say = (stamps: Record<string, unknown>, shape: Record<string, unknown> = {}) =>
    stampedPlacementKey(stamps, 'u', 'k', PRESET, shape as never, 'w')

  it('takes the stamp whichever way it says', () => {
    expect(say({ memberPermissions: { u: { k: true } }, memberRoles: { u: 'viewer' } })).toBe(true)
    expect(say({ memberPermissions: { u: { k: false } }, memberRoles: { u: 'admin' } })).toBe(false)
  })

  it('falls to the site role’s preset where the projection has not reached', () => {
    expect(say({ memberRoles: { u: 'editor' } })).toBe(true)
    expect(say({ memberRoles: { u: 'author' } })).toBe(false)
    expect(say({ memberRoles: {} })).toBe(false)
  })

  it('never hands the preset to someone a decision stands against', () => {
    expect(say({ memberRoles: { u: 'admin' } }, { permissions: { w: false } })).toBe(false)
    expect(say({ memberRoles: { u: 'admin' } }, { roleId: 'r' })).toBe(false)
  })
})

describe('deleteBeyondReach', () => {
  const siteOnly = member({ role: 'editor', allHosts: false, hostAccess: { a: 'editor' } })
  const whole = member({ role: 'editor', allHosts: true })

  it('holds a member who reaches only some sites to one site', () => {
    expect(deleteBeyondReach(siteOnly, { visibleTo: ['org'] })).toBe(true)
    expect(deleteBeyondReach(siteOnly, { visibleTo: ['host:a', 'host:b'] })).toBe(true)
    expect(deleteBeyondReach(siteOnly, undefined)).toBe(true)
    expect(deleteBeyondReach(siteOnly, { visibleTo: ['host:a'] })).toBe(false)
  })

  it('counts a marked document as shared beyond one site, though it names only theirs', () => {
    expect(deleteBeyondReach(siteOnly, DOWN_TO_ONE)).toBe(true)
  })

  it('leaves a member of the whole workspace alone', () => {
    expect(deleteBeyondReach(whole, { visibleTo: ['org'] })).toBe(false)
    expect(deleteBeyondReach(whole, DOWN_TO_ONE)).toBe(false)
  })

  it('names the reach it takes, in the kind’s own word', () => {
    expect(deleteBeyondReachRefusal('Dataset')).toBe(
      'This dataset is shared beyond one site, so deleting it takes access to every site in the workspace.',
    )
  })
})
