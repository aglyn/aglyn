/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored, and this suite needs `Request`/`Response`.
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

/**
 * A LOCKED ACCOUNT GETS NO USAGE ALERT (AGL-3418).
 *
 * A risk-locked owner was sent "You've reached your sites limit" by the
 * 08:00 UTC sweep the morning after the lock notice. The fan-out now drops
 * an owner or admin under an active user lock or with a disabled Auth
 * record, and sends nothing for a suspended workspace. Runs the REAL
 * `orgAdminEmails` / `emailOrgAdmins` and the REAL gate; only the lock
 * record and the Auth directory are held.
 */

import { fakeFirestore } from '@aglyn/tenant-data-admin/server/test-firestore'

const mockSent: Array<Record<string, any>> = []
const mockLocks = new Map<string, { untilMs?: number }>()
const mockDisabled = new Set<string>()

jest.mock('@aglyn/shared-util-email', () => ({
  ...jest.requireActual('@aglyn/shared-util-email'),
  isEmailConfigured: () => true,
  sendEmail: async (message: Record<string, unknown>) => {
    mockSent.push(message)
    return { sent: true, id: 'email_1' }
  },
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  findUserByUidAcrossPools: async (uid: string) => ({
    record: { uid, email: `${uid}@example.com`, disabled: mockDisabled.has(uid) },
    tenantId: null,
  }),
  meterPlatformEmail: async () => undefined,
}))

jest.mock('@aglyn/tenant-data-admin/server/lockdown', () => ({
  __esModule: true,
  getUserLockdown: async (uid: string) => mockLocks.get(uid) ?? null,
}))

jest.mock('@aglyn/tenant-data-admin/server/auth-pools', () => ({
  __esModule: true,
  findUserByUidAcrossPools: async (uid: string) => ({
    record: { uid, email: `${uid}@example.com`, disabled: mockDisabled.has(uid) },
    tenantId: null,
  }),
}))

import { emailOrgAdmins, orgAdminEmails } from '../app/api/_lib/usage-alert-email'

const ORG = 'org-1'

function store(org: Record<string, unknown> = {}) {
  const flat = fakeFirestore({
    orgs: { [ORG]: { name: 'Acme', ...org } },
    [`orgs/${ORG}/members`]: {
      owner: { role: 'owner', email: 'owner@example.com' },
      admin: { role: 'admin', email: 'admin@example.com' },
      editor: { role: 'editor', email: 'editor@example.com' },
    },
  }) as any
  // `orgAdminEmails` walks `orgs/{id}/members`; the fake keys collections by
  // their flat path.
  return {
    ...flat,
    collection: (name: string) =>
      name === 'orgs'
        ? {
            doc: (orgId: string) => ({
              get: () => flat.collection('orgs').doc(orgId).get(),
              collection: (sub: string) => flat.collection(`orgs/${orgId}/${sub}`),
            }),
          }
        : flat.collection(name),
  }
}

const alert = (firestore: unknown) =>
  emailOrgAdmins({
    firestore: firestore as never,
    orgId: ORG,
    subject: "You've reached your sites limit",
    text: 'Body',
    context: 'usage-alert',
  })

beforeEach(() => {
  mockSent.length = 0
  mockLocks.clear()
  mockDisabled.clear()
})

it('PREMISE: mails every owner and admin when nobody is locked', async () => {
  expect(await orgAdminEmails(store() as never, ORG)).toEqual([
    'owner@example.com',
    'admin@example.com',
  ])
  expect(await alert(store())).toMatchObject({ sent: true })
  expect(mockSent[0]['to']).toEqual(['owner@example.com', 'admin@example.com'])
})

it('drops an owner under an active user lock', async () => {
  mockLocks.set('owner', {})
  expect(await orgAdminEmails(store() as never, ORG)).toEqual(['admin@example.com'])
})

it('mails an owner whose lock has expired', async () => {
  mockLocks.set('owner', { untilMs: Date.now() - 60_000 })
  expect(await orgAdminEmails(store() as never, ORG)).toContain('owner@example.com')
})

it('drops an admin whose Auth record is disabled', async () => {
  mockDisabled.add('admin')
  expect(await orgAdminEmails(store() as never, ORG)).toEqual(['owner@example.com'])
})

it('sends nothing when every owner and admin is locked', async () => {
  mockLocks.set('owner', {})
  mockDisabled.add('admin')
  expect(await alert(store())).toEqual({ sent: false, reason: 'no-recipient' })
  expect(mockSent).toEqual([])
})

it('sends nothing for a suspended workspace', async () => {
  expect(await alert(store({ suspendedAt: 1_700_000_000_000 }))).toEqual({
    sent: false,
    reason: 'no-recipient',
  })
  expect(mockSent).toEqual([])
})
