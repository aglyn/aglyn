/**
 * An open lead is closed as converted when its person becomes a
 * relationship on their own (AGL-3232) — and only an OPEN one.
 */

const docs = new Map<string, Record<string, any>>()

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { serverTimestamp: () => ({ __serverTimestamp: true }) },
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  getOrgForHost: async (hostId: string) => (hostId === 'site-1' ? { orgId: 'org-1', org: {} } : null),
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collection: (name: string) => ({
          doc: (hostId: string) => ({
            collection: (sub: string) => ({
              doc: (id: string) => {
                const path = `${name}/${hostId}/${sub}/${id}`
                return {
                  get: async () => ({
                    exists: docs.has(path),
                    data: () => docs.get(path),
                  }),
                  set: async (value: Record<string, any>, options?: { merge?: boolean }) => {
                    docs.set(path, options?.merge ? { ...(docs.get(path) ?? {}), ...value } : value)
                  },
                }
              },
            }),
          }),
        }),
      }),
    }),
  },
}))

const handOffs: Array<Record<string, unknown>> = []
jest.mock('./hand-off-lead', () => ({
  __esModule: true,
  handOffLeadRecords: async (input: Record<string, unknown>) => {
    handOffs.push(input)
    return { activities: 0, tasks: 0, plugins: {} }
  },
}))

import { personKey } from '@aglyn/aglyn/server'
import { convertOpenLeadOntoContact } from './convert-lead-on-contact'

const HOST = 'site-1'
const EMAIL = 'dana@example.com'
const path = `hosts/${HOST}/leads/${personKey(EMAIL)}`

beforeEach(() => {
  docs.clear()
  handOffs.length = 0
})

describe('convertOpenLeadOntoContact', () => {
  it('stamps an open lead converted onto the contact, naming the door', async () => {
    docs.set(path, { email: EMAIL, status: 'working', ownerUid: 'rep' })
    await expect(
      convertOpenLeadOntoContact({ hostId: HOST, email: ' Dana@Example.com ', contactId: 'c-1', by: 'signup' }),
    ).resolves.toBe(true)
    expect(docs.get(path)).toMatchObject({
      status: 'qualified',
      convertedContactId: 'c-1',
      convertedBy: 'signup',
      ownerUid: 'rep',
    })
    expect(typeof docs.get(path)?.convertedAtMs).toBe('number')
    // …and hands what was filed on the lead to the contact (AGL-3233).
    expect(handOffs).toEqual([
      expect.objectContaining({
        orgId: 'org-1',
        hostId: HOST,
        leadId: personKey(EMAIL),
        contactId: 'c-1',
        email: EMAIL,
        by: 'signup',
      }),
    ])
  })

  it('reads a lead with no status as open, the way the list does', async () => {
    docs.set(path, { email: EMAIL })
    await expect(
      convertOpenLeadOntoContact({ hostId: HOST, email: EMAIL, contactId: 'c-1', by: 'purchase' }),
    ).resolves.toBe(true)
    expect(docs.get(path)?.convertedBy).toBe('purchase')
  })

  it('leaves a converted lead naming its contact, and an unqualified one closed', async () => {
    docs.set(path, { email: EMAIL, status: 'qualified', convertedContactId: 'c-0' })
    await expect(
      convertOpenLeadOntoContact({ hostId: HOST, email: EMAIL, contactId: 'c-1', by: 'signup' }),
    ).resolves.toBe(false)
    expect(docs.get(path)?.convertedContactId).toBe('c-0')

    docs.set(path, { email: EMAIL, status: 'unqualified', unqualifiedReason: 'Not a fit' })
    await expect(
      convertOpenLeadOntoContact({ hostId: HOST, email: EMAIL, contactId: 'c-1', by: 'signup' }),
    ).resolves.toBe(false)
    expect(docs.get(path)?.status).toBe('unqualified')
    expect(handOffs).toEqual([])
  })

  it('answers false for no lead, an unreadable address or no contact, and never throws', async () => {
    await expect(
      convertOpenLeadOntoContact({ hostId: HOST, email: EMAIL, contactId: 'c-1', by: 'signup' }),
    ).resolves.toBe(false)
    await expect(
      convertOpenLeadOntoContact({ hostId: HOST, email: 'nope', contactId: 'c-1', by: 'signup' }),
    ).resolves.toBe(false)
    await expect(
      convertOpenLeadOntoContact({ hostId: HOST, email: EMAIL, contactId: '', by: 'signup' }),
    ).resolves.toBe(false)
  })
})
