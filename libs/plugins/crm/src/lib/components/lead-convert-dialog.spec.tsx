/**
 * @license
 * Copyright 2023 Aglyn LLC
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
 * The convert dialog's read scope (AGL-2641).
 *
 * Two contracts:
 *
 *  1. MOUNTED CLOSED WITH NO SITE — how the organization-level Leads list
 *     holds it until a row is picked — the dialog renders nothing and reads
 *     nothing. A consent group must name a site, and the dialog has none yet.
 *  2. OPEN UNDER A SITE its company and pipeline reads carry the org token
 *     and the site's own — the consent group's scope, the same tokens every
 *     CRM listener filters on.
 */

import { ORG_SCOPE_TOKEN, hostScopeToken } from '@aglyn/aglyn'
import { render } from '@testing-library/react'
import { LeadConvertDialog } from './lead-convert-dialog'

/** Every `where` clause the dialog's reads were built with. */
const wheres: Array<unknown[]> = []

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useUser: () => ({ data: { uid: 'u-1' } }),
  // The hook runs the factory the way the real one does, so a read that
  // opens shows up as its `where` clauses and a closed one as nothing.
  useFirestoreCollection: (factory: () => unknown) => {
    factory()
    return { data: [], status: 'success', fromCache: false }
  },
}))
jest.mock('firebase/firestore', () => ({
  collection: () => ({}),
  documentId: () => ({}),
  limit: () => ({}),
  orderBy: () => ({}),
  query: () => ({}),
  where: (...args: unknown[]) => {
    wheres.push(args)
    return {}
  },
}))
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: jest.fn(),
}))
jest.mock('./lead-owner-select', () => ({
  LeadOwnerSelect: () => null,
}))

const roster = { options: [], loading: false } as never

function mountDialog(props: { open: boolean; hostId: string }) {
  return render(
    <LeadConvertDialog
      open={props.open}
      onClose={jest.fn()}
      hostId={props.hostId}
      orgId="org-1"
      org={{}}
      leadId="lead-1"
      lead={{ email: 'owen@example.com', name: 'Owen' }}
      basePath="/acme/crm"
      roster={roster}
    />,
  )
}

beforeEach(() => {
  wheres.length = 0
})

describe('the convert dialog’s read scope (AGL-2641)', () => {
  it('mounted closed with no site, it renders nothing and reads nothing', () => {
    const { container } = mountDialog({ open: false, hostId: '' })
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(wheres).toEqual([])
  })

  it('open under a site, its reads carry the org token and the site’s own', () => {
    mountDialog({ open: true, hostId: 'demo' })
    // The companies and the pipelines, rebuilt on every render the open
    // dialog makes — however many, each carries the same scope.
    const scopes = wheres.filter(([field]) => field === 'visibleTo')
    expect(scopes.length).toBeGreaterThan(0)
    for (const [, operator, tokens] of scopes) {
      expect(operator).toBe('array-contains-any')
      expect(tokens).toEqual([ORG_SCOPE_TOKEN, hostScopeToken('demo')])
    }
  })
})
