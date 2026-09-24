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
 * THE SITE LISTS A SEQUENCE READS ARE ITS CONSENT GROUP'S (AGL-3310).
 *
 * A sequence mails as its site, and an org may declare several sites one
 * sender. Somebody who unsubscribed from a sibling — or left its sales
 * stream — left the sender this sequence mails as, so the site suppression
 * list and the sales opt-outs are read on every site of the group. The other
 * brands in the org keep their lists their own, and a site in no group reads
 * exactly its own.
 */

jest.mock('@aglyn/tenant-data-admin/server/crm-inbound-email', () => ({
  loadCrmInboundRoster: async () => [],
}))

import { personKey } from '@aglyn/aglyn/app-utils/person-key'
import { readOutreachGateLookups } from './gate-lookups'

const ORG = 'org-1'
/** The sequence's site. */
const SITE_A = 'site-a'
/** Declared one sender with site A. */
const SITE_B = 'site-b'
/** Another brand in the same org. */
const SITE_C = 'site-c'
const EMAIL = 'dana@example.com'
const KEY = personKey(EMAIL) as string

/** A store keyed by full document path; every query answers empty. */
function fakeFirestore(
  docs: Record<string, Record<string, unknown>>,
  options?: { failingSite?: string },
): any {
  const reads: string[] = []
  const snapshot = (path: string) => ({
    exists: path in docs,
    get: (field: string) => docs[path]?.[field],
  })
  const query = (): any => ({
    where: () => query(),
    limit: () => query(),
    get: async () => ({ docs: [], empty: true }),
  })
  const collectionRef = (path: string): any => ({
    doc: (id: string) => docRef(`${path}/${id}`),
    where: () => query(),
    limit: () => query(),
    get: async () => ({ docs: [], empty: true }),
  })
  const docRef = (path: string): any => ({
    path,
    get: async () => snapshot(path),
    set: async () => undefined,
    collection: (name: string) => collectionRef(`${path}/${name}`),
  })
  return {
    reads,
    collection: (name: string) => collectionRef(name),
    getAll: async (...refs: any[]) => {
      if (
        options?.failingSite &&
        refs.some((ref) => String(ref.path).includes(`hosts/${options.failingSite}/`))
      ) {
        throw new Error('sibling list unavailable')
      }
      for (const ref of refs) reads.push(String(ref.path))
      return refs.map((ref) => snapshot(String(ref.path)))
    },
  }
}

const person = { personId: 'contact-1', contactId: 'contact-1', leadId: null, email: EMAIL }

const lookup = (
  firestore: any,
  consentHostIds?: string[],
  consentAwaitsConfirmation?: boolean,
) =>
  readOutreachGateLookups(firestore, {
    orgId: ORG,
    hostId: SITE_A,
    ...(consentHostIds ? { consentHostIds } : {}),
    ...(consentAwaitsConfirmation === undefined ? {} : { consentAwaitsConfirmation }),
    gateway: { resolveMx: async () => [{ exchange: 'mx.example.com', priority: 10 }], nowMs: 0 },
    people: [person],
  }).then((answers) => answers.get(person.personId))

describe('the site lists a sequence reads', () => {
  it('holds somebody who unsubscribed from a site declared one sender with this one', async () => {
    const firestore = fakeFirestore({
      [`hosts/${SITE_B}/suppressions/${KEY}`]: { reason: 'unsubscribe' },
    })
    await expect(lookup(firestore, [SITE_A, SITE_B])).resolves.toMatchObject({
      hostSuppressed: true,
    })
  })

  it('reads a sales opt-out on the sibling as leaving this sender', async () => {
    const firestore = fakeFirestore({
      [`hosts/${SITE_B}/topicOptOuts/${KEY}`]: {
        topics: { sales: { optedOutAt: 1, resubscribedAt: null } },
      },
    })
    await expect(lookup(firestore, [SITE_A, SITE_B])).resolves.toMatchObject({
      hostSuppressed: false,
      salesTopicState: 'opted-out',
    })
  })

  it('leaves another brand’s lists its own', async () => {
    const firestore = fakeFirestore({
      [`hosts/${SITE_C}/suppressions/${KEY}`]: { reason: 'unsubscribe' },
      [`hosts/${SITE_C}/topicOptOuts/${KEY}`]: {
        topics: { sales: { optedOutAt: 1, resubscribedAt: null } },
      },
    })
    await expect(lookup(firestore, [SITE_A, SITE_B])).resolves.toMatchObject({
      hostSuppressed: false,
      salesTopicState: 'subscribed',
    })
  })

  it('reads a site in no group exactly as it always did', async () => {
    const seed = {
      [`hosts/${SITE_B}/suppressions/${KEY}`]: { reason: 'unsubscribe' },
    }
    const alone = fakeFirestore(seed)
    await expect(lookup(alone, [SITE_A])).resolves.toMatchObject({
      hostSuppressed: false,
    })
    const unstated = fakeFirestore(seed)
    await lookup(unstated)
    const siteReads = (firestore: any) =>
      firestore.reads.filter((path: string) => path.startsWith('hosts/'))
    expect(siteReads(alone)).toEqual([
      `hosts/${SITE_A}/suppressions/${KEY}`,
      `hosts/${SITE_A}/topicOptOuts/${KEY}`,
    ])
    expect(siteReads(unstated)).toEqual(siteReads(alone))
  })

  it('answers "could not check" when a sibling’s list cannot be read', async () => {
    // Which the gates refuse: a person who asked not to be emailed must not
    // be emailed because a sibling's read timed out.
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const firestore = fakeFirestore({}, { failingSite: SITE_B })
    await expect(lookup(firestore, [SITE_A, SITE_B])).resolves.toMatchObject({
      hostSuppressed: null,
      salesTopicState: null,
    })
    consoleError.mockRestore()
  })
})

/**
 * THE ORG'S CONFIRMATION SWITCH (AGL-3316), folded the way the topic filter
 * folds it: on, a sibling's pending sales confirmation is the group's
 * standing; off, only a sibling's refusal is. Whether a pending standing
 * holds a sales email is the gates' question, and they answer that it does
 * not (`gates.spec.ts`) — for the sequence site's own question and a
 * sibling's alike.
 */
describe('a sibling’s pending sales confirmation', () => {
  const pendingOnSibling = () =>
    fakeFirestore({
      [`hosts/${SITE_B}/topicOptOuts/${KEY}`]: {
        topics: { sales: { pendingAt: 1, confirmedAt: null } },
      },
    })

  it('is the group’s standing when the org said the group waits', async () => {
    await expect(lookup(pendingOnSibling(), [SITE_A, SITE_B], true)).resolves.toMatchObject({
      salesTopicState: 'pending',
    })
  })

  it('is not, with the switch off or unstated — only a refusal crosses', async () => {
    await expect(lookup(pendingOnSibling(), [SITE_A, SITE_B], false)).resolves.toMatchObject({
      salesTopicState: 'subscribed',
    })
    await expect(lookup(pendingOnSibling(), [SITE_A, SITE_B])).resolves.toMatchObject({
      salesTopicState: 'subscribed',
    })
  })

  it('still yields to a refusal anywhere in the group', async () => {
    const firestore = fakeFirestore({
      [`hosts/${SITE_A}/topicOptOuts/${KEY}`]: {
        topics: { sales: { optedOutAt: 1, resubscribedAt: null } },
      },
      [`hosts/${SITE_B}/topicOptOuts/${KEY}`]: {
        topics: { sales: { pendingAt: 1, confirmedAt: null } },
      },
    })
    await expect(lookup(firestore, [SITE_A, SITE_B], true)).resolves.toMatchObject({
      salesTopicState: 'opted-out',
    })
  })

  it('reads the same documents on as off', async () => {
    const off = pendingOnSibling()
    const on = pendingOnSibling()
    await lookup(off, [SITE_A, SITE_B], false)
    await lookup(on, [SITE_A, SITE_B], true)
    expect(on.reads).toEqual(off.reads)
  })
})
