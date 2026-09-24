/**
 * WHICH RECORD A CAPTURE LANDS ON (AGL-3232) — the CRM's side of the
 * capture seam, judged on what lands.
 *
 * `addHostLead` is the REAL lead door, over an in-memory Firestore keyed by
 * path, so a lead's id, stamp and consent are the door's own; the contact
 * door is a double that plants a row the way the real one would, because
 * the rule under test is which door a capture reaches, not what the contact
 * door writes (its own spec owns that).
 */

import type { PluginContactCaptureRequest } from '@aglyn/aglyn/plugin-manager/plugin-contact-capture'

const docs = new Map<string, Record<string, any>>()
let autoId = 0

function childPaths(path: string): string[] {
  const prefix = `${path}/`
  return [...docs.keys()].filter(
    (key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'),
  )
}

function applyWrite(
  existing: Record<string, any> | undefined,
  value: Record<string, any>,
): Record<string, any> {
  const next: Record<string, any> = { ...(existing ?? {}) }
  for (const [key, field] of Object.entries(value)) {
    if (field && typeof field === 'object' && '__arrayUnion' in field) {
      const before = Array.isArray(next[key]) ? next[key] : []
      next[key] = [
        ...before,
        ...(field.__arrayUnion as unknown[]).filter((item) => !before.includes(item)),
      ]
    } else if (field && typeof field === 'object' && '__increment' in field) {
      next[key] = Number(next[key] ?? 0) + Number(field.__increment)
    } else {
      next[key] = field
    }
  }
  return next
}

function snapshot(path: string) {
  const data = docs.get(path)
  return {
    id: path.split('/').pop() as string,
    exists: data !== undefined,
    data: () => data,
    get: (field: string) => data?.[field],
  }
}

function docRef(path: string): any {
  return {
    id: path.split('/').pop() as string,
    path,
    firestore: fakeFirestore,
    get: async () => snapshot(path),
    set: async (value: Record<string, any>, options?: { merge?: boolean }) => {
      docs.set(path, options?.merge ? applyWrite(docs.get(path), value) : { ...value })
    },
    collection: (name: string) => collectionRef(`${path}/${name}`),
  }
}

function collectionRef(path: string): any {
  return {
    path,
    doc: (id?: string) => docRef(`${path}/${id ?? `auto-${++autoId}`}`),
    count: () => ({
      get: async () => ({ data: () => ({ count: childPaths(path).length }) }),
    }),
    where: (field: string, _op: string, value: unknown) => ({
      limit: () => ({
        get: async () => {
          const hits = childPaths(path).filter((p) => docs.get(p)?.[field] === value)
          return {
            empty: hits.length === 0,
            docs: hits.map(snapshot),
          }
        },
      }),
    }),
  }
}

const fakeFirestore: any = {
  collection: (name: string) => collectionRef(name),
  runTransaction: async (body: (tx: any) => Promise<unknown>) =>
    body({
      get: async (target: any) => target.get(),
      set: (ref: any, value: Record<string, any>, options?: { merge?: boolean }) => {
        docs.set(
          ref.path,
          options?.merge ? applyWrite(docs.get(ref.path), value) : { ...value },
        )
      },
    }),
}

const HOST = 'site-1'
const ORG = 'org-1'
const CONTACTS = `orgs/${ORG}/contacts`

/** Every contact capture the double was handed, in order. */
const contactCaptures: Array<Record<string, any>> = []
/** Every host event emitted, in order. */
const events: Array<{ event: string; payload: Record<string, unknown> }> = []
/** Every auto-conversion asked for. */
const conversions: Array<Record<string, unknown>> = []
/**
 * The org's consent-group declaration, when a case declares one; `null` is
 * the org that declared nothing, which every other case in this file is.
 */
let mockConsentGroups: Record<string, unknown> | null = null

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    serverTimestamp: () => ({ __serverTimestamp: true }),
    arrayUnion: (...values: unknown[]) => ({ __arrayUnion: values }),
    increment: (operand: number) => ({ __increment: operand }),
  },
}))

jest.mock(
  '../../../../../tenant/data/admin/src/lib/server/campaign-conversion-attribution',
  () => ({
    __esModule: true,
    attributeCampaignConversion: jest.fn(async () => undefined),
  }),
)
jest.mock('../../../../../tenant/data/admin/src/lib/server/notifications', () => ({
  __esModule: true,
  notifyHostManagers: jest.fn(async () => undefined),
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: { app: () => ({ firestore: () => fakeFirestore }) },
  orgDataCollectionForHost: async (_hostId: string, name: string) =>
    collectionRef(`orgs/${ORG}/${name}`),
  // The org lead silo (AGL-3275), reached through the barrel by the CRM's own
  // capture door; the relative doubles above are what `addHostLead` reaches.
  orgLeadsForHost: async () => collectionRef(`orgs/${ORG}/leads`),
  readLeadForHost: async (_hostId: string, key: string) => {
    const row = docs.get(`orgs/${ORG}/leads/${key}`)
    return row
      ? { exists: true, id: key, data: () => row, get: (f: string) => (row as any)?.[f] }
      : null
  },
  scopedToHost: (ref: any) => ref,
  // The real address lookup, over the fake's `where` — no index beside the fake's collections.
  ...jest.requireActual('../../../../../tenant/data/admin/src/lib/server/contact-email-index'),
  // The real lead door — see the file docblock.
  ...jest.requireActual('../../../../../tenant/data/admin/src/lib/server/host-visitor-records'),
}))

jest.mock('@aglyn/tenant-runtime/capture-host-contact', () => ({
  __esModule: true,
  captureHostContact: async (options: Record<string, any>) => {
    contactCaptures.push(options)
    // The real door normalizes the address it is handed; so does the double.
    const { normalizeContactEmail } = jest.requireActual(
      '../../../../../aglyn/src/lib/app-utils/contacts',
    )
    const email = normalizeContactEmail(options.email)
    const existing = childPaths(CONTACTS).find((path) => docs.get(path)?.email === email)
    if (existing) return { contactId: existing.split('/').pop(), created: false }
    const id = `c-${childPaths(CONTACTS).length + 1}`
    docs.set(`${CONTACTS}/${id}`, { email: options.email })
    return { contactId: id, created: true }
  },
}))
jest.mock('./convert-open-lead', () => ({
  __esModule: true,
  convertOpenLeadOntoContact: async (input: Record<string, unknown>) => {
    conversions.push(input)
    return true
  },
}))
jest.mock('@aglyn/tenant-runtime/emit-host-event', () => ({
  __esModule: true,
  emitHostEvent: async (_hostId: string, event: string, payload: Record<string, unknown>) => {
    events.push({ event, payload })
    return { alerts: [] }
  },
}))

/*
 * The lead silo is org-scoped (AGL-3275), and the real capture door this file
 * drives reaches it by RELATIVE path — doubled here as well as on the barrel,
 * or the door would resolve a live org read. Where a lead lives is
 * `host-lead-seam.spec.ts`'s claim; this file keeps its own, which is WHICH RECORD
 * a capture lands on.
 */
jest.mock('../../../../../tenant/data/admin/src/lib/server/host-visitor-records', () => ({
  __esModule: true,
  orgLeadsForHost: async () => collectionRef(`orgs/${ORG}/leads`),
  readLeadForHost: async (_hostId: string, key: string) => {
    const path = `orgs/${ORG}/leads/${key}`
    const row = docs.get(path)
    return row
      ? { exists: true, id: key, data: () => row, get: (f: string) => (row as any)?.[f] }
      : null
  },
  leadForWrite: async (_hostId: string, key: string) => ({
    ref: collectionRef(`orgs/${ORG}/leads`).doc(key),
    existed: docs.has(`orgs/${ORG}/leads/${key}`),
    carried: false,
  }),
  leadScopeForHost: async (hostId: string) => [`host:${hostId}`],
}))

jest.mock('../../../../../tenant/data/admin/src/lib/server/firebase-admin', () => ({
  __esModule: true,
  // The LEGACY host path behind the seam's carry (AGL-3275). Empty here: what
  // these files drive is the capture, and the carry is `host-lead-seam`'s.
  default: {
    app: () => ({
      firestore: () => ({
        collection: () => ({
          doc: () => ({
            collection: () => ({
              doc: () => ({ get: async () => ({ exists: false, data: () => undefined }) }),
            }),
          }),
        }),
      }),
    }),
  },
}))

jest.mock('../../../../../tenant/data/admin/src/lib/server/organizations', () => ({
  __esModule: true,
  // The seam resolves the org collection through here (AGL-3275).
  orgDataCollectionForHost: async (_hostId: string, name: string) =>
    collectionRef(`orgs/${ORG}/${name}`),
  resolveOrgIdForHost: async () => ORG,
  consentGroupForSite: async (hostId: string) =>
    jest
      .requireActual('@aglyn/aglyn/app-utils/consent-groups')
      .consentGroupForHost(
        mockConsentGroups ? { consentGroups: mockConsentGroups } : null,
        hostId,
      ),
  scopedToHost: (ref: any) => ref,
}))

import { personKey, readMarketingBasis, soloConsentGroup } from '@aglyn/aglyn/server'
import { captureContactForCrm } from './capture-contact'

const EMAIL = 'dana@example.com'
const leadPath = (email = EMAIL) => `orgs/${ORG}/leads/${personKey(email)}`

const request = (
  overrides: Partial<PluginContactCaptureRequest> = {},
): PluginContactCaptureRequest => ({
  orgId: ORG,
  hostId: HOST,
  identity: { email: ' Dana@Example.com ', name: 'Dana Marsh' },
  interaction: { source: 'form', refId: 'sub-1', summary: 'Submitted "Contact"' },
  detail: { formId: 'form-1' },
  ...overrides,
})

beforeEach(() => {
  docs.clear()
  autoId = 0
  contactCaptures.length = 0
  events.length = 0
  conversions.length = 0
  mockConsentGroups = null
})

describe('a lead surface', () => {
  it('files a lead and no contact for somebody the workspace does not hold', async () => {
    const verdict = await captureContactForCrm(
      request({ surface: 'lead', marketingConsent: true }),
    )
    expect(verdict).toEqual({ ok: true, record: 'lead', leadId: personKey(EMAIL), created: true })
    expect(docs.get(leadPath())).toMatchObject({
      email: EMAIL,
      name: 'Dana Marsh',
      sources: ['form:form-1'],
      submissionCount: 1,
      capturedByHostIds: [HOST],
    })
    expect(readMarketingBasis(docs.get(leadPath()) ?? null, soloConsentGroup(HOST)).basis).toBe(
      'granted',
    )
    expect(contactCaptures).toEqual([])
    expect(childPaths(CONTACTS)).toEqual([])
    // A NEW lead announces itself, by the id it was filed under.
    expect(events).toEqual([
      {
        event: 'lead',
        payload: { email: EMAIL, source: 'form:form-1', leadId: personKey(EMAIL), name: 'Dana Marsh' },
      },
    ])
  })

  it('updates the lead the site already holds, and announces nothing', async () => {
    docs.set(leadPath(), { email: EMAIL, sources: ['booking'], submissionCount: 1, status: 'working' })
    const verdict = await captureContactForCrm(request({ surface: 'lead' }))
    expect(verdict).toEqual({ ok: true, record: 'lead', leadId: personKey(EMAIL), created: false })
    expect(docs.get(leadPath())).toMatchObject({
      sources: ['booking', 'form:form-1'],
      submissionCount: 2,
      status: 'working',
    })
    expect(events).toEqual([])
  })

  it('lands on the contact the workspace already holds, and files no lead', async () => {
    docs.set(`${CONTACTS}/c-9`, { email: EMAIL })
    const verdict = await captureContactForCrm(request({ surface: 'lead' }))
    expect(verdict).toEqual({ ok: true, record: 'contact', contactId: 'c-9', created: false })
    expect(docs.has(leadPath())).toBe(false)
    expect(contactCaptures).toHaveLength(1)
    expect(contactCaptures[0]).toMatchObject({ hostId: HOST, source: 'form' })
    expect(events).toEqual([])
  })

  it('names a booking by its own word', async () => {
    await captureContactForCrm(
      request({ surface: 'lead', interaction: { source: 'booking', refId: 'b-1' }, detail: {} }),
    )
    expect(docs.get(leadPath())?.sources).toEqual(['booking'])
  })
})

describe('a touch', () => {
  it('lands on the open lead the site holds, and files no contact', async () => {
    docs.set(leadPath(), { email: EMAIL, sources: ['form:form-1'], submissionCount: 1 })
    const verdict = await captureContactForCrm(
      request({
        surface: 'touch',
        interaction: { source: 'newsletter', refId: 'n-1' },
        detail: {},
        marketingConsent: true,
      }),
    )
    expect(verdict).toEqual({ ok: true, record: 'lead', leadId: personKey(EMAIL), created: false })
    expect(docs.get(leadPath())).toMatchObject({ sources: ['form:form-1', 'newsletter'] })
    expect(readMarketingBasis(docs.get(leadPath()) ?? null, soloConsentGroup(HOST)).basis).toBe(
      'granted',
    )
    expect(contactCaptures).toEqual([])
  })

  it('lands on the contact when the site holds no open lead — none, converted, or closed', async () => {
    for (const lead of [
      undefined,
      { email: EMAIL, status: 'qualified', convertedContactId: 'c-0' },
      { email: EMAIL, status: 'unqualified', unqualifiedReason: 'Not a fit' },
    ]) {
      docs.clear()
      contactCaptures.length = 0
      if (lead) docs.set(leadPath(), lead)
      const verdict = await captureContactForCrm(request({ surface: 'touch' }))
      expect(verdict).toMatchObject({ ok: true, record: 'contact', created: true })
      expect(contactCaptures).toHaveLength(1)
      if (lead) expect(docs.get(leadPath())).toEqual(lead)
    }
  })

  it('is the default when a door names no surface', async () => {
    docs.set(leadPath(), { email: EMAIL })
    const verdict = await captureContactForCrm(request())
    expect(verdict).toMatchObject({ record: 'lead' })
  })
})

describe('a relationship', () => {
  it('makes the contact and closes the open lead onto it', async () => {
    docs.set(leadPath(), { email: EMAIL, status: 'new' })
    const verdict = await captureContactForCrm(
      request({
        surface: 'relationship',
        interaction: { source: 'member', refId: 'm-1' },
        detail: {},
        lifecycleFloor: 'subscriber',
      }),
    )
    expect(verdict).toEqual({ ok: true, record: 'contact', contactId: 'c-1', created: true })
    expect(contactCaptures[0]).toMatchObject({ source: 'member', initialLifecycleStage: 'subscriber' })
    expect(conversions).toEqual([
      { hostId: HOST, email: ' Dana@Example.com ', contactId: 'c-1', by: 'signup' },
    ])
  })
})

describe('what every surface refuses', () => {
  it('answers an unreadable address as invalid-email, and writes nothing', async () => {
    for (const surface of ['lead', 'touch', 'relationship'] as const) {
      const verdict = await captureContactForCrm(
        request({ surface, identity: { email: 'nope' } }),
      )
      expect(verdict).toMatchObject({ ok: false, reason: 'invalid-email' })
    }
    expect(docs.size).toBe(0)
  })
})

/*
 * THE DISCLOSURE KEY, handed to whichever record the capture lands on
 * (AGL-3320). Both writers pool the opt-in over the site's consent group only
 * on the group's current key, so one capture records the same sites on a
 * lead as on a contact.
 */
describe('the consent-group key a surface sends', () => {
  const groups = jest.requireActual('@aglyn/aglyn/app-utils/consent-groups')
  const NORTHWIND = { nw: { name: 'Northwind', hostIds: [HOST, 'site-2'] } }
  const currentKey = () =>
    groups.consentGroupDisclosureKey(
      groups.consentGroupForHost({ consentGroups: NORTHWIND }, HOST),
    )
  const leadSites = () =>
    Object.keys((docs.get(leadPath()) as any)?.marketingConsentByHost ?? {}).sort()

  it('pools a lead’s opt-in across the group on the current key', async () => {
    mockConsentGroups = NORTHWIND
    await captureContactForCrm(
      request({ surface: 'lead', marketingConsent: true, disclosedConsentGroup: currentKey() }),
    )
    expect(leadSites()).toEqual([HOST, 'site-2'].sort())
  })

  it('records a lead’s opt-in for the site alone without it', async () => {
    mockConsentGroups = NORTHWIND
    await captureContactForCrm(request({ surface: 'lead', marketingConsent: true }))
    expect(leadSites()).toEqual([HOST])
  })

  it('hands the key to the contact writer when the capture lands on a contact', async () => {
    await captureContactForCrm(
      request({ surface: 'touch', marketingConsent: true, disclosedConsentGroup: 'k-1' }),
    )
    expect(contactCaptures).toHaveLength(1)
    expect(contactCaptures[0]).toMatchObject({
      marketingConsent: true,
      disclosedConsentGroup: 'k-1',
    })
  })

  it('THE CONTROL: a surface that sends no key hands none on', async () => {
    await captureContactForCrm(request({ surface: 'touch', marketingConsent: true }))
    expect(contactCaptures[0]).not.toHaveProperty('disclosedConsentGroup')
  })
})
