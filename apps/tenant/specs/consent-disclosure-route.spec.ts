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
 * `GET /api/consent/disclosure` — what a capture surface must say beside its
 * opt-in, and the key that proves it said it (AGL-3320).
 *
 * The sentence and the key come from ONE resolution of the site's group, the
 * real `consent-groups` module, so the key a form posts back is the one the
 * writer will compare it to. A site that sends on its own gets nothing to
 * render and nothing to post, which is every site of an org that declared no
 * group.
 */

const HOST_ID = 'site-a'

let mockOrg: Record<string, unknown> | null = null
let mockForms: Record<string, Record<string, unknown>> = {}
let mockLocked = false
let mockFormReads = 0

jest.mock('@aglyn/tenant-data-admin', () => {
  const groups = jest.requireActual('@aglyn/aglyn/app-utils/consent-groups')
  return {
    __esModule: true,
    // The real resolution over the case's org document.
    consentGroupForSite: async (hostId: string) =>
      groups.consentGroupForHost(mockOrg, hostId),
    isDocumentId: (value: unknown) =>
      typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value),
    visitorContentRefusal: async () =>
      mockLocked ? Response.json({ error: 'locked' }, { status: 503 }) : null,
    firebaseAdmin: {
      app: () => ({
        firestore: () => ({
          collection: () => ({
            doc: () => ({
              collection: () => ({
                doc: (formId: string) => ({
                  get: async () => {
                    mockFormReads += 1
                    const data = mockForms[formId]
                    return {
                      exists: data !== undefined,
                      get: (field: string) => data?.[field],
                    }
                  },
                }),
              }),
            }),
          }),
        }),
      }),
    },
  }
})

import {
  consentGroupDisclosure,
  consentGroupDisclosureKey,
  consentGroupForHost,
} from '@aglyn/aglyn/app-utils/consent-groups'
import { GET } from '../app/api/consent/disclosure/route'

const NORTHWIND = {
  consentGroups: { nw: { name: 'Northwind', hostIds: ['site-a', 'site-b'] } },
}

const ask = async (query: string) => {
  const response = await GET(
    new Request(`https://site.example/api/consent/disclosure?${query}`),
  )
  return { status: response.status, headers: response.headers, body: await response.json() }
}

beforeEach(() => {
  mockOrg = null
  mockForms = {}
  mockLocked = false
  mockFormReads = 0
})

describe('the sentence a grouped site’s forms carry', () => {
  it('answers the group’s sentence and the key of exactly that sentence', async () => {
    mockOrg = NORTHWIND
    const group = consentGroupForHost(NORTHWIND, HOST_ID)
    const { status, body } = await ask(`hostId=${HOST_ID}`)
    expect(status).toBe(200)
    expect(body).toEqual({
      fieldName: null,
      text: consentGroupDisclosure(group),
      key: consentGroupDisclosureKey(group),
    })
    expect(body.text).toContain('Northwind')
  })

  it('names the opt-in field the bound form declares', async () => {
    mockOrg = NORTHWIND
    mockForms['form-1'] = { consentFieldName: ' optIn ' }
    const { body } = await ask(`hostId=${HOST_ID}&formId=form-1`)
    expect(body.fieldName).toBe('optIn')
  })

  it('names no field for a form that declares none, or does not exist', async () => {
    mockOrg = NORTHWIND
    mockForms['form-1'] = { displayName: 'Contact' }
    expect((await ask(`hostId=${HOST_ID}&formId=form-1`)).body.fieldName).toBeNull()
    expect((await ask(`hostId=${HOST_ID}&formId=gone`)).body.fieldName).toBeNull()
  })

  it('caches briefly, since a stale answer can only narrow a grant', async () => {
    mockOrg = NORTHWIND
    const { headers } = await ask(`hostId=${HOST_ID}`)
    expect(headers.get('Cache-Control')).toBe('public, max-age=60, s-maxage=60')
  })
})

describe('a site that sends on its own', () => {
  it('THE CONTROL: has nothing to render and nothing to post', async () => {
    mockForms['form-1'] = { consentFieldName: 'optIn' }
    const { status, body } = await ask(`hostId=${HOST_ID}&formId=form-1`)
    expect(status).toBe(200)
    expect(body).toEqual({ fieldName: null, text: null, key: null })
    // Nothing to place, so the form is not read at all.
    expect(mockFormReads).toBe(0)
  })

  it('includes a site outside the org’s group', async () => {
    mockOrg = NORTHWIND
    const { body } = await ask('hostId=site-c')
    expect(body).toEqual({ fieldName: null, text: null, key: null })
  })
})

describe('what it refuses', () => {
  it('refuses a request that names no usable site', async () => {
    expect((await ask('')).status).toBe(400)
    expect((await ask('hostId=a/b')).status).toBe(400)
  })

  it('serves nothing for a site under a full lock', async () => {
    mockOrg = NORTHWIND
    mockLocked = true
    const { status, body } = await ask(`hostId=${HOST_ID}`)
    expect(status).toBe(503)
    expect(body).not.toHaveProperty('text')
  })

  it('reads no form for an id that is not one', async () => {
    mockOrg = NORTHWIND
    const { body } = await ask(`hostId=${HOST_ID}&formId=${encodeURIComponent('x/y')}`)
    expect(body.fieldName).toBeNull()
    expect(mockFormReads).toBe(0)
  })
})
