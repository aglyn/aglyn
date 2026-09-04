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
 *
 * @jest-environment node
 */

/**
 * IMPORTING A FILE — who gets on the list, on what basis, and what stops.
 *
 * WHAT THE DOUBLES MODEL, stated so a false green is visible:
 *
 *  1. `enrollListMember` is the REAL helper, reached by its deep path. It
 *     owns the document id and the recorded-refusal backstop, and this suite
 *     asserts on the fields it actually writes — so doubling it would turn
 *     every claim about the stored consent basis into a claim about a double.
 *  2. `assignmentBasis`, `readMarketingBasis`, `parseListImport`,
 *     `screenListImport` and `normalizeContactEmail` are the real pure
 *     functions. The consent rule and the file screening ARE what is under
 *     test.
 *  3. `filterSendableForHost` / `filterSuppressedEmails` are doubles over a
 *     set of suppressed addresses. Whether the real pair reads the right two
 *     collections is `email-suppression.spec.ts`'s question; what this file
 *     certifies is that an IMPORT goes through them.
 *  4. Nothing sends anything, and there is no mail double, because enrolling
 *     somebody is not a send.
 */

const platformSuppressed = new Set<string>()
const hostSuppressed = new Set<string>()

/**
 * `FieldValue`, real enough for the run's counters.
 *
 * `increment` is a sentinel the store below applies on merge, because the
 * run's whole tally is increments — a double that dropped them would let a
 * broken counter pass, and the counter is what the progress bar and the final
 * "N of M were added" are read from.
 */
jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    serverTimestamp: () => '__serverTimestamp',
    increment: (by: number) => ({ __increment: by }),
  },
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  registerPluginApiRoute: jest.fn(),
  ...jest.requireActual('@aglyn/aglyn/app-utils/marketing-consent'),
  ...jest.requireActual('@aglyn/aglyn/app-utils/list-assignment-policy'),
  ...jest.requireActual('@aglyn/aglyn/app-utils/list-import'),
  ...jest.requireActual('@aglyn/aglyn/app-utils/organizations'),
  ...jest.requireActual('@aglyn/aglyn/app-utils/contacts'),
  ...jest.requireActual('@aglyn/aglyn/app-utils/person-key'),
  ...jest.requireActual('@aglyn/aglyn/app-utils/create-resource-uid'),
}))

const HOST_ID = 'site-1'

/**
 * A contact whose basis is recorded against THIS site, and the enrolling
 * site's own entry on a membership row.
 *
 * Consent is per (person, controller): a fixture writing a grant at the top
 * of the document would be asserting the pre-host model, and an assertion
 * reading one from there would pass against a reader that had lost the host
 * dimension entirely. A REFUSAL is deliberately left unscoped — it names no
 * controller and is honored against every one.
 */
const grantedHere = (atMs: number) => ({
  marketingConsentByHost: {
    [HOST_ID]: { marketingConsent: true, marketingConsentAtMs: atMs },
  },
})
const entryOf = (row: Record<string, any> | undefined) =>
  (row?.['marketingConsentByHost']?.[HOST_ID] ?? {}) as Record<string, any>

const ORG_ID = 'org-1'
const LIST_ID = 'list-1'
const LIST_PATH = `orgs/${ORG_ID}/lists/${LIST_ID}`
const MEMBERS_PATH = `${LIST_PATH}/members`
const IMPORTS_PATH = `${LIST_PATH}/imports`

const OPTED_IN = 'priya@lumen.co'
const REFUSED = 'sam@lumen.co'
const UNKNOWN = 'dev@lumen.co'
const OPTED_IN_AT = Date.UTC(2024, 4, 2)

let store: Record<string, Record<string, any>> = {}
let decodedToken: { uid: string } = { uid: 'editor-uid' }
let membership: { orgId: string; member: Record<string, unknown> } | null = null
let contactSeq = 0

const memberFor = (email: string) =>
  Object.entries(store)
    .filter(([path]) => path.startsWith(`${MEMBERS_PATH}/`))
    .map(([, row]) => row)
    .find((row) => row?.['email'] === email)

const memberRows = () =>
  Object.keys(store).filter((path) => path.startsWith(`${MEMBERS_PATH}/`))

const snapshotFor = (path: string) => ({
  id: path.slice(path.lastIndexOf('/') + 1),
  path,
  get exists() {
    return store[path] !== undefined
  },
  get: (field: string) => store[path]?.[field],
  data: () => store[path],
  get ref() {
    return docHandle(path)
  },
})

/** Applies a merge write, resolving the `increment` sentinel. */
const mergeInto = (
  target: Record<string, any>,
  patch: Record<string, any>,
): Record<string, any> => {
  const out = { ...target }
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && '__increment' in value) {
      out[key] = Number(out[key] ?? 0) + Number(value.__increment)
    } else if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      !(value instanceof Date)
    ) {
      out[key] = mergeInto((out[key] ?? {}) as Record<string, any>, value)
    } else {
      out[key] = value
    }
  }
  return out
}

const docHandle = (path: string): any => ({
  id: path.slice(path.lastIndexOf('/') + 1),
  path,
  get firestore() {
    return firestoreHandle
  },
  get: async () => snapshotFor(path),
  set: async (data: Record<string, any>, options?: { merge?: boolean }) => {
    store[path] = options?.merge
      ? mergeInto(store[path] ?? {}, data)
      : mergeInto({}, data)
  },
  collection: (name: string) => collectionHandle(`${path}/${name}`),
})

const childPaths = (path: string) =>
  Object.keys(store).filter(
    (key) =>
      key.startsWith(`${path}/`) && !key.slice(`${path}/`.length).includes('/'),
  )

const collectionHandle = (path: string): any => {
  const build = (
    filters: Array<[string, string, unknown]>,
    cap: number | null,
  ): any => ({
    doc: (id: string) => docHandle(`${path}/${id}`),
    where: (field: string, op: string, value: unknown) =>
      build([...filters, [field, op, value]], cap),
    orderBy: () => build(filters, cap),
    limit: (value: number) => build(filters, value),
    get: async () => {
      const matched = childPaths(path)
        .filter((key) =>
          filters.every(([field, op, value]) =>
            op === 'in'
              ? (value as unknown[]).includes(store[key]?.[field])
              : store[key]?.[field] === value,
          ),
        )
        .sort()
        .slice(0, cap ?? Infinity)
        .map(snapshotFor)
      return { docs: matched, empty: matched.length === 0, size: matched.length }
    },
    get parent() {
      return docHandle(path.slice(0, path.lastIndexOf('/')))
    },
  })
  return build([], null)
}

const firestoreHandle: any = {
  collection: (name: string) => collectionHandle(name),
  getAll: async (...refs: any[]) => refs.map((ref) => snapshotFor(ref.path)),
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  /*
   * The real resolution's shape: an org that declared no pooling resolves
   * every site to a group of ONE. Faked rather than imported because this
   * file mocks the whole module — but faked to the NARROW answer, which is
   * the direction a wrong group may fail in.
   */
  consentGroupForSite: async (hostId: string) => ({
    hostId,
    groupId: hostId,
    name: null,
    hostIds: [hostId],
    declared: false,
  }),
  __esModule: true,
  enrollListMember: jest.requireActual(
    '@aglyn/tenant-data-admin/server/list-members',
  ).enrollListMember,
  collectDynamicListCandidates: async () => ({
    candidates: [],
    complete: true,
    cursor: null,
    empty: false,
    read: 0,
  }),
  filterSendableForHost: async (_hostId: string, emails: string[]) =>
    emails.filter(
      (email) => !platformSuppressed.has(email) && !hostSuppressed.has(email),
    ),
  filterSuppressedEmails: async (emails: string[]) =>
    emails.filter((email) => !platformSuppressed.has(email)),
  getOrgForHost: async () => ({ orgId: ORG_ID, org: {} }),
  resolveOrgMembership: async () => membership,
  orgDataCollectionForHost: async () =>
    collectionHandle(`orgs/${ORG_ID}/contacts`),
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: async () => decodedToken }),
      firestore: () => firestoreHandle,
    }),
  },
}))

import {
  CONSOLE_IMPORT_SOURCE,
  emailListImportPreviewHandler,
  emailListImportRunHandler,
  emailListImportStartHandler,
  emailListImportStatusHandler,
} from './server-list-import'

async function drive(
  handler: typeof emailListImportRunHandler,
  body: Record<string, unknown>,
  headers: Record<string, string> = { authorization: 'Bearer token' },
) {
  const out: { code: number; body: any } = { code: 0, body: undefined }
  const res: any = {
    status(code: number) {
      out.code = code
      return res
    },
    json(payload: unknown) {
      out.body = payload
      return res
    },
  }
  await handler({ method: 'POST', body, headers } as any, res)
  return out
}

const previewFile = (body: Record<string, unknown>) =>
  drive(emailListImportPreviewHandler, {
    hostId: HOST_ID,
    listId: LIST_ID,
    ...body,
  })
const startImport = (body: Record<string, unknown>) =>
  drive(emailListImportStartHandler, {
    hostId: HOST_ID,
    listId: LIST_ID,
    ...body,
  })
const runImport = (body: Record<string, unknown>) =>
  drive(emailListImportRunHandler, { hostId: HOST_ID, listId: LIST_ID, ...body })
const importStatus = () =>
  drive(emailListImportStatusHandler, { hostId: HOST_ID, listId: LIST_ID })

/** Starts an import and drives it to completion, the way the drawer does. */
async function importFile(text: string, attestConsent = false) {
  const started = await startImport({ text, attestConsent })
  const importId = started.body?.importId
  let last = started
  for (let guard = 0; guard < 50; guard += 1) {
    last = await runImport({ importId })
    if (last.body?.complete) break
  }
  return { importId, started, last }
}

const seedContact = (email: string, consent: Record<string, unknown>) => {
  store[`orgs/${ORG_ID}/contacts/c${(contactSeq += 1)}`] = { email, ...consent }
}

beforeEach(() => {
  store = {}
  contactSeq = 0
  platformSuppressed.clear()
  hostSuppressed.clear()
  decodedToken = { uid: 'editor-uid' }
  membership = { orgId: ORG_ID, member: { role: 'editor', allHosts: true } }
  store[`hosts/${HOST_ID}`] = {
    displayName: 'Lumen',
    memberRoles: { 'editor-uid': 'editor' },
  }
  store[LIST_PATH] = { name: 'Newsletter' }
  seedContact(OPTED_IN, grantedHere(OPTED_IN_AT))
  seedContact(REFUSED, { marketingConsent: false })
})

describe('reading the file', () => {
  it('reports the addresses, the duplicates and the lines that are not addresses', async () => {
    const answer = await previewFile({
      text: [
        'Email,Name',
        `${OPTED_IN},Priya`,
        `${OPTED_IN.toUpperCase()},Priya again`,
        'not-an-address,Nobody',
        `${UNKNOWN},Dev`,
      ].join('\n'),
    })
    expect(answer.code).toBe(200)
    expect(answer.body.usable).toBe(2)
    expect(answer.body.duplicates).toBe(1)
    expect(answer.body.unusable).toBe(1)
    expect(answer.body.unusableSamples).toContain('not-an-address')
  })

  it('reports role accounts and purchase-tell columns without refusing them', async () => {
    const answer = await previewFile({
      text: ['Email,Append Source', 'sales@lumen.co,jigsaw'].join('\n'),
    })
    expect(answer.body.screening.roleAccounts).toBe(1)
    expect(answer.body.screening.roleAccountSamples).toContain('sales@lumen.co')
    expect(answer.body.screening.purchaseTellColumns).toEqual(['Append Source'])
    // Reported, not refused: the address is still countable and importable.
    expect(answer.body.usable).toBe(1)
  })

  it('writes nothing', async () => {
    await previewFile({ text: `${UNKNOWN}\n${OPTED_IN}` })
    expect(memberRows()).toEqual([])
    expect(Object.keys(store).some((path) => path.startsWith(IMPORTS_PATH))).toBe(
      false,
    )
  })

  it('reports the sample size beside the file total', async () => {
    const answer = await previewFile({ text: `${OPTED_IN}\n${UNKNOWN}` })
    expect(answer.body.sampleSize).toBe(2)
    expect(answer.body.verdicts).toHaveLength(2)
  })
})

describe('a suppressed address is never imported', () => {
  it('refuses one on the site suppression list', async () => {
    hostSuppressed.add(OPTED_IN)
    const { last } = await importFile(`${OPTED_IN}\n${UNKNOWN}`, true)
    expect(memberFor(OPTED_IN)).toBeUndefined()
    expect(last.body.refusals['suppressed-host']).toBe(1)
  })

  it('refuses one on the platform suppression list', async () => {
    platformSuppressed.add(OPTED_IN)
    const { last } = await importFile(`${OPTED_IN}\n${UNKNOWN}`, true)
    expect(memberFor(OPTED_IN)).toBeUndefined()
    expect(last.body.refusals['suppressed-platform']).toBe(1)
  })

  it('imports the rest of the file around the suppressed address', async () => {
    hostSuppressed.add(OPTED_IN)
    await importFile(`${OPTED_IN}\n${UNKNOWN}`, true)
    expect(memberFor(UNKNOWN)).toBeDefined()
  })

  it('refuses somebody whose contact record declines marketing email, attestation or not', async () => {
    const { last } = await importFile(`${REFUSED}`, true)
    expect(memberFor(REFUSED)).toBeUndefined()
    expect(last.body.refusals['declined']).toBe(1)
  })
})

describe('the consent basis an import records', () => {
  it('records an attested address as an OPERATOR assertion and never as the person', async () => {
    await importFile(`${UNKNOWN}`, true)
    const member = memberFor(UNKNOWN)
    expect(entryOf(member)['marketingConsentBasis']).toBe('operator-attested')
    expect(entryOf(member)['marketingConsentByUid']).toBe('editor-uid')
    const { readMarketingBasis } = jest.requireActual(
      '@aglyn/aglyn/app-utils/marketing-consent',
    )
    const { soloConsentGroup } = jest.requireActual(
      '@aglyn/aglyn/app-utils/consent-groups',
    )
    expect(readMarketingBasis(member, soloConsentGroup(HOST_ID)).assertedBy).toBe('operator')
    expect(readMarketingBasis(member, soloConsentGroup(HOST_ID)).assertedBy).not.toBe('person')
  })

  it('carries a stored opt-in across with the PERSON’s own date', async () => {
    await importFile(`${OPTED_IN}`, true)
    const member = memberFor(OPTED_IN)
    expect(entryOf(member)['marketingConsentBasis']).toBe('contact-opt-in')
    expect(entryOf(member)['marketingConsentAtMs']).toBe(OPTED_IN_AT)
    expect(entryOf(member)['marketingConsentByUid']).toBeNull()
    const { readMarketingBasis } = jest.requireActual(
      '@aglyn/aglyn/app-utils/marketing-consent',
    )
    const { soloConsentGroup } = jest.requireActual(
      '@aglyn/aglyn/app-utils/consent-groups',
    )
    expect(readMarketingBasis(member, soloConsentGroup(HOST_ID)).assertedBy).toBe('person')
  })

  it('refuses an address with nothing on record when nobody attested', async () => {
    const { last } = await importFile(`${UNKNOWN}`, false)
    expect(memberFor(UNKNOWN)).toBeUndefined()
    expect(last.body.refusals['no-basis']).toBe(1)
  })

  it('still imports the opted-in addresses when nobody attested', async () => {
    await importFile(`${OPTED_IN}\n${UNKNOWN}`, false)
    expect(memberFor(OPTED_IN)).toBeDefined()
    expect(memberFor(UNKNOWN)).toBeUndefined()
  })

  it('keeps what the file declared as the reason on the attested row', async () => {
    await importFile(
      ['Email,Opt-in source,Opt-in date', `${UNKNOWN},Trade show,2024-03-01`].join(
        '\n',
      ),
      true,
    )
    const member = memberFor(UNKNOWN)
    expect(entryOf(member)['marketingConsentReason']).toContain('Trade show')
    expect(entryOf(member)['marketingConsentReason']).toContain('2024-03-01')
  })

  it('never dresses a pass-through opt-in in the file’s declaration', async () => {
    await importFile(
      ['Email,Opt-in source', `${OPTED_IN},Bought from a broker`].join('\n'),
      true,
    )
    expect(entryOf(memberFor(OPTED_IN))['marketingConsentReason']).toBe('')
  })

  it('attributes the basis to the account that ATTESTED, not the one that resumed', async () => {
    const started = await startImport({
      text: `${UNKNOWN}`,
      attestConsent: true,
    })
    // A colleague finishes the import. They asserted nothing.
    decodedToken = { uid: 'colleague-uid' }
    store[`hosts/${HOST_ID}`]['memberRoles']['colleague-uid'] = 'admin'
    await runImport({ importId: started.body.importId })
    expect(entryOf(memberFor(UNKNOWN))['marketingConsentByUid']).toBe('editor-uid')
  })

  it('stamps the import as the membership source', async () => {
    await importFile(`${UNKNOWN}`, true)
    expect(memberFor(UNKNOWN)?.['source']).toBe(CONSOLE_IMPORT_SOURCE)
    expect(memberFor(UNKNOWN)?.['via']).toBe('manual')
  })
})

describe('the run is bounded and resumable', () => {
  /** A file of `count` distinct addresses. */
  const bigFile = (count: number) =>
    Array.from({ length: count }, (_, at) => `person${at}@lumen.co`).join('\n')

  it('stops at the run budget and reports where it got to', async () => {
    const started = await startImport({ text: bigFile(150), attestConsent: true })
    const first = await runImport({ importId: started.body.importId })
    expect(first.body.complete).toBe(false)
    expect(first.body.cursor).toBe(100)
    expect(memberRows()).toHaveLength(100)
  })

  it('resumes from the cursor rather than restarting', async () => {
    const started = await startImport({ text: bigFile(150), attestConsent: true })
    await runImport({ importId: started.body.importId })
    const second = await runImport({ importId: started.body.importId })
    expect(second.body.complete).toBe(true)
    expect(second.body.cursor).toBe(150)
    expect(second.body.ranEnrolled).toBe(50)
    expect(memberRows()).toHaveLength(150)
  })

  it('imports a file staged across more than one chunk', async () => {
    const started = await startImport({ text: bigFile(600), attestConsent: true })
    for (let run = 0; run < 6; run += 1) {
      await runImport({ importId: started.body.importId })
    }
    expect(memberRows()).toHaveLength(600)
  })

  it('reads across a chunk boundary when the batch straddles one', async () => {
    /*
     * A cursor that is not a multiple of the run budget, which is the only
     * way a batch spans two chunk documents while the chunk size stays a
     * multiple of the budget. It is reachable in production by resuming a job
     * staged under a different budget, and it is the case the read loop
     * exists for — without the loop the run reads a short batch and advances
     * the cursor past the addresses it never looked at.
     */
    const started = await startImport({ text: bigFile(600), attestConsent: true })
    store[`${IMPORTS_PATH}/${started.body.importId}`]['cursor'] = 450
    const run = await runImport({ importId: started.body.importId })
    expect(run.body.cursor).toBe(550)
    expect(memberRows()).toHaveLength(100)
    // The 50 either side of the boundary, so the read really crossed it.
    expect(memberFor('person449@lumen.co')).toBeUndefined()
    expect(memberFor('person450@lumen.co')).toBeDefined()
    expect(memberFor('person549@lumen.co')).toBeDefined()
    expect(memberFor('person550@lumen.co')).toBeUndefined()
  })

  it('advances the cursor over a refused address rather than looping on it', async () => {
    hostSuppressed.add('person0@lumen.co')
    const started = await startImport({ text: bigFile(3), attestConsent: true })
    const run = await runImport({ importId: started.body.importId })
    expect(run.body.cursor).toBe(3)
    expect(run.body.complete).toBe(true)
  })

  it('answers complete without doing work when there is nothing left', async () => {
    const { importId } = await importFile(`${UNKNOWN}`, true)
    const again = await runImport({ importId })
    expect(again.body.complete).toBe(true)
    expect(again.body.ranEnrolled).toBe(0)
  })

  it('keeps the job’s running totals across runs', async () => {
    hostSuppressed.add('person5@lumen.co')
    const started = await startImport({ text: bigFile(150), attestConsent: true })
    await runImport({ importId: started.body.importId })
    await runImport({ importId: started.body.importId })
    const state = await importStatus()
    expect(state.body.job.enrolled).toBe(149)
    expect(state.body.job.refused).toBe(1)
    expect(state.body.job.refusals['suppressed-host']).toBe(1)
    expect(state.body.job.status).toBe('complete')
  })

  it('offers an unfinished import back so it can be resumed', async () => {
    const started = await startImport({ text: bigFile(150), attestConsent: true })
    await runImport({ importId: started.body.importId })
    const state = await importStatus()
    expect(state.body.job.status).toBe('running')
    expect(state.body.job.cursor).toBe(100)
    expect(state.body.job.total).toBe(150)
  })
})

describe('starting an import', () => {
  it('enrolls nobody', async () => {
    await startImport({ text: `${UNKNOWN}\n${OPTED_IN}`, attestConsent: true })
    expect(memberRows()).toEqual([])
  })

  it('records who attested and when', async () => {
    const started = await startImport({
      text: `${UNKNOWN}`,
      attestConsent: true,
    })
    const job = store[`${IMPORTS_PATH}/${started.body.importId}`]
    expect(job['attested']).toBe(true)
    expect(job['attestedByUid']).toBe('editor-uid')
    expect(typeof job['attestedAtMs']).toBe('number')
  })

  it('records no attester when nobody attested', async () => {
    const started = await startImport({
      text: `${UNKNOWN}`,
      attestConsent: false,
    })
    const job = store[`${IMPORTS_PATH}/${started.body.importId}`]
    expect(job['attested']).toBe(false)
    expect(job['attestedByUid']).toBeNull()
  })

  it('refuses a file with no usable address', async () => {
    const answer = await startImport({ text: 'Name\nNobody', attestConsent: true })
    expect(answer.code).toBe(400)
  })

  it('refuses a file larger than one request may read', async () => {
    const answer = await startImport({
      text: 'a@b.co\n'.repeat(1_200_000),
      attestConsent: true,
    })
    expect(answer.code).toBe(400)
    expect(memberRows()).toEqual([])
  })
})

describe('who may import', () => {
  it('refuses a caller with no site role', async () => {
    store[`hosts/${HOST_ID}`] = { memberRoles: {} }
    const answer = await startImport({ text: UNKNOWN, attestConsent: true })
    expect(answer.code).toBe(403)
  })

  it('refuses a single-site collaborator on an org-wide audience', async () => {
    membership = { orgId: ORG_ID, member: { role: 'editor', allHosts: false } }
    const answer = await startImport({ text: UNKNOWN, attestConsent: true })
    expect(answer.code).toBe(403)
  })

  it('refuses an unauthenticated caller', async () => {
    const answer = await drive(
      emailListImportStartHandler,
      { hostId: HOST_ID, listId: LIST_ID, text: UNKNOWN },
      {},
    )
    expect(answer.code).toBe(401)
  })

  it('refuses a run against an unknown import', async () => {
    const answer = await runImport({ importId: 'nope' })
    expect(answer.code).toBe(404)
  })
})
