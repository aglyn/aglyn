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
 *
 * @jest-environment node
 */

/**
 * A GIFT CARD SENT BY HAND (AGL-3432).
 *
 * A merchant types any address into the console and the card goes to someone
 * who may never have heard of the store. The email opened on a bare code, named
 * no store, linked nowhere, and dropped the note the merchant wrote — and on a
 * workspace without white-label it arrives from "Aglyn". These assert the email
 * the recipient actually reads: the built-in copy, rendered.
 */

const docs = new Map<string, Record<string, unknown>>()
const sent: Array<Record<string, unknown>> = []

function docRef(path: string): any {
  return {
    get: async () => ({
      exists: docs.has(path),
      data: () => docs.get(path),
      get: (field: string) => docs.get(path)?.[field],
    }),
    set: async (value: Record<string, unknown>) => {
      docs.set(path, { ...(docs.get(path) ?? {}), ...value })
    },
    collection: (name: string) => ({
      doc: (id: string) => docRef(`${path}/${name}/${id}`),
    }),
  }
}

jest.mock('@aglyn/aglyn/server', () => ({
  checkEntitlement: () => true,
  resolveBrandingProfile: () => ({ fromName: 'Aglyn' }),
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: async () => ({ uid: 'admin-1' }) }),
      firestore: () => ({
        collection: (name: string) => ({
          doc: (id: string) => docRef(`${name}/${id}`),
        }),
      }),
    }),
  },
  getOrgForHost: async () => ({ org: { plan: 'business' } }),
  hostSendingIdentity: async () => ({ from: 'hello@northwind.example' }),
  meterHostEmail: async () => undefined,
  // The site's built-in copy, rendered for real, with the site's own tokens.
  renderHostEmailWithTokens: async (
    _firestore: unknown,
    _hostId: string,
    key: string,
    merge: Record<string, string>,
  ) => {
    const email = jest.requireActual('@aglyn/shared-util-email')
    const entry = email.getTenantEmail(key)
    const values = {
      'host.businessName': 'Northwind Coffee',
      'host.url': 'https://northwind.example',
      ...merge,
    }
    const rendered = email.renderEmailHtml({
      nodes: email.buildDefaultEmailNodeMap(entry),
      rootId: email.EMAIL_NODE_ROOT_ID,
      merge: values,
      sanitize: (html: string) => html,
    })
    return {
      subject: email.substituteMergeTokens(entry.defaultSubject, values),
      html: rendered.html,
      text: rendered.text,
    }
  },
}))

jest.mock('@aglyn/shared-util-email', () => ({
  isEmailConfigured: () => true,
  sendEmail: async (message: Record<string, unknown>) => {
    sent.push(message)
    return { sent: true }
  },
}))

import { giftCardsHandler } from './gift-cards'

async function issue(body: Record<string, unknown>) {
  const res: any = {
    statusCode: 0,
    status(code: number) {
      res.statusCode = code
      return res
    },
    json(payload: unknown) {
      res.body = payload
      return res
    },
  }
  await giftCardsHandler(
    {
      method: 'POST',
      headers: { authorization: 'Bearer token' },
      body: { hostId: 'host-1', action: 'issue', amountCents: 2500, ...body },
    } as any,
    res,
  )
  return res
}

beforeEach(() => {
  docs.clear()
  sent.length = 0
  docs.set('hosts/host-1', { memberRoles: { 'admin-1': 'admin' } })
})

describe('a gift card issued by hand (AGL-3432)', () => {
  it('names the store, links to it, and carries the merchant’s note', async () => {
    const res = await issue({
      recipientEmail: 'sam@example.com',
      note: 'Happy birthday, Sam!',
    })
    expect(res.statusCode).toBe(200)
    expect(sent).toHaveLength(1)
    expect(sent[0]['to']).toBe('sam@example.com')
    expect(sent[0]['subject']).toBe('Your gift card for Northwind Coffee')

    const text = String(sent[0]['text'])
    const code = String(res.body.code)
    expect(text).toContain(
      'You have a $25.00 gift card for Northwind Coffee.',
    )
    expect(text).toContain('Happy birthday, Sam!')
    expect(text).toContain(`Gift card code: ${code}`)
    expect(text).toContain(
      'Enter the code at checkout on https://northwind.example to use its balance.',
    )
    expect(String(sent[0]['html'])).toContain('href="https://northwind.example"')
  })

  it('leaves the note out when the merchant wrote none, rather than a blank line', async () => {
    await issue({ recipientEmail: 'sam@example.com' })
    const text = String(sent[0]['text'])
    expect(text).toContain('You have a $25.00 gift card for Northwind Coffee.')
    expect(text).not.toContain('{{')
    expect(text).not.toMatch(/\n\s*\n\s*\n/)
  })
})
