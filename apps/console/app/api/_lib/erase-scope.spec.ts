/**
 * @jest-environment node
 */

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

import type { AglynOrgMember } from '@aglyn/aglyn/server'
import { eraseScopeDenial } from './erase-scope'

const member = (m: Partial<AglynOrgMember>) => m

const OWNER = member({ role: 'owner', allHosts: true })
const ORG_EDITOR = member({ role: 'editor', allHosts: true })
/** A site collaborator: an org member doc scoped to one host (AGL-1026). */
const COLLABORATOR = member({
  role: 'editor',
  allHosts: false,
  scopeTokens: ['host:client-1'],
})
/** Predates AGL-1038 — no projection, no hostAccess. Keeps full access. */
const LEGACY = member({ role: 'editor' })

const base = { label: 'Dataset', exists: true }

/*
 * A site-only holder of "Delete workspace records" (AGL-4047). Their real tokens,
 * `['org', 'host:x']`, reach whatever the workspace shares, and `hostId` is a hint.
 * Measured on the code before this: with no hint both shared placements answered
 * null, and the route deleted the dataset and every record under it.
 */
const SITE_ONLY_HOLDER = member({
  role: 'viewer',
  allHosts: false,
  hostAccess: { 'client-1': 'editor' },
  scopeTokens: ['org', 'host:client-1'],
})
const SHARED_REFUSAL = 'This dataset is shared beyond one site, so deleting it takes access to every site in the workspace.'

describe('what the workspace shares is the workspace’s to delete (AGL-4047)', () => {
  it.each([
    ['every site', ['org']],
    ['several sites', ['host:client-1', 'host:client-2']],
  ])('%s: refused with no hint, and with one', (_placement, visibleTo) => {
    const refused = { error: SHARED_REFUSAL, status: 403 }
    expect(eraseScopeDenial({ ...base, target: { visibleTo }, member: SITE_ONLY_HOLDER, protectsShared: true })).toEqual(refused)
    expect(eraseScopeDenial({ ...base, target: { visibleTo }, member: SITE_ONLY_HOLDER, protectsShared: true, fromHostId: 'client-1' })).toEqual(refused)
  })

  it('leaves a dataset placed on their own site to them', () => {
    expect(eraseScopeDenial({ ...base, target: { visibleTo: ['host:client-1'] }, member: SITE_ONLY_HOLDER, protectsShared: true })).toBeNull()
  })

  it('still answers 404 on one they cannot see', () => {
    expect(eraseScopeDenial({ ...base, target: { visibleTo: ['host:other'] }, member: SITE_ONLY_HOLDER, protectsShared: true })?.status).toBe(404)
  })

  it('leaves a member of the whole workspace as they were', () => {
    expect(eraseScopeDenial({ ...base, target: { visibleTo: ['org'] }, member: ORG_EDITOR, protectsShared: true })).toBeNull()
    expect(eraseScopeDenial({ ...base, target: { visibleTo: ['host:a', 'host:b'] }, member: OWNER, protectsShared: true })).toBeNull()
  })

  it('touches no other kind', () => {
    expect(eraseScopeDenial({ label: 'List', exists: true, target: { visibleTo: ['org'] }, member: SITE_ONLY_HOLDER })).toBeNull()
  })
})

describe('eraseScopeDenial (AGL-1046)', () => {
  describe('the boundary', () => {
    it('stops a collaborator erasing a dataset they cannot even read', () => {
      // The finding this function exists for: `ORG_WRITER_ROLES` admits a
      // site collaborator, so before this the route would recursiveDelete
      // the agency's internal dataset on request.
      const denial = eraseScopeDenial({
        ...base,
        target: { visibleTo: ['host:internal-1'] },
        member: COLLABORATOR,
      })
      expect(denial?.status).toBe(404)
    })

    it('reports 404, not 403 — a denial must not confirm the id exists', () => {
      const hidden = eraseScopeDenial({
        ...base,
        target: { visibleTo: ['host:internal-1'] },
        member: COLLABORATOR,
      })
      const missing = eraseScopeDenial({
        ...base,
        exists: false,
        target: { visibleTo: undefined },
        member: COLLABORATOR,
      })
      // Indistinguishable to the caller: one denies, one is a no-op that
      // the route follows with its own not-found handling.
      expect(hidden?.error).toBe('Dataset not found')
      expect(missing).toBeNull()
    })

    it('lets a collaborator erase their own site-private dataset', () => {
      expect(
        eraseScopeDenial({
          ...base,
          target: { visibleTo: ['host:client-1'] },
          member: COLLABORATOR,
          fromHostId: 'client-1',
        }),
      ).toBeNull()
    })

    it('does not restrict org-wide members', () => {
      for (const member of [OWNER, ORG_EDITOR, LEGACY]) {
        expect(
          eraseScopeDenial({ ...base, target: { visibleTo: ['host:internal-1'] }, member }),
        ).toBeNull()
      }
    })

    /**
     * A document carrying NO scope is seen by nobody, so a scoped
     * collaborator is answered 404 — the same answer a resource in another
     * site's scope gets, and for the same reason: learning that it EXISTS is
     * the leak. Failing closed here deletes nothing rather than exposing a
     * resource whose sharing nobody ever chose.
     */
    it('treats a missing visibleTo as visible to nobody, and says only "not found"', () => {
      expect(
        eraseScopeDenial({ ...base, target: { visibleTo: undefined }, member: COLLABORATOR }),
      ).toMatchObject({ status: 404 })
      // ANTI-VACUITY: a scope the collaborator holds is still admitted, so
      // this is the absent field being refused and not the rail refusing
      // everything.
      expect(
        eraseScopeDenial({
          ...base,
          target: { visibleTo: ['host:client-1'] },
          member: COLLABORATOR,
        }),
      ).toBeNull()
    })
  })

  describe('the shared-resource rail', () => {
    it('refuses to destroy an org-wide dataset from a site page', () => {
      const denial = eraseScopeDenial({
        ...base,
        target: { visibleTo: ['org'] },
        member: OWNER,
        fromHostId: 'client-1',
      })
      expect(denial?.status).toBe(409)
      expect(denial?.error).toContain('every site in the workspace')
    })

    it('refuses to destroy a multi-host dataset from one of those hosts', () => {
      const denial = eraseScopeDenial({
        ...base,
        target: { visibleTo: ['host:internal-1', 'host:internal-2', 'host:internal-3'] },
        member: OWNER,
        fromHostId: 'internal-1',
      })
      expect(denial?.status).toBe(409)
      expect(denial?.error).toContain('3 sites')
    })

    it('allows the same delete from the workspace page, which sends no host', () => {
      expect(
        eraseScopeDenial({ ...base, target: { visibleTo: ['org'] }, member: OWNER }),
      ).toBeNull()
    })

    it('applies the rail to a legacy doc with no scope at all', () => {
      // Absent reads as org-wide everywhere else in this model; a site
      // page must not be the one place it reads as "mine to delete".
      const denial = eraseScopeDenial({
        ...base,
        target: { visibleTo: undefined },
        member: OWNER,
        fromHostId: 'client-1',
      })
      expect(denial?.status).toBe(409)
    })

    it('is not fooled by a scope that merely includes this host', () => {
      const denial = eraseScopeDenial({
        ...base,
        target: { visibleTo: ['host:client-1', 'host:client-2'] },
        member: OWNER,
        fromHostId: 'client-1',
      })
      expect(denial?.status).toBe(409)
    })
  })

  it('uses the resource label in the message', () => {
    const denial = eraseScopeDenial({
      ...base,
      label: 'List',
      target: { visibleTo: ['org'] },
      member: OWNER,
      fromHostId: 'client-1',
    })
    expect(denial?.error).toContain('This list is shared')
  })
})

/**
 * A dataset shared with all sites except some is the workspace's however few sites
 * it reaches today (AGL-4047). Read as a one-site dataset, the delete of its last
 * included site's page would be admitted, and a site-only member would delete what
 * the whole workspace shares.
 */
describe('a document shared with all sites except some', () => {
  const DOWN_TO_ONE = { visibleTo: ['host:client-1'], scopeMode: 'allExcept', scopeExcept: ['host:client-2'] }

  it('a site-only holder cannot delete it, with or without the hint, though it names only their site', () => {
    const refused = { status: 403, error: expect.stringContaining('shared beyond one site') }
    expect(eraseScopeDenial({ ...base, target: DOWN_TO_ONE, member: SITE_ONLY_HOLDER, protectsShared: true })).toEqual(refused)
    expect(
      eraseScopeDenial({ ...base, target: DOWN_TO_ONE, member: SITE_ONLY_HOLDER, protectsShared: true, fromHostId: 'client-1' }),
    ).toEqual(refused)
  })

  it('THE CONTROL: the same member deletes the same list when it has no marker', () => {
    expect(
      eraseScopeDenial({ ...base, target: { visibleTo: ['host:client-1'] }, member: SITE_ONLY_HOLDER, protectsShared: true, fromHostId: 'client-1' }),
    ).toBeNull()
  })

  it('a stored null or half a marker fails closed, as the rule does', () => {
    for (const target of [
      { visibleTo: ['host:client-1'], scopeMode: null },
      { visibleTo: ['host:client-1'], scopeExcept: ['host:client-2'] },
    ]) {
      expect(eraseScopeDenial({ ...base, target, member: SITE_ONLY_HOLDER, protectsShared: true })?.status).toBe(403)
    }
  })

  it('from its last site’s own page, a member of the whole workspace is sent to the workspace page', () => {
    const denial = eraseScopeDenial({ ...base, target: DOWN_TO_ONE, member: OWNER, fromHostId: 'client-1' })
    expect(denial?.status).toBe(409)
    expect(denial?.error).toContain('all sites except some')
    expect(denial?.error).toContain('workspace Data page')
  })

  it('from the workspace page, that member deletes it', () => {
    expect(eraseScopeDenial({ ...base, target: DOWN_TO_ONE, member: OWNER })).toBeNull()
  })

  it('a member it hides from gets the same 404 as ever', () => {
    expect(
      eraseScopeDenial({ ...base, target: { ...DOWN_TO_ONE, visibleTo: ['host:internal-1'] }, member: COLLABORATOR })?.status,
    ).toBe(404)
  })
})
