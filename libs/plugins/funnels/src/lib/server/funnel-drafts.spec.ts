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
 * The `funnel` draft writer (AGL-3616): the save door's rules — plan, role,
 * cap, steps checked against the site — and a draft that changes nothing
 * live.
 */

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: jest.requireActual('../testing/fake-firestore').FAKE_FIELD_VALUE,
}))
jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => ({ firebaseAdmin: {} }))

import { setRegisteringPluginId } from '@aglyn/aglyn/app-utils/registering-plugin'
import { pluginResourceDraftWriter } from '@aglyn/aglyn/plugin-manager/plugin-resource-drafts'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { FakeFirestore } from '../testing/fake-firestore'
import {
  checkFunnelDraftContent,
  createFunnelDraftWriter,
  FUNNEL_DRAFT_RESOURCE,
  FUNNEL_PLAN_REFUSAL,
  FUNNEL_ROLE_REFUSAL,
  FUNNEL_ROOM_REFUSAL,
  funnelDraftWriter,
  registerFunnelDraftWriter,
} from './funnel-drafts'

const PRO = { plan: 'pro' }
const NOW = new Date('2026-10-07T12:00:00Z')

const CONTENT = {
  name: 'Pricing to contact',
  steps: [
    { type: 'page', key: '/pricing', match: 'exact' },
    { type: 'form', key: 'f1' },
  ],
}

let db: FakeFirestore
const writer = () => createFunnelDraftWriter({ firestore: () => db })

function site(role: string | null = 'editor', extra: Record<string, unknown> = {}) {
  db = new FakeFirestore()
    .seed('hosts/h1', {
      memberRoles: role ? { u1: role } : {},
      screens: { s1: '/pricing', s2: '/blog/hello' },
      ...extra,
    })
    .seed('hosts/h1/forms/f1', { displayName: 'Contact' })
}

const request = (overrides: Record<string, unknown> = {}) => ({
  orgId: 'o1',
  hostId: 'h1',
  uid: 'u1',
  org: PRO,
  now: NOW,
  id: 'job1-u0',
  name: 'Pricing to contact',
  content: CONTENT,
  ...overrides,
})

beforeEach(() => {
  resetPluginServicesForTests()
  setRegisteringPluginId(undefined)
  site()
})

describe('refusal: the save door’s gates', () => {
  it('admits an editor or admin on a plan with per-page analytics, with room', async () => {
    expect(await writer().refusal(request())).toBeNull()
    site('admin')
    expect(await writer().refusal(request())).toBeNull()
  })

  it.each(['author', 'viewer', null])('refuses a %s in the save door’s words', async (role) => {
    site(role)
    expect(await writer().refusal(request())).toEqual({ status: 403, error: FUNNEL_ROLE_REFUSAL })
  })

  it('refuses a plan without the analytics tier, and Free', async () => {
    expect(await writer().refusal(request({ org: { plan: 'starter' } }))).toEqual({ status: 403, error: FUNNEL_PLAN_REFUSAL })
    expect(await writer().refusal(request({ org: { plan: 'free' } }))).toEqual({ status: 403, error: FUNNEL_PLAN_REFUSAL })
  })

  it('refuses at twenty funnels, drafts counted', async () => {
    for (let index = 0; index < 20; index += 1) db.seed(`hosts/h1/funnels/f${index}`, { ...CONTENT, status: 'draft' })
    expect(await writer().refusal(request())).toEqual({ status: 409, error: FUNNEL_ROOM_REFUSAL })
  })

  it('answers an unknown site', async () => {
    expect(await writer().refusal(request({ hostId: 'nope' }))).toEqual({ status: 404, error: 'Unknown site' })
  })
})

describe('check: the save door’s normalization, without I/O', () => {
  it('accepts a funnel and reports it a draft that records nothing', () => {
    expect(checkFunnelDraftContent(CONTENT)).toEqual({
      ok: true,
      facts: { status: 'draft', steps: 2, stepTypes: ['page', 'form'], recording: false },
    })
  })

  it('refuses what the save door refuses, in its words', () => {
    expect(checkFunnelDraftContent({ ...CONTENT, name: '' })).toEqual({ ok: false, problems: ['Name the funnel.'] })
    expect(checkFunnelDraftContent({ ...CONTENT, steps: [CONTENT.steps[0]] })).toEqual({
      ok: false,
      problems: ['A funnel has 2 to 8 steps.'],
    })
    expect(checkFunnelDraftContent({ ...CONTENT, steps: [CONTENT.steps[0], { type: 'event', key: 'Bad Name' }] })).toMatchObject({
      ok: false,
      problems: [expect.stringMatching(/^Step 2: A custom event step needs/)],
    })
  })

  it('refuses a step its caller could not name, with the caller’s sentence', () => {
    expect(
      checkFunnelDraftContent({ ...CONTENT, steps: [CONTENT.steps[0], { unresolved: 'new:Quote was not made by this build.' }] }),
    ).toEqual({ ok: false, problems: ['Step 2: new:Quote was not made by this build.'] })
  })
})

describe('write: the save door’s document, as a draft, changing nothing live', () => {
  it('writes the funnel under the given id, labelled from the site, as a draft, and leaves recording alone', async () => {
    const written = await writer().write(request())
    expect(written).toEqual({
      ok: true,
      replayed: false,
      id: 'job1-u0',
      name: 'Pricing to contact',
      versionId: null,
      facts: { status: 'draft', steps: 2, stepTypes: ['page', 'form'], recording: false },
    })
    expect(db.docs.get('hosts/h1/funnels/job1-u0')).toEqual({
      name: 'Pricing to contact',
      steps: [
        { type: 'page', key: '/pricing', match: 'exact' },
        { type: 'form', key: 'f1', label: 'Contact' },
      ],
      status: 'draft',
      createdAt: 'SERVER_TIME',
      updatedAt: 'SERVER_TIME',
      createdBy: 'u1',
    })
    // The host document — the recording switch — is never written.
    expect(db.writes.map((one) => one.path)).toEqual(['hosts/h1/funnels/job1-u0'])
    expect(db.docs.get('hosts/h1')).not.toHaveProperty('funnelRecording')
  })

  it('takes the request’s name over the content’s', async () => {
    const written = await writer().write(request({ name: 'Blog to contact' }))
    expect(written).toMatchObject({ ok: true, name: 'Blog to contact' })
  })

  it('answers the funnel it already wrote when asked again under the same id', async () => {
    await writer().write(request())
    const again = await writer().write(request({ name: 'Something else' }))
    expect(again).toMatchObject({ ok: true, replayed: true, id: 'job1-u0', name: 'Pricing to contact', facts: { status: 'draft' } })
    expect(db.writes.filter((one) => one.op === 'create')).toHaveLength(1)
  })

  it('refuses a step the site does not have, naming the step, and writes nothing', async () => {
    const page = await writer().write(request({ content: { ...CONTENT, steps: [{ type: 'page', key: '/gone' }, CONTENT.steps[1]] } }))
    expect(page).toEqual({ ok: false, status: 400, error: 'Step 1: This site has no page at /gone.' })
    const form = await writer().write(request({ content: { ...CONTENT, steps: [CONTENT.steps[0], { type: 'form', key: 'ghost' }] } }))
    expect(form).toMatchObject({ ok: false, status: 400, error: expect.stringMatching(/^Step 2: .*is not on this site\.$/) })
    expect(db.writes).toEqual([])
  })

  it('accepts a page prefix the site serves under, and a record made earlier in the same build', async () => {
    db.seed('hosts/h1/services/svc-draft', { name: 'Free estimate', status: 'draft' })
    const written = await writer().write(
      request({
        content: {
          name: 'Blog to estimate',
          steps: [{ type: 'page', key: '/blog', match: 'prefix' }, { type: 'booking', key: 'svc-draft' }],
        },
      }),
    )
    expect(written).toMatchObject({ ok: true, replayed: false })
    expect(db.docs.get('hosts/h1/funnels/job1-u0')?.['steps'][1]).toEqual({ type: 'booking', key: 'svc-draft', label: 'Free estimate' })
  })

  it('applies the gates inside its own write', async () => {
    site('author')
    expect(await writer().write(request())).toEqual({ ok: false, status: 403, error: FUNNEL_ROLE_REFUSAL })
    site()
    expect(await writer().write(request({ org: { plan: 'starter' } }))).toEqual({ ok: false, status: 403, error: FUNNEL_PLAN_REFUSAL })
    for (let index = 0; index < 20; index += 1) db.seed(`hosts/h1/funnels/f${index}`, CONTENT)
    expect(await writer().write(request())).toEqual({ ok: false, status: 409, error: FUNNEL_ROOM_REFUSAL })
    expect(db.writes).toEqual([])
  })

  it('refuses content the check refuses, with its first problem', async () => {
    expect(await writer().write(request({ name: '', content: { ...CONTENT, name: '' } }))).toEqual({
      ok: false,
      status: 400,
      error: 'Name the funnel.',
    })
  })
})

describe('read', () => {
  it('reports a written draft, an active funnel as active, and nothing for an unknown id', async () => {
    await writer().write(request())
    expect(await writer().read({ hostId: 'h1', id: 'job1-u0' })).toMatchObject({
      id: 'job1-u0',
      name: 'Pricing to contact',
      facts: { status: 'draft', recording: false },
    })
    db.seed('hosts/h1/funnels/live', CONTENT)
    expect(await writer().read({ hostId: 'h1', id: 'live' })).toMatchObject({ facts: { status: 'active', recording: true } })
    expect(await writer().read({ hostId: 'h1', id: 'nope' })).toBeNull()
  })
})

describe('registration', () => {
  it('registers the writer under `funnel`, owned by funnels, idempotently', () => {
    registerFunnelDraftWriter()
    registerFunnelDraftWriter()
    expect(pluginResourceDraftWriter(FUNNEL_DRAFT_RESOURCE)).toEqual({ pluginId: 'funnels', writer: funnelDraftWriter })
  })
})
