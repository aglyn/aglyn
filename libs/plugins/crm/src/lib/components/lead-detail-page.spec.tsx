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
 * THE LEAD'S PAGE AT BOTH LEVELS (AGL-3278).
 *
 * `/[orgSlug]/crm/leads/{leadId}` is handed no site — AGL-3275 took the
 * site out of the address — and the page resolved its org from that absent
 * site, which settles at `orgId: null`. A null org builds no reference,
 * opens no listener, and leaves the page on "Loading…" for as long as
 * anybody is willing to look at it. Three contracts:
 *
 *  1. AT THE ORGANIZATION LEVEL the page reads `orgs/{orgId}/leads/{id}`,
 *     resolving the org from the hub's mount, and renders the record.
 *  2. THE SITE-DEPENDENT SURFACES are handed the lead's own first capturing
 *     site — the conversion, the activity feed, the consent basis — because
 *     each of them is one site's to answer and the mount names none. The
 *     campaigns are not one of them: a lead is the org's record, and at the
 *     org level it is offered every campaign in the org.
 *  3. A SETTLED LOOKUP WITH NO ORG says so, rather than spinning.
 *
 * The scope hook is REAL: it is the thing under test. What is doubled is
 * Firestore, which records the path, and the cards, which record the site.
 */

import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { CrmOrgMountProvider } from '../hooks/use-crm-org-mount'
import { LeadDetailPage } from './lead-detail-page'

/** The document the listener answers with, or `null` for "no such lead". */
let leadDoc: Record<string, unknown> | null = null
/** Every document path the page asked Firestore for. */
const paths: string[] = []
/** The props each stubbed card was rendered with, by card. */
const rendered: Record<string, Record<string, unknown>> = {}
/** What the org lookup answers for a SITE — the org level never asks it. */
let orgForHost: string | null = 'org-1'

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useFirestoreDoc: (factory: () => unknown) => {
    // CALLED, not ignored: the whole defect is which reference the factory
    // builds, and a double that drops it on the floor cannot see one.
    const ref = factory()
    return {
      data: ref ? leadDoc : null,
      status: ref ? (leadDoc ? 'success' : 'loading') : 'loading',
      fromCache: false,
    }
  },
  // Which campaign list the page enabled: a site's, or the org's.
  useHostCampaigns: (hostId: string | undefined, options?: { enabled?: boolean }) => {
    if (options?.enabled) rendered['campaigns'] = { level: 'site', hostId: hostId ?? null }
    return { options: [], ready: true, truncated: false }
  },
  useOrgCampaigns: (orgId: string | null | undefined, options?: { enabled?: boolean }) => {
    if (options?.enabled) rendered['campaigns'] = { level: 'org', orgId: orgId ?? null }
    return { options: [], ready: true, truncated: false }
  },
  useOrgDataScope: (options: { hostId?: string; orgId?: string }) => {
    const orgId = options.orgId ?? (options.hostId ? orgForHost : null)
    return { orgId, ready: true, scope: orgId ? (['orgs', orgId] as const) : null }
  },
}))
jest.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...segments: string[]) => {
    paths.push(segments.join('/'))
    return { path: segments.join('/') }
  },
}))

jest.mock('./crm-record-header', () => ({
  CrmRecordHeader: (props: { loading?: boolean; children?: ReactNode }) => (
    <div>
      {props.loading ? 'Loading…' : null}
      {props.children}
    </div>
  ),
  CrmRecordChip: () => null,
}))
jest.mock('./lead-properties-card', () => ({
  LeadPropertiesCard: (props: Record<string, unknown>) => {
    rendered['properties'] = props
    return <h1>{String((props['lead'] as Record<string, unknown>)['email'])}</h1>
  },
}))
jest.mock('./crm-record-insights-zone', () => ({
  CrmRecordInsightsZone: (props: Record<string, unknown>) => {
    rendered['insights'] = props
    return null
  },
}))
jest.mock('./lead-campaigns-card', () => ({
  LeadCampaignsCard: (props: Record<string, unknown>) => {
    rendered['campaignsCard'] = props
    return null
  },
  leadCampaignNames: () => [],
}))
jest.mock('./lead-history-card', () => ({
  LeadHistoryCard: (props: Record<string, unknown>) => {
    rendered['history'] = props
    return null
  },
}))
jest.mock('./record-activity-card', () => ({
  RecordActivityCard: (props: Record<string, unknown>) => {
    rendered['activity'] = props
    return null
  },
}))
jest.mock('./lead-convert-dialog', () => ({
  LeadConvertDialog: (props: Record<string, unknown>) => {
    rendered['convert'] = props
    return null
  },
}))
jest.mock('./lead-unqualify-dialog', () => ({
  LeadUnqualifyDialog: (props: Record<string, unknown>) => {
    rendered['unqualify'] = props
    return null
  },
}))
jest.mock('./erase-person-action', () => ({
  useErasePersonAction: (input: Record<string, unknown>) => {
    rendered['erase'] = input
    return { menuItems: [], banner: null, dialog: null, pendingSinceMs: null }
  },
}))
jest.mock('../hooks/use-org-member-options', () => ({
  useOrgMemberOptions: () => ({
    options: [],
    labelFor: () => '',
    emailFor: () => '',
    ready: true,
    loading: false,
    error: null,
  }),
}))
jest.mock('../hooks/use-campaign-filing-log', () => ({
  useCampaignFilingLog: () => jest.fn(),
}))

/** The org's two brands, declared as one consent group. */
const ORG = {
  consentGroups: {
    'group-1': { name: 'Wellbiz', hostIds: ['site-2', 'site-3'] },
  },
}

/** The hub's organization-level mount, as the CRM page publishes it. */
const MOUNT = {
  orgId: 'org-1',
  orgSlug: 'acme',
  hosts: [
    { id: 'site-2', name: 'Second', subdomain: 'second' },
    { id: 'site-3', name: 'Third', subdomain: 'third' },
  ],
  hostsReady: true,
  hostsPath: '/acme/hosts',
}

function renderAtOrg() {
  return render(
    <CrmOrgMountProvider mount={MOUNT as never}>
      <LeadDetailPage
        id="person-key"
        hostId={undefined as never}
        org={ORG as never}
        basePath="/acme/crm"
        permissions={{} as never}
        releaseFlag={{} as never}
        hostRole={undefined}
      />
    </CrmOrgMountProvider>,
  )
}

beforeEach(() => {
  paths.length = 0
  for (const key of Object.keys(rendered)) delete rendered[key]
  orgForHost = 'org-1'
  leadDoc = {
    email: 'jane@example.com',
    name: 'Jane Doe',
    capturedByHostIds: ['site-3', 'site-2'],
  }
})

describe('the lead page at the organization level', () => {
  it('reads the lead from the ORG collection, resolving the org from the mount', () => {
    renderAtOrg()

    expect(paths).toEqual(['orgs/org-1/leads/person-key'])
    expect(screen.getByRole('heading', { name: 'jane@example.com' })).toBeTruthy()
    expect(screen.queryByText('Loading…')).toBeNull()
  })

  it('acts as the site that CAPTURED the lead, since the mount names none', () => {
    renderAtOrg()

    // First in capture order, not sorted: the site that met the person first.
    expect(rendered['properties']?.['hostId']).toBe('site-3')
    expect(rendered['convert']?.['hostId']).toBe('site-3')
    expect(rendered['activity']?.['hostId']).toBe('site-3')
    expect(rendered['history']?.['hostId']).toBe('site-3')
    expect(rendered['erase']?.['hostId']).toBe('site-3')
  })

  it("offers the org's campaigns, not the capturing site's", () => {
    renderAtOrg()

    expect(rendered['campaigns']).toEqual({ level: 'org', orgId: 'org-1' })
  })

  it('reads the consent basis against the whole DECLARED group, not that site alone', () => {
    renderAtOrg()

    // A refusal recorded for the brand beside this one stands against it,
    // which a group of one cannot see.
    expect(rendered['properties']?.['consentGroup']).toMatchObject({
      hostId: 'site-3',
      groupId: 'group-1',
      hostIds: ['site-2', 'site-3'],
      declared: true,
    })
  })

  it('says a lead nobody captured has no site, rather than inventing one', () => {
    leadDoc = { email: 'orphan@example.com', name: 'No Site' }
    renderAtOrg()

    expect(rendered['properties']?.['hostId']).toBeNull()
    expect(rendered['convert']?.['hostId']).toBeNull()
  })
})

describe('the lead page under a site', () => {
  function renderAtSite() {
    return render(
      <LeadDetailPage
        id="person-key"
        hostId="site-2"
        org={ORG as never}
        basePath="/acme/hosts/second/crm"
        permissions={{} as never}
        releaseFlag={{} as never}
        hostRole={undefined}
      />,
    )
  }

  it('reads the same org row, and acts as the MOUNTED site', () => {
    renderAtSite()

    expect(paths).toEqual(['orgs/org-1/leads/person-key'])
    expect(rendered['properties']?.['hostId']).toBe('site-2')
    expect(rendered['convert']?.['hostId']).toBe('site-2')
    expect(rendered['campaigns']).toEqual({ level: 'site', hostId: 'site-2' })
  })

  it('says so when the lookup settles with no org, rather than loading forever', () => {
    orgForHost = null
    renderAtSite()

    expect(paths).toEqual([])
    expect(screen.getByText('This lead could not be read.')).toBeTruthy()
    expect(screen.queryByText('Loading…')).toBeNull()
  })
})
