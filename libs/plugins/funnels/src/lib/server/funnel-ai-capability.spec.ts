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
 * The `funnel` AI capability (AGL-3616): it registers under its op, points at
 * this plugin's writer, and its flat arguments become steps the writer checks
 * — a record the same build made by its id, anything it cannot honestly name
 * refused by name.
 */

jest.mock('firebase-admin/firestore', () => ({ FieldValue: {} }))
jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => ({ firebaseAdmin: {} }))

import { setRegisteringPluginId } from '@aglyn/aglyn/app-utils/registering-plugin'
import {
  pluginAiCapability,
  pluginAiCapabilityArgsProblems,
  pluginAiCapabilityProblem,
} from '@aglyn/aglyn/plugin-manager/plugin-ai-capabilities'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import {
  FUNNEL_AI_OP,
  funnelAiCapability,
  funnelDraftContentFromArgs,
  registerFunnelAiCapability,
} from './funnel-ai-capability'
import { checkFunnelDraftContent, FUNNEL_DRAFT_RESOURCE } from './funnel-drafts'

const ARGS = {
  name: 'Pricing to quote',
  steps: ['page:/pricing', 'form:new:Quote request', 'order'],
  stepLabels: ['Pricing', 'Asked for a quote'],
}

const DEPENDENCIES = { 'new:Quote request': { op: 'form', id: 'form-draft-1' } }

const contentOf = (args: Record<string, unknown>, dependencies: Record<string, { op: string; id: string }> = {}) =>
  funnelAiCapability.draftContent?.({ name: 'funnel', args: args as never }, { hostId: 'h1', dependencies }) ?? {}

beforeEach(() => {
  resetPluginServicesForTests()
  setRegisteringPluginId(undefined)
})

describe('the funnel capability', () => {
  it('is well-formed, and registers under its op owned by funnels, written by its writer', () => {
    expect(pluginAiCapabilityProblem(funnelAiCapability)).toBeNull()
    registerFunnelAiCapability()
    registerFunnelAiCapability()
    expect(pluginAiCapability(FUNNEL_AI_OP)).toEqual({ pluginId: 'funnels', capability: funnelAiCapability })
    expect(funnelAiCapability).toMatchObject({
      op: 'funnel',
      draftResource: FUNNEL_DRAFT_RESOURCE,
      feature: 'screenAnalytics',
      freeAllowed: false,
      degrade: 'omit',
      dependsOnOps: ['form', 'booking-service', 'product', 'overlay'],
    })
    expect(funnelAiCapability.dependsOnOps).not.toContain('page')
    expect(funnelAiCapability.estimateCredits(ARGS as never)).toBe(0)
  })

  it('turns arguments the schema admits into a funnel the writer accepts, naming the build’s form by its id', () => {
    expect(pluginAiCapabilityArgsProblems(funnelAiCapability.argsSchema, ARGS)).toEqual([])
    const content = contentOf(ARGS, DEPENDENCIES)
    expect(content).toEqual({
      name: 'Pricing to quote',
      steps: [
        { type: 'page', key: '/pricing', match: 'exact', label: 'Pricing' },
        { type: 'form', key: 'form-draft-1', label: 'Asked for a quote' },
        { type: 'order', key: '' },
      ],
    })
    expect(checkFunnelDraftContent(content)).toMatchObject({ ok: true, facts: { status: 'draft', steps: 3 } })
  })

  it('matches a new:<name> without regard to case', () => {
    const content = contentOf({ name: 'x', steps: ['page:/', 'form:new:quote REQUEST'] }, DEPENDENCIES)
    expect((content['steps'] as unknown[])[1]).toEqual({ type: 'form', key: 'form-draft-1' })
  })

  it('reads a page prefix, an existing record by id, any of a kind, and an email step', () => {
    const content = contentOf({
      name: 'x',
      steps: ['page:/blog/*', 'page:/*', 'cart:prod-1', 'booking', 'email:Clicked'],
    })
    expect(content['steps']).toEqual([
      { type: 'page', key: '/blog', match: 'prefix' },
      { type: 'page', key: '/', match: 'prefix' },
      { type: 'cart', key: 'prod-1' },
      { type: 'booking', key: '' },
      { type: 'email', key: 'clicked' },
    ])
    expect(checkFunnelDraftContent(content)).toMatchObject({ ok: true })
  })

  it('refuses, by name, a new:<name> the build did not make or that is the wrong kind', () => {
    expect(checkFunnelDraftContent(contentOf({ name: 'x', steps: ['page:/', 'form:new:Ghost'] }))).toEqual({
      ok: false,
      problems: ['Step 2: new:Ghost was not made by this build, so there is no form to name.'],
    })
    expect(
      checkFunnelDraftContent(
        contentOf({ name: 'x', steps: ['page:/', 'booking:new:Quote request'] }, DEPENDENCIES),
      ),
    ).toEqual({ ok: false, problems: ['Step 2: new:Quote request is not a booking service.'] })
  })

  it('offers no custom event step, and hands an unknown kind to the writer to refuse', () => {
    expect(checkFunnelDraftContent(contentOf({ name: 'x', steps: ['page:/', 'event:signup_click'] }))).toMatchObject({
      ok: false,
      problems: [expect.stringMatching(/^Step 2: a build does not add custom event steps/)],
    })
    expect(checkFunnelDraftContent(contentOf({ name: 'x', steps: ['page:/', 'video:intro'] }))).toEqual({
      ok: false,
      problems: ['Step 2: Pick what the step is.'],
    })
  })

  it('holds the planner to the save door’s step count through the schema and the writer', () => {
    const nine = Array.from({ length: 9 }, () => 'page:/')
    expect(pluginAiCapabilityArgsProblems(funnelAiCapability.argsSchema, { name: 'x', steps: nine })).toEqual([
      '"steps" must hold at most 8',
    ])
    expect(checkFunnelDraftContent(funnelDraftContentFromArgs({ name: 'x', steps: ['page:/'] }))).toEqual({
      ok: false,
      problems: ['A funnel has 2 to 8 steps.'],
    })
  })
})
