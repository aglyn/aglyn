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
 * WHICH SUBMISSIONS FILE A LEAD, BY PLAN (AGL-2790).
 *
 * On a plan without the CRM suite every live form is a lead surface, bound to
 * a form document or not; on a plan with it, only a form whose author
 * declared `routing.lead`. The plan is the EFFECTIVE one, so the cases below
 * include the two ways a stored plan name does not decide it: a per-org
 * entitlement override, and a paid plan whose subscription died.
 */

import { submissionFilesLead } from './form-lead-routing'

const UNROUTED = { routing: {} }
const ROUTED = { routing: { lead: true } }
const RETIRED = { routing: { lead: true }, archivedAt: 1_700_000_000_000 }

describe('submissionFilesLead on a plan without the CRM suite', () => {
  const free = { plan: 'free' } as const

  it('files a lead from a form whose author never turned routing on', () => {
    expect(submissionFilesLead({ form: UNROUTED, org: free })).toBe(true)
  })

  it('files a lead from a Form node with no form document', () => {
    expect(submissionFilesLead({ form: null, org: free })).toBe(true)
  })

  it('files a lead from a routed form too', () => {
    expect(submissionFilesLead({ form: ROUTED, org: free })).toBe(true)
  })

  it('reads an org with no plan, and no org at all, as Free', () => {
    expect(submissionFilesLead({ form: UNROUTED, org: {} })).toBe(true)
    expect(submissionFilesLead({ form: UNROUTED, org: null })).toBe(true)
  })

  it('reads a paid plan whose subscription died as a plan without the suite', () => {
    expect(
      submissionFilesLead({ form: UNROUTED, org: { plan: 'pro', billingStatus: 'canceled' } }),
    ).toBe(true)
  })

  it('files nothing from a retired form', () => {
    expect(submissionFilesLead({ form: RETIRED, org: free })).toBe(false)
  })
})

describe('submissionFilesLead on a plan with the CRM suite', () => {
  it.each(['starter', 'pro', 'business', 'agency'] as const)(
    'keeps per-form routing on %s',
    (plan) => {
      expect(submissionFilesLead({ form: UNROUTED, org: { plan } })).toBe(false)
      expect(submissionFilesLead({ form: null, org: { plan } })).toBe(false)
      expect(submissionFilesLead({ form: ROUTED, org: { plan } })).toBe(true)
    },
  )

  it('honors a per-org grant of the suite on Free', () => {
    const granted = { plan: 'free', entitlements: { features: { crm: true } } } as const
    expect(submissionFilesLead({ form: UNROUTED, org: granted })).toBe(false)
    expect(submissionFilesLead({ form: ROUTED, org: granted })).toBe(true)
  })

  it('files nothing from a retired form', () => {
    expect(submissionFilesLead({ form: RETIRED, org: { plan: 'business' } })).toBe(false)
  })
})
