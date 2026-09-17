/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and this runs on jsdom, where the route's `Response`
 * helpers are unavailable.
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
 * PUT /api/admin/flags, driven in-process against a Remote Config double
 * that refuses what Remote Config refuses (AGL-3048).
 *
 * Publishing "Site admin bar" from the staff flags page answered 500 "Flag
 * operation failed". The route wrote the registry description into the
 * parameter, that description was 347 characters, and Remote Config refuses
 * the whole publish over one description past 256 — production's validate-
 * only publish of the same change said so, word for word. Every flag whose
 * registry description runs long failed the same way.
 *
 * The lib spec pins the rule that picks the text. This one pins that the
 * ROUTE uses it: for every registered flag, a first publish and a publish
 * over a live parameter both succeed, and send what the rule says.
 */

import {
  fitsRemoteConfigDescription,
  RELEASE_FLAGS,
  releaseFlagParameterDescription,
} from '@aglyn/aglyn/server'

type Parameter = {
  defaultValue?: { value?: string }
  description?: string
  valueType?: string
}
type Template = { etag: string; parameters: Record<string, Parameter> }

let mockLiveTemplate: Template
let mockPublished: Template[] = []
let mockAuditRows: Record<string, unknown>[] = []

/**
 * Remote Config's validation for the one rule under test: a single
 * description past 256 characters refuses the WHOLE template. The message is
 * the one production returned on 2026-09-16.
 */
const mockPublishTemplate = jest.fn(async (template: Template) => {
  for (const parameter of Object.values(template.parameters)) {
    const found = [...(parameter.description ?? '')].length
    if (found > 256) {
      throw new Error(
        '[VALIDATION_ERROR]: DESCRIPTION_EXCEEDS_MAXIMUM_SIZE. Expected ' +
          `description length should be [0,256]. Found ${found}.`,
      )
    }
  }
  mockPublished.push(JSON.parse(JSON.stringify(template)))
  return { ...template, etag: 'etag-2' }
})

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { serverTimestamp: () => ({ __sentinel: 'serverTimestamp' }) },
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: async () => ({
          uid: 'staff-1',
          email_verified: true,
          staff: true,
          staffRole: 'super',
        }),
      }),
      remoteConfig: () => ({
        // A copy, as the SDK hands back: the route mutates what it gets.
        getTemplate: async () => JSON.parse(JSON.stringify(mockLiveTemplate)),
        publishTemplate: mockPublishTemplate,
      }),
      firestore: () => ({
        collection: () => ({
          add: async (row: Record<string, unknown>) => {
            mockAuditRows.push(row)
            return { id: 'audit-1' }
          },
        }),
      }),
    }),
  },
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email to continue' }, { status: 403 }),
}))

const route = require('../app/api/admin/flags/route') as {
  PUT: (request: Request) => Promise<Response>
}

const publish = (key: string) =>
  route.PUT(
    new Request('https://app.aglyn.com/api/admin/flags', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer staff-token',
      },
      body: JSON.stringify({
        key,
        enabled: true,
        rolloutPercent: 0,
        note: 'Released',
        etag: 'etag-1',
      }),
    }),
  )

const FLAGS = RELEASE_FLAGS.map((flag) => [flag.key, flag] as const)

beforeEach(() => {
  mockLiveTemplate = { etag: 'etag-1', parameters: {} }
  mockPublished = []
  mockAuditRows = []
  mockPublishTemplate.mockClear()
})

describe('publishing a release flag from the staff flags page (AGL-3048)', () => {
  it('reproduces the refusal: the double turns away a description past the limit', async () => {
    // Without this, a double that accepted anything would pass every case
    // below against the route as it was.
    await expect(
      mockPublishTemplate({
        etag: 'etag-1',
        parameters: { release_edit_bar: { description: 'x'.repeat(347) } },
      }),
    ).rejects.toThrow('Found 347')
  })

  it.each(FLAGS)('publishes %s the first time', async (key, flag) => {
    const response = await publish(key)
    expect(response.status).toBe(200)
    const sent = mockPublished[0]?.parameters[key]?.description ?? ''
    expect(fitsRemoteConfigDescription(sent)).toBe(true)
    expect(sent).toBe(releaseFlagParameterDescription(flag.description, undefined))
    expect(mockAuditRows).toHaveLength(1)
  })

  it.each(FLAGS)('publishes %s over its live parameter', async (key, flag) => {
    const live = `What the Firebase console shows for ${key}.`
    mockLiveTemplate = {
      etag: 'etag-1',
      parameters: {
        [key]: {
          defaultValue: { value: '{"enabled":false,"rolloutPercent":0}' },
          description: live,
          valueType: 'JSON',
        },
      },
    }
    const response = await publish(key)
    expect(response.status).toBe(200)
    // The registry's text when it fits; otherwise the live text is kept
    // rather than replaced with a cut-off paragraph.
    expect(mockPublished[0]?.parameters[key]?.description).toBe(
      fitsRemoteConfigDescription(flag.description) ? flag.description : live,
    )
    expect(
      JSON.parse(mockPublished[0]?.parameters[key]?.defaultValue?.value ?? '{}'),
    ).toMatchObject({ enabled: true, rolloutPercent: 0, note: 'Released' })
  })
})
