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

describe('eraseScopeDenial (AGL-1046)', () => {
  describe('the boundary', () => {
    it('stops a collaborator erasing a dataset they cannot even read', () => {
      // The finding this function exists for: `ORG_WRITER_ROLES` admits a
      // site collaborator, so before this the route would recursiveDelete
      // the agency's internal dataset on request.
      const denial = eraseScopeDenial({
        ...base,
        visibleTo: ['host:internal-1'],
        member: COLLABORATOR,
      })
      expect(denial?.status).toBe(404)
    })

    it('reports 404, not 403 — a denial must not confirm the id exists', () => {
      const hidden = eraseScopeDenial({
        ...base,
        visibleTo: ['host:internal-1'],
        member: COLLABORATOR,
      })
      const missing = eraseScopeDenial({
        ...base,
        exists: false,
        visibleTo: undefined,
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
          visibleTo: ['host:client-1'],
          member: COLLABORATOR,
          fromHostId: 'client-1',
        }),
      ).toBeNull()
    })

    it('does not restrict org-wide members', () => {
      for (const member of [OWNER, ORG_EDITOR, LEGACY]) {
        expect(
          eraseScopeDenial({ ...base, visibleTo: ['host:internal-1'], member }),
        ).toBeNull()
      }
    })

    it('treats a missing visibleTo as org-wide, not as denied', () => {
      // Fail-closed here would delete nothing rather than leak, but it
      // would also break every pre-backfill doc for a scoped member.
      expect(
        eraseScopeDenial({ ...base, visibleTo: undefined, member: COLLABORATOR }),
      ).toBeNull()
    })
  })

  describe('the shared-resource rail', () => {
    it('refuses to destroy an org-wide dataset from a site page', () => {
      const denial = eraseScopeDenial({
        ...base,
        visibleTo: ['org'],
        member: OWNER,
        fromHostId: 'client-1',
      })
      expect(denial?.status).toBe(409)
      expect(denial?.error).toContain('every site in the workspace')
    })

    it('refuses to destroy a multi-host dataset from one of those hosts', () => {
      const denial = eraseScopeDenial({
        ...base,
        visibleTo: ['host:internal-1', 'host:internal-2', 'host:internal-3'],
        member: OWNER,
        fromHostId: 'internal-1',
      })
      expect(denial?.status).toBe(409)
      expect(denial?.error).toContain('3 sites')
    })

    it('allows the same delete from the workspace page, which sends no host', () => {
      expect(
        eraseScopeDenial({ ...base, visibleTo: ['org'], member: OWNER }),
      ).toBeNull()
    })

    it('applies the rail to a legacy doc with no scope at all', () => {
      // Absent reads as org-wide everywhere else in this model; a site
      // page must not be the one place it reads as "mine to delete".
      const denial = eraseScopeDenial({
        ...base,
        visibleTo: undefined,
        member: OWNER,
        fromHostId: 'client-1',
      })
      expect(denial?.status).toBe(409)
    })

    it('is not fooled by a scope that merely includes this host', () => {
      const denial = eraseScopeDenial({
        ...base,
        visibleTo: ['host:client-1', 'host:client-2'],
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
      visibleTo: ['org'],
      member: OWNER,
      fromHostId: 'client-1',
    })
    expect(denial?.error).toContain('This list is shared')
  })
})
