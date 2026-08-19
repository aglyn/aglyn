/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored (feedback_jest_environment_pragma_shadowed_by_license).
 *
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
 * WHAT THE REPORTER TYPED IS WHAT GETS STORED (AGL-2310).
 *
 * `marketplaceReports` was written and read by nothing, so nothing could tell
 * whether the stored `reason` was the reporter's words either — a writer that
 * recorded a category, a truncation, or a constant would have looked exactly
 * like the working case for as long as no queue displayed it.
 *
 * Now that AGL-2310 puts the reason in front of a staff reviewer, it is the
 * whole content of the row. So this drives the REAL handler with two
 * different reports and demands the stored text move with the submission.
 *
 * The reader half — that the reason reaches the staff list, that a status
 * change is written back, that closing needs a note — lives in
 * `apps/console/specs/marketplace-reports-queue.spec.ts`. It cannot live here:
 * nx `depConstraints` forbid `scope:app` importing an `aglyn:addons` lib, so
 * console and marketplace code cannot meet in one module.
 */

const mockStore: Record<string, Record<string, unknown>> = {}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: async () => ({ uid: 'user-7' }),
      }),
      firestore: () => ({
        collection: (name: string) => ({
          doc: (id: string) => ({
            get: async () => ({
              exists: name === 'marketplaceListings',
              get: (field: string) =>
                field === 'displayName'
                  ? 'Contact Form Pro'
                  : field === 'profileId'
                    ? 'org-9'
                    : undefined,
            }),
            set: async (
              data: Record<string, unknown>,
              options?: { merge?: boolean },
            ) => {
              const path = `${name}/${id}`
              mockStore[path] = options?.merge
                ? { ...(mockStore[path] ?? {}), ...data }
                : { ...data }
            },
          }),
        }),
      }),
    }),
    firestore: { FieldValue: { serverTimestamp: () => 'NOW' } },
  },
}))

import { reportHandler } from './report'

function makeRes() {
  const res: any = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code
      return res
    },
    json(payload: unknown) {
      res.body = payload
      return res
    },
  }
  return res
}

async function file(body: Record<string, unknown>) {
  const res = makeRes()
  await reportHandler(
    {
      method: 'POST',
      body,
      headers: { authorization: 'Bearer token' },
    } as any,
    res,
  )
  return res
}

const reports = () =>
  Object.entries(mockStore)
    .filter(([path]) => path.startsWith('marketplaceReports/'))
    .map(([, data]) => data)

beforeEach(() => {
  for (const key of Object.keys(mockStore)) delete mockStore[key]
})

describe('the stored report is the report that was filed', () => {
  it('records each reason VERBATIM, not a constant or a category', async () => {
    // Two reports on two different listings, with sentences that share no
    // words. A writer stamping a fixed string, or storing the listing name in
    // the reason's place, satisfies at most one of these.
    await file({
      listingId: 'listing-1',
      reason: 'The install steps tell you to paste your API key into their site.',
    })
    await file({
      listingId: 'listing-2',
      reason: 'Five near-identical listings from the same publisher.',
    })

    const stored = reports().map((row) => row['reason'])
    expect(stored).toContain(
      'The install steps tell you to paste your API key into their site.',
    )
    expect(stored).toContain(
      'Five near-identical listings from the same publisher.',
    )
  })

  it('opens the report and names the target, so the queue has a row to show', async () => {
    await file({ listingId: 'listing-1', reason: 'Impersonates our brand.' })
    expect(reports()[0]).toMatchObject({
      status: 'open',
      targetType: 'listing',
      listingId: 'listing-1',
      listingName: 'Contact Form Pro',
      publisherOrgId: 'org-9',
      // The VERIFIED token, never a client-supplied uid.
      reporterUid: 'user-7',
    })
  })

  it('marks a review report as a review, so the queue can tell them apart', async () => {
    await file({
      listingId: 'listing-1',
      reviewUid: 'user-3',
      reason: 'Review is an advert for a competitor.',
    })
    expect(reports()[0]).toMatchObject({
      targetType: 'review',
      reviewUid: 'user-3',
    })
  })

  it('UPDATES rather than stacks when the same person reports twice', async () => {
    // One account must not be able to make something look widely reported —
    // now visible on a staff queue, which is where an inflated count would do
    // its damage.
    await file({ listingId: 'listing-1', reason: 'First wording.' })
    await file({ listingId: 'listing-1', reason: 'Second, clearer wording.' })
    expect(reports()).toHaveLength(1)
    expect(reports()[0]['reason']).toBe('Second, clearer wording.')
  })

  it('refuses an empty reason — a row with nothing to read is not a report', async () => {
    const res = await file({ listingId: 'listing-1', reason: '   ' })
    expect(res.statusCode).toBe(400)
    expect(reports()).toHaveLength(0)
  })
})
