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
 * A FORM ALREADY ON A PUBLISHED PAGE, THROUGH THE TWO PATHS THAT DECIDE
 * WHETHER IT DRAWS.
 *
 * Moving an element between bundles is safe in the path everyone checks and
 * unsafe in the one nobody does:
 *
 *  - RESOLUTION is by `componentId` alone, so a node saved when the element
 *    lived elsewhere still finds a factory. That is the claim both completed
 *    element moves rested on, and it is true.
 *  - NARROWING is by `pluginId`. `requiredSitePlugins` reads it to decide
 *    which bundles must register before first paint, so a node naming the old
 *    bundle leaves the new one out of that set and the element arrives after
 *    hydration instead of with the page.
 *
 * Both are asserted here, and the second is asserted BOTH WAYS — stale, then
 * corrected — because an assertion that only ever saw corrected data would
 * pass on a narrowing function that ignored `pluginId` entirely.
 */

import { execFileSync } from 'node:child_process'
import * as Aglyn from '@aglyn/aglyn'
/*
 * The MODULE, not the barrel: `@aglyn/tenant-runtime`'s index pulls in the
 * Next server request adapters, which jsdom cannot evaluate. This function is
 * pure and has no such need.
 */
import { requiredSitePlugins } from '@aglyn/tenant-runtime/required-site-plugins'
import { BUNDLE_ID } from './constants/bundle-common'
import { FORMS_BUNDLE, registerFormsPlugin } from './plugin'

/**
 * A page carrying a contact form, as the document stores it.
 *
 * `componentId` rides along even though the narrowing function declares only
 * `pluginId`: these are the documents it is handed, and a fixture trimmed to
 * the fields under test would not be one.
 */
const pageWith = (
  formPluginId: string | undefined,
): Record<string, { componentId?: string; pluginId?: string }> => ({
  root: { componentId: 'div' },
  heading: { componentId: 'muiTypography', pluginId: 'mui' },
  theForm: {
    componentId: 'form',
    ...(formPluginId ? { pluginId: formPluginId } : {}),
  },
})

/** What this org has switched on. Forms is always-on, so it is always here. */
const ENABLED = ['mui', 'forms', 'commerce', 'email', 'bookings']

describe('a form placed before the move still renders', () => {
  it('resolves by component id, from the bundle that now holds it', () => {
    registerFormsPlugin()
    Aglyn.plugins.getDependency(BUNDLE_ID)?.load?.()
    // The lookup the renderer's leaf does, with no plugin scoping anywhere in
    // it — which is why a node's stale `pluginId` never stops it drawing.
    expect(Aglyn.components.getFactory('form')).toBeTruthy()
    expect(Aglyn.components.getFactory('formField')).toBeTruthy()
  })

  it('registers the bundle on top of mui, once', () => {
    registerFormsPlugin()
    const bundle = Aglyn.plugins.getDependency(BUNDLE_ID)
    expect(bundle?.dependencies).toMatchObject({ [Aglyn.MUI_BUNDLE_ID]: true })
    registerFormsPlugin()
    expect(Aglyn.plugins.getDependency(BUNDLE_ID)).toBe(bundle)
  })

  it('lets nothing become a container by accident (AGL-1389)', () => {
    // `form` accepts its fields; `formField` is a leaf. A new element that
    // starts accepting a drop turns this red until someone says whether it
    // renders what was dropped in.
    expect(Aglyn.auditChildContract(FORMS_BUNDLE, ['form'])).toEqual([])
  })

  it('keeps the form’s children through compose (AGL-1389)', () => {
    expect(
      Aglyn.auditComposeChildSurvival(
        Aglyn.listAcceptingComponentIds(FORMS_BUNDLE),
      ),
    ).toEqual([])
  })
})

describe('the cost the move actually has: what loads before first paint', () => {
  it('THE TRAP: a node still naming mui leaves forms out of the blocking set', () => {
    const required = requiredSitePlugins({
      nodes: pageWith('mui'),
      contributors: [],
      enabledPlugins: ENABLED,
    })
    expect(required).toEqual(['mui'])
    expect(required).not.toContain('forms')
  })

  it('a node naming forms puts it in front of the render', () => {
    expect(
      requiredSitePlugins({
        nodes: pageWith('forms'),
        contributors: [],
        enabledPlugins: ENABLED,
      }),
    ).toEqual(['mui', 'forms'])
  })

  it('and still narrows away the bundles the page does not use', () => {
    // The saving the move buys. Without narrowing this page would block on
    // commerce, email and bookings as well — and before the move the form
    // element was inside `mui`, so every page paid for it.
    const required = requiredSitePlugins({
      nodes: pageWith('forms'),
      contributors: [],
      enabledPlugins: ENABLED,
    })
    expect(required).not.toContain('commerce')
    expect(required).not.toContain('email')
  })

  it('a page with no form at all does not wait for this bundle', () => {
    expect(
      requiredSitePlugins({
        nodes: { root: {}, t: { pluginId: 'mui' } },
        contributors: [],
        enabledPlugins: ENABLED,
      }),
    ).toEqual(['mui'])
  })
})

/**
 * The correction, driven through the script that ships it.
 *
 * `backfill-node-plugin-ids.mjs` connects to Firestore at module scope for
 * every mode but this one, so it is run as a process rather than imported.
 * Its `--self-test` is where the msgpack round-trip and the leave-it-alone
 * cases live; what this adds is that the script is wired up at all — a
 * backfill nothing executes is the failure this repo has had before.
 */
describe('the backfill that makes a stale node say forms', () => {
  it('passes its own fixtures', () => {
    const output = execFileSync(
      'node',
      ['tools/scripts/backfill-node-plugin-ids.mjs', '--self-test'],
      { cwd: process.cwd(), encoding: 'utf8' },
    )
    expect(output).toContain('SELF-TEST PASSED')
  })

  it('refuses a mistyped flag instead of sweeping every host', () => {
    // `--hosts=x` leaves the scope unset. A parser that shrugged would turn a
    // run somebody scoped to one site into a run over the whole platform.
    let status = 0
    try {
      execFileSync(
        'node',
        ['tools/scripts/backfill-node-plugin-ids.mjs', '--hosts=abc'],
        { cwd: process.cwd(), encoding: 'utf8', stdio: 'pipe' },
      )
    } catch (error) {
      status = (error as { status?: number }).status ?? 0
    }
    // 2, not 1: a refusal is not the same as a run that failed.
    expect(status).toBe(2)
  })

  it('THE CONTROL: it exits 0 on a flag it does understand', () => {
    // Otherwise the assertion above passes on a script that cannot start.
    const output = execFileSync(
      'node',
      ['tools/scripts/backfill-node-plugin-ids.mjs', '--help'],
      { cwd: process.cwd(), encoding: 'utf8' },
    )
    expect(output).toContain('--apply')
  })
})
