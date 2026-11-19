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
 * A new account's contact in the operator's own CRM is filed the way any
 * other captured contact is (AGL-4230).
 *
 * The sign-up writer lives in core and may not import this plugin, so it
 * reaches the CRM through the contact-capture seam. This file drives that
 * whole path with the REAL pieces: core's `recordPlatformAccountContact`,
 * the seam's registry and `recordCapturedContact`, and the CRM's own writer
 * and `captureHostContact` door. Only the storage under them and the two
 * steps that write the company and the owner are doubles, and those steps'
 * own rules are pinned in `associate-company-by-domain.spec.ts` and
 * `assign-contact-owner.spec.ts`. What is claimed here is that a sign-up
 * reaches them at all, which before this it did not.
 */

const ORG = 'org-operator'
const HOST = 'site-marketing'
const CREATED_AT = Date.UTC(2026, 10, 13, 15)

/** Every write the data library's capture door was handed. */
const upserts: Array<Record<string, any>> = []
const associateCompanyByDomain = jest.fn<Promise<unknown>, [unknown]>(
  async () => ({
    outcome: 'linked',
    companyId: 'co-acme-dental',
  }),
)
const assignOwnerForCapture = jest.fn<Promise<unknown>, [unknown]>(
  async () => ({
    outcome: 'assigned',
    ownerUid: 'uid-site-default-owner',
    by: 'default',
    leadMirrored: false,
    notified: true,
  }),
)
const events: Array<{ event: string; payload: Record<string, unknown> }> = []
const conversions: Array<Record<string, unknown>> = []
const origins: Array<Record<string, unknown>> = []

/** The data library's capture door: a new person each time, reported once. */
async function upsertHostContact(options: Record<string, any>) {
  upserts.push(options)
  const contactId = `contact-${upserts.length}`
  await options['onCreated']?.({
    contactId,
    hostId: options['hostId'],
    email: String(options['email']).trim().toLowerCase(),
    ...(options['name'] ? { name: options['name'] } : {}),
    source: options['source'],
    campaignIds: [],
    ...(options['initialLifecycleStage']
      ? { lifecycleStage: options['initialLifecycleStage'] }
      : {}),
  })
  return { contactId, created: true }
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  upsertHostContact: (options: Record<string, any>) => upsertHostContact(options),
}))
jest.mock('./associate-company-by-domain', () => ({
  __esModule: true,
  associateCompanyByDomain: (created: unknown) => associateCompanyByDomain(created),
}))
jest.mock('./assign-contact-owner', () => ({
  __esModule: true,
  assignOwnerForCapture: (input: unknown) => assignOwnerForCapture(input),
}))
jest.mock('./record-origin', () => ({
  __esModule: true,
  crmRecordOriginWriter: {
    stamp: async (input: Record<string, unknown>) => {
      origins.push(input)
      return { records: 1 }
    },
  },
}))
jest.mock('./convert-open-lead', () => ({
  __esModule: true,
  convertOpenLeadOntoContact: async (input: Record<string, unknown>) => {
    conversions.push(input)
    return false
  },
}))
jest.mock('@aglyn/tenant-runtime/emit-host-event', () => ({
  __esModule: true,
  emitHostEvent: async (
    _hostId: string,
    event: string,
    payload: Record<string, unknown>,
  ) => {
    events.push({ event, payload })
    return { alerts: [] }
  },
}))

/*
 * The core writer's own neighbours, by the relative paths it imports them
 * through: storage this file has no business reaching.
 */
const CORE = '../../../../../tenant/data/admin/src/lib/server'
jest.mock('../../../../../tenant/data/admin/src/lib/server/firebase-admin', () => ({
  __esModule: true,
  default: { app: () => ({ firestore: () => undefined }) },
}))
jest.mock('../../../../../tenant/data/admin/src/lib/server/upsert-contact', () => ({
  __esModule: true,
  // The direct write is the fallback for a process with no record plugin;
  // reaching it here would mean the seam was skipped.
  upsertHostContact: async () => {
    throw new Error('the sign-up bypassed the capture seam')
  },
}))
jest.mock('../../../../../tenant/data/admin/src/lib/server/organizations', () => ({
  __esModule: true,
  resolveOrgIdForHost: async () => ORG,
  getOrgForHost: async () => null,
  consentGroupForSite: async () => null,
}))

import {
  registerPluginContactCaptureWriter,
} from '@aglyn/aglyn/plugin-manager/plugin-contact-capture'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import type {
  PlatformMarketingContactOutcome,
  RecordPlatformAccountContactInput,
} from '@aglyn/tenant-data-admin'
import { crmContactCaptureWriter } from '../declarations.server'

// The real writer, by its own path: the barrel is doubled above.
const { recordPlatformAccountContact } = jest.requireActual(
  `${CORE}/platform-marketing-consent`,
) as {
  recordPlatformAccountContact: (
    input: RecordPlatformAccountContactInput,
  ) => Promise<PlatformMarketingContactOutcome>
}

/** A users collection holding the one account, as the sign-up left it. */
function accountStore(fields: Record<string, unknown>) {
  return {
    collection: () => ({
      doc: () => ({
        get: async () => ({ exists: true, get: (field: string) => fields[field] }),
      }),
    }),
  }
}

const signUp = (email: string, fields: Record<string, unknown> = {}) =>
  recordPlatformAccountContact({
    uid: 'uid-new-account',
    email,
    createdAtMs: CREATED_AT,
    hostId: HOST,
    firestore: accountStore(fields),
  })

beforeEach(() => {
  resetPluginServicesForTests()
  registerPluginContactCaptureWriter(crmContactCaptureWriter, { pluginId: 'crm' })
  upserts.length = 0
  events.length = 0
  conversions.length = 0
  origins.length = 0
  associateCompanyByDomain.mockClear()
  assignOwnerForCapture.mockClear()
})

describe('a new account in the operator’s CRM (AGL-4230)', () => {
  it('links a business-domain sign-up to its company and gives it an owner', async () => {
    const result = await signUp('Office@Acme-Dental.example', {
      firstName: 'Jordan',
      lastName: 'Lee',
    })

    expect(result).toEqual({ status: 'recorded', contactId: 'contact-1', created: true })
    // One contact, as before: the account's source, its timeline row, the
    // lead floor, and no consent either way.
    expect(upserts).toHaveLength(1)
    expect(upserts[0]).toMatchObject({
      hostId: HOST,
      email: 'Office@Acme-Dental.example',
      name: 'Jordan Lee',
      source: 'account',
      interaction: { atMs: CREATED_AT, summary: 'Created an account' },
      initialLifecycleStage: 'lead',
    })
    expect(upserts[0]).not.toHaveProperty('marketingConsent')

    // The company at the address's domain, for the new contact.
    expect(associateCompanyByDomain).toHaveBeenCalledTimes(1)
    expect(associateCompanyByDomain).toHaveBeenCalledWith(
      expect.objectContaining({
        hostId: HOST,
        contactId: 'contact-1',
        email: 'office@acme-dental.example',
        source: 'account',
      }),
    )
    await expect(associateCompanyByDomain.mock.results[0]?.value).resolves.toEqual({
      outcome: 'linked',
      companyId: 'co-acme-dental',
    })

    // And an owner, by the org's rules or the site's default owner.
    expect(assignOwnerForCapture).toHaveBeenCalledTimes(1)
    expect(assignOwnerForCapture).toHaveBeenCalledWith({
      hostId: HOST,
      contactId: 'contact-1',
      email: 'office@acme-dental.example',
      source: 'account',
      formId: null,
      tags: undefined,
    })
    await expect(assignOwnerForCapture.mock.results[0]?.value).resolves.toMatchObject({
      outcome: 'assigned',
      ownerUid: 'uid-site-default-owner',
    })

    // The company is filed before the owner is decided, and both before
    // anything reacting to the new contact hears of it.
    expect(associateCompanyByDomain.mock.invocationCallOrder[0]).toBeLessThan(
      assignOwnerForCapture.mock.invocationCallOrder[0] as number,
    )
    expect(events.map((one) => one.event)).toEqual(['contactCreated'])
    expect(events[0]?.payload).toMatchObject({
      contactId: 'contact-1',
      source: 'account',
      hostId: HOST,
      lifecycleStage: 'lead',
    })
  })

  it('files the account as a contact and converts a lead the site already held', async () => {
    await signUp('office@acme-dental.example')
    // A relationship capture: an open lead for the address becomes this
    // contact, the way a member account's does.
    expect(conversions).toEqual([
      {
        hostId: HOST,
        email: 'office@acme-dental.example',
        contactId: 'contact-1',
        by: 'signup',
      },
    ])
    // Where the person came from, first touch only, as before.
    expect(origins).toEqual([
      {
        hostId: HOST,
        email: 'office@acme-dental.example',
        origin: 'account',
        firstTouchOnly: true,
      },
    ])
  })

  it('still assigns an owner to a public-mailbox sign-up', async () => {
    associateCompanyByDomain.mockResolvedValueOnce({ outcome: 'none', reason: 'no-domain' })
    const result = await signUp('someone@gmail.com')
    expect(result).toMatchObject({ status: 'recorded', created: true })
    await expect(associateCompanyByDomain.mock.results[0]?.value).resolves.toEqual({
      outcome: 'none',
      reason: 'no-domain',
    })
    expect(assignOwnerForCapture).toHaveBeenCalledTimes(1)
  })
})
