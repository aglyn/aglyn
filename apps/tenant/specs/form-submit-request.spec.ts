/**
 * @jest-environment node
 *
 * The pragma must stay in the FIRST block comment: behind the license
 * header jest silently ignores it and this runs on jsdom, where `Request`
 * is not a constructor and every case fails for the wrong reason.
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
 * A REQUEST FORM'S SUBMISSION (AGL-4098): its files, read back from the key
 * the page sent them under and recorded by name; the `request` a form marked
 * "This form asks for a quote" stamps; a field's machine value kept apart from
 * its answer; and the confirmation's conversation kept on the submission.
 *
 * (The harness below is the submit route's own, as `form-submit-form-id.spec.ts`
 * builds it.)
 *
 * A submission carries the id of the form it was sent to.
 *
 * The identity a form had before this was `formName` — the caption an author
 * typed into an inspector field. Renaming a form split its submission history
 * in two, and two pages sharing a label had always been one list. Neither is
 * a bug in any single surface: `?form=Contact` filters on exactly what was
 * recorded. The recorded thing was a caption.
 *
 * The two assertions that carry the feature are the rename (history must not
 * split) and the refusal to trust the id a public body sent.
 */

const HOST_ID = 'site-1'

let mockStore: Record<string, Record<string, any>> = {}
/** Every document the route added, by collection path. */
let mockAdds: Array<{ path: string; data: Record<string, any> }> = []
/** Every `update` the route issued, by document path. */
let mockUpdates: Array<{ path: string; patch: Record<string, any> }> = []
let mockContactUpserts: Record<string, any>[] = []
/** Every `addHostLead` call the route made. */
let mockLeads: Record<string, any>[] = []
/** What the lead writer answers: stored, or refused/failed. */
let mockLeadStored = true
/** Whether the stored lead is new to the form's source (AGL-3330). */
let mockSourceAdded = true
/** Every host event the route announced: its type and its payload. */
let mockEvents: Array<{ event: string; payload: Record<string, any> }> = []
/** Every document the route CREATED by id, by path. */
let mockCreates: Array<{ path: string; data: Record<string, any> }> = []
/** Every document the route deleted. */
let mockDeletes: string[] = []
/** The kept files the upload pipeline answers, by id. */
let mockKeptFiles: Record<string, Record<string, any>> = {}
/** The confirmation sends the route asked for. */
let mockConfirmations: Array<Record<string, any>> = []

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    increment: (by: number) => ({ __increment: by }),
    serverTimestamp: () => 'server-timestamp',
  },
}))

const mockDocHandle = (path: string): any => ({
  id: path.split('/').pop(),
  get ref() {
    return mockDocHandle(path)
  },
  get: async () => {
    const data = mockStore[path]
    return {
      exists: data !== undefined,
      id: path.split('/').pop(),
      ref: mockDocHandle(path),
      data: () => data,
      get: (field: string) => data?.[field],
    }
  },
  set: async (patch: Record<string, any>, options?: { merge?: boolean }) => {
    mockStore[path] = {
      ...(options?.merge ? (mockStore[path] ?? {}) : {}),
      ...patch,
    }
  },
  update: async (patch: Record<string, any>) => {
    // Mirrors Firestore: `update` on a missing document REJECTS. The stats
    // write depends on that — it is what stops a stale page resurrecting a
    // deleted form as a stats-only stray doc.
    if (mockStore[path] === undefined) throw new Error('NOT_FOUND')
    mockUpdates.push({ path, patch })
    mockStore[path] = { ...mockStore[path], ...patch }
  },
  create: async (data: Record<string, any>) => {
    if (mockStore[path] !== undefined) throw Object.assign(new Error('ALREADY_EXISTS'), { code: 6 })
    mockCreates.push({ path, data })
    mockStore[path] = { ...data }
  },
  delete: async () => {
    mockDeletes.push(path)
    delete mockStore[path]
  },
  collection: (name: string) => mockCollectionHandle(`${path}/${name}`),
})

const mockCollectionHandle = (path: string): any => ({
  doc: (id: string) => mockDocHandle(`${path}/${id}`),
  add: async (data: Record<string, any>) => {
    mockAdds.push({ path, data })
    return { id: 'submission-1', update: async () => undefined }
  },
})

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  /*
   * The lead lookup the CRM's capture door runs (AGL-3275). These files drive
   * a form submission end to end, so the door is real and its seam has to
   * answer; what they assert is the CAMPAIGN and consent bookkeeping, and no
   * case here starts with a lead already on file.
   */
  readLeadForHost: async () => null,
  // The CRM's capture writer asks whether the workspace already holds the
  // address as a contact before it files a lead (AGL-3232). Nobody, here.
  findContactByEmail: async () => null,
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collection: (name: string) => mockCollectionHandle(name),
      }),
    }),
  },
  consumeRateLimit: async () => ({
    allowed: true,
    limit: 10,
    remaining: 9,
    resetMs: Date.now() + 30_000,
    degraded: false,
  }),
  getOrgForHost: async () => ({ org: { plan: 'business' } }),
  notifyHostManagers: async () => undefined,
  orgDataCollectionForHost: async () =>
    mockCollectionHandle('orgs/org-1/datasets'),
  dataStorageRefusal: async () => null,
  upsertHostContact: async (options: Record<string, any>) => {
    mockContactUpserts.push(options)
  },
  // Recorded rather than executed. `host-lead-dedupe.spec.ts` owns what the
  // writer does with a capture; what matters HERE is whether this route hands
  // one over at all, which it never did.
  //
  // The ANSWER is settable because the route now counts it: `false` is the
  // ceiling refusal and every failure the writer swallows, and a form's lead
  // counter must not move on either.
  addHostLead: async (options: Record<string, any>) => {
    mockLeads.push(options)
    return mockLeadStored
  },
  // What the CRM's form door asks (AGL-3330): whether the lead was stored,
  // and whether this form's source was new on it — the form counts people.
  addHostLeadOutcome: async (options: Record<string, any>) => {
    mockLeads.push(options)
    return {
      stored: mockLeadStored,
      created: mockLeadStored && mockSourceAdded,
      sourceAdded: mockLeadStored && mockSourceAdded,
    }
  },
  visitorWriteRefusal: async () => null,
}))

jest.mock('../../../libs/plugins/forms/src/lib/server/form-uploads', () => ({
  formUploadCalls: () => ({
    read: async (_scope: unknown, id: string) => mockKeptFiles[id] ?? null,
  }),
}))

jest.mock('../../../libs/plugins/forms/src/lib/server/form-confirmation-email', () => ({
  sendFormConfirmation: async (input: Record<string, any>) => {
    mockConfirmations.push(input)
    return {
      sent: true,
      messageId: '<form.abc.0123456789abcdef@mail.site.example>',
      providerId: 'provider-1',
      subject: 'Your quote request with Site',
      thread: {
        messageId: '<form.abc.0123456789abcdef@mail.site.example>',
        references: ['<form.abc.0123456789abcdef@mail.site.example>'],
        subject: 'Your quote request with Site',
      },
    }
  },
}))

jest.mock('@aglyn/tenant-runtime', () => ({
  // Every server door captures through `captureHostContact` (AGL-2605), which
  // is `upsertHostContact` plus the contactCreated announcement. The stub
  // hands the call to whichever double this spec keeps for the writer — the
  // runtime mock's own, or the data-admin mock's when the spec doubles the
  // data layer instead — so assertions on its options read the same calls.
  captureHostContact: (...args: unknown[]) => {
    const runtime = jest.requireMock('@aglyn/tenant-runtime') as {
      upsertHostContact?: (...a: unknown[]) => unknown
    }
    const dataAdmin = jest.requireMock('@aglyn/tenant-data-admin') as {
      upsertHostContact?: (...a: unknown[]) => unknown
    }
    return (runtime.upsertHostContact ?? dataAdmin.upsertHostContact)?.(...args)
  },
  __esModule: true,
  emitHostEvent: async (_hostId: string, event: string, payload: Record<string, any>) => {
    mockEvents.push({ event, payload })
    return { alerts: [] }
  },
  resolveDatasetDoc: async () => null,
}))

/*
 * The route captures through the platform's contact-capture contract now
 * (AGL-3080), and the plugin that keeps people is what calls
 * `captureHostContact` from its own module, which the barrel double above
 * does not intercept; this forwards that module to the same double.
 *
 * Deliberately not a double of the contract itself. Every assertion below is
 * on the options the writer receives, so routing them through the real CRM
 * adapter is what proves the translation from the contract's vocabulary to
 * this one loses nothing — which is the half of this move that could fail
 * silently.
 */
/*
 * The `lead` host event a NEW lead announces itself with (AGL-3232), by the
 * leaf the CRM's writer imports it from. Recorded as nothing: what a lead
 * sets off is the automation engine's own spec.
 */
jest.mock('@aglyn/tenant-runtime/emit-host-event', () => ({
  __esModule: true,
  emitHostEvent: async () => ({ alerts: [] }),
}))

jest.mock('../../../libs/plugins/crm/src/lib/server/capture-host-contact', () => ({
  captureHostContact: (...args: unknown[]) =>
    (
      jest.requireMock('@aglyn/tenant-runtime') as {
        captureHostContact: (...a: unknown[]) => unknown
      }
    ).captureHostContact(...args),
}))

/*
 * The CRM registers its writer from the app's own boot manifest. Without it
 * `capturePluginContact` answers `null` — "this workspace keeps no records" —
 * and every assertion below would be measuring a capture that never happened.
 */
beforeAll(async () => {
  const { registerPluginServerDeclarations } = await import(
    '../utils/plugins.declarations.server.generated'
  )
  await registerPluginServerDeclarations()
})

// The door as the tenant serves it: the forms plugin's route, through the
// plugin API dispatcher, with the forms plugin's surface loaded (AGL-3080).
jest.mock('../utils/server-plugin-loader', () => ({
  serverPluginLoader: jest.requireActual('./plugin-door-dispatch').formsOnlyServerPluginLoader(),
}))
import { POST } from './plugin-door-dispatch'

const submit = (body: Record<string, unknown> = {}) =>
  POST(
    new Request('https://site.example/api/forms/submit', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '203.0.113.9',
      },
      body: JSON.stringify({
        hostId: HOST_ID,
        formName: 'Contact',
        path: '/contact',
        fields: { email: 'visitor@example.com', message: 'hello' },
        ...body,
      }),
    }),
  ) as Promise<Response>

/** The one submission the route wrote. */
const written = () =>
  mockAdds.find((add) => add.path === `hosts/${HOST_ID}/formSubmissions`)?.data

beforeEach(() => {
  mockStore = { [`hosts/${HOST_ID}`]: { name: 'Site' } }
  mockAdds = []
  mockUpdates = []
  mockContactUpserts = []
  mockLeads = []
  mockLeadStored = true
  mockSourceAdded = true
  mockEvents = []
  mockCreates = []
  mockDeletes = []
  mockKeptFiles = {}
  mockConfirmations = []
})

const KEY = 'd'.repeat(32)
const FORM = `hosts/${HOST_ID}/forms/quote-form`
const MARKER = `${FORM}/formUploadKeys/${KEY}`

function quoteForm(over: Record<string, any> = {}) {
  mockStore[FORM] = {
    displayName: 'Request a quote',
    slug: 'request-a-quote',
    request: { kind: 'quote' },
    fields: [
      { fieldName: 'email', fieldType: 'email' },
      { fieldName: 'artwork', fieldType: 'file', fileKinds: ['images', 'design'], maxFiles: 3 },
      { fieldName: 'product', fieldType: 'product' },
    ],
    ...over,
  }
  mockStore[MARKER] = { hostId: HOST_ID, formId: 'quote-form', key: KEY, files: { f1: 'artwork' } }
  mockKeptFiles = {
    f1: { id: 'f1', name: 'logo.ai', contentType: 'application/illustrator', size: 900, path: `hosts/${HOST_ID}/private/uploads/form-file/${KEY}/f1`, uploadedAtMs: 4 },
  }
}

const QUOTE_FIELDS = {
  email: 'visitor@example.com',
  message: 'Two banners',
  artwork: 'whatever the page said',
  product: 'Vinyl banner — Matte',
  product__data: '{"productId":"p1","variantId":"v2"}',
}

describe('a quote request with files (AGL-4098)', () => {
  it('takes its key as its id, records the files by name, and stamps the request the form asks', async () => {
    quoteForm()
    const response = await submit({
      formId: 'quote-form',
      fields: QUOTE_FIELDS,
      files: { key: KEY, refs: [{ field: 'artwork', id: 'f1' }] },
    })
    expect(response.status).toBe(200)
    const created = mockCreates.find((entry) => entry.path === `hosts/${HOST_ID}/formSubmissions/${KEY}`)?.data
    expect(created?.['files']).toEqual([
      { id: 'f1', field: 'artwork', name: 'logo.ai', contentType: 'application/illustrator', size: 900, uploadedAtMs: 4 },
    ])
    expect(created?.['request']).toEqual({ kind: 'quote' })
    // The field's answer is the kept file's name, not what the page said.
    expect(created?.['fields']['artwork']).toBe('logo.ai')
    // The machine value is kept apart from the answers a person reads.
    expect(created?.['fieldData']).toEqual({ product: '{"productId":"p1","variantId":"v2"}' })
    expect(created?.['fields']).not.toHaveProperty('product__data')
    expect(created?.['fields']['product']).toBe('Vinyl banner — Matte')
    // Nothing went through `add`, and the key's upload record is released.
    expect(mockAdds.filter((add) => add.path.endsWith('formSubmissions'))).toEqual([])
    expect(mockDeletes).toContain(MARKER)
  })

  it('refuses a file id the key does not hold, before anything is written or counted', async () => {
    quoteForm()
    const response = await submit({
      formId: 'quote-form',
      fields: QUOTE_FIELDS,
      files: { key: KEY, refs: [{ field: 'artwork', id: 'not-uploaded' }] },
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'One of your files didn’t arrive. Remove it, attach it again and send the form.',
      code: 'files',
    })
    expect(mockCreates).toEqual([])
    expect(mockAdds).toEqual([])
    expect(mockStore[`hosts/${HOST_ID}/counters/formSubmissions`]).toBeUndefined()
  })

  it('refuses files for a form no entity binds, and a malformed list', async () => {
    quoteForm()
    expect(
      (await submit({ fields: QUOTE_FIELDS, files: { key: KEY, refs: [{ field: 'artwork', id: 'f1' }] } })).status,
    ).toBe(400)
    expect((await submit({ formId: 'quote-form', fields: QUOTE_FIELDS, files: { key: 'x', refs: [] } })).status).toBe(400)
    expect(mockCreates).toEqual([])
  })

  it('answers a page that sends twice as received, and writes nothing over the first', async () => {
    quoteForm()
    const body = { formId: 'quote-form', fields: QUOTE_FIELDS, files: { key: KEY, refs: [{ field: 'artwork', id: 'f1' }] } }
    await submit(body)
    mockStore[MARKER] = { hostId: HOST_ID, formId: 'quote-form', key: KEY, files: { f1: 'artwork' } }
    const again = await submit(body)
    expect(await again.json()).toEqual({ received: true })
    expect(mockCreates).toHaveLength(1)
  })
})

describe('the confirmation a request sends (AGL-4098)', () => {
  it('is sent for a request form by default, and its conversation is kept on the submission', async () => {
    quoteForm()
    await submit({ formId: 'quote-form', fields: QUOTE_FIELDS, files: { key: KEY, refs: [{ field: 'artwork', id: 'f1' }] } })
    expect(mockConfirmations).toHaveLength(1)
    expect(mockConfirmations[0]).toMatchObject({
      hostId: HOST_ID,
      to: 'visitor@example.com',
      request: { kind: 'quote' },
      fileNames: ['logo.ai'],
    })
    // The form's name is the business's internal label: the customer's email never gets it.
    expect(mockConfirmations[0]).not.toHaveProperty('formName')
    const thread = mockUpdates.find((update) => update.path === `hosts/${HOST_ID}/formSubmissions/${KEY}` && update.patch['emailThread'])
    expect(thread?.patch['emailThread']).toEqual({
      messageId: '<form.abc.0123456789abcdef@mail.site.example>',
      references: ['<form.abc.0123456789abcdef@mail.site.example>'],
      subject: 'Your quote request with Site',
    })
    expect(thread?.patch['confirmation']).toMatchObject({ to: 'visitor@example.com' })
  })

  it('is not sent by an ordinary form, nor by a request form switched off', async () => {
    mockStore[`hosts/${HOST_ID}/forms/contact`] = { displayName: 'Contact', fields: [{ fieldName: 'email', fieldType: 'email' }] }
    await submit({ formId: 'contact' })
    quoteForm({ confirmationEmail: false })
    await submit({ formId: 'quote-form', fields: { email: 'visitor@example.com', message: 'hi' } })
    expect(mockConfirmations).toEqual([])
  })

  it('an ordinary form’s submission carries no request, whatever its fields say', async () => {
    mockStore[`hosts/${HOST_ID}/forms/contact`] = { displayName: 'Contact', fields: [{ fieldName: 'email', fieldType: 'email' }] }
    await submit({ formId: 'contact', fields: { email: 'visitor@example.com', message: 'hi', request: 'quote' } })
    expect(written()?.['request']).toBeUndefined()
  })
})
