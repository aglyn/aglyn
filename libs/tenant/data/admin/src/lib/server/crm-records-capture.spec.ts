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
 * The capture rule both capture doors share (AGL-4227): on a plan that sells
 * no CRM records past its band (Free), contacts, companies, deals AND filed
 * leads share the one band, so leads stop piling up uncounted beside it.
 * Paid plans get the by-hand verdict unchanged.
 */

import { crmCaptureAdmitted } from './crm-records'

function orgRefWith(counts: Record<string, number>) {
  const collection = (name: string) => ({
    count: () => ({ get: async () => ({ data: () => ({ count: counts[name] ?? 0 }) }) }),
  })
  return { collection } as unknown as FirebaseFirestore.DocumentReference
}

const FREE = { plan: 'free' } as never
const STARTER = { plan: 'starter', billingStatus: 'active' } as never

describe('one band for every person a capture keeps (AGL-4227)', () => {
  it('Free admits a new person while contacts and leads together are under 100', async () => {
    await expect(crmCaptureAdmitted(FREE, orgRefWith({ contacts: 40, leads: 59 }))).resolves.toBe(true)
  })

  it('Free refuses the 101st person when leads fill the band, though contacts alone would not', async () => {
    await expect(crmCaptureAdmitted(FREE, orgRefWith({ contacts: 40, leads: 60 }))).resolves.toBe(false)
  })

  it('Free refuses past the band on records alone, as the by-hand path does', async () => {
    await expect(crmCaptureAdmitted(FREE, orgRefWith({ contacts: 60, companies: 30, deals: 10 }))).resolves.toBe(false)
  })

  it('a workspace already above the band keeps what it has and simply gains no one', async () => {
    await expect(crmCaptureAdmitted(FREE, orgRefWith({ contacts: 20, leads: 4_000 }))).resolves.toBe(false)
  })

  it('a paid plan meters past its band and leads never count: Starter only stops at its ceiling', async () => {
    await expect(crmCaptureAdmitted(STARTER, orgRefWith({ contacts: 5_000, leads: 50_000 }))).resolves.toBe(true)
    await expect(crmCaptureAdmitted(STARTER, orgRefWith({ contacts: 10_000 }))).resolves.toBe(false)
  })
})
