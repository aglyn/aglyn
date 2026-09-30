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

import {
  declaredFormRecordTarget,
  FormRecordTargetUnavailableError,
  formRecordTarget,
  resetFormRecordTargetForTests,
  stampFormRecordTargets,
} from '@aglyn/aglyn/plugin-manager/submission-record-target'

/**
 * A FORM'S RECORD TARGET IS REGISTERED IN THIS APP'S SERVER PROCESSES
 * (AGL-3080).
 *
 * A form can file every submission as a record another plugin keeps. In this
 * app, the pages it serves stamp their forms and its submit route files what comes back,
 * both through `plugin-manager/submission-record-target.ts`. The target registers
 * from its plugin's `serverDeclarations` entry and is declared in
 * `plugins.config.json` too, so a boot that skipped it refuses a page with a
 * form instead of shipping forms that silently write nowhere. This is the
 * spec that finds out if boot stopped registering it.
 *
 * ⚑ It runs THIS APP'S OWN boot manifest and never imports the plugin: an app
 * may not depend on a plugin, and a dynamic first-party import here would
 * register a lazy nx graph edge that breaks every static import of that
 * library in other projects (AGL-2282).
 *
 * ⛔ The boot runs ONCE and the answers are captured around it: the manifest
 * memoizes, so a reset between tests would leave later ones asserting against
 * a boot that never runs again.
 */

import { registerPluginServerDeclarations } from '../utils/plugins.declarations.server.generated'

const WITH_FORM = { form: { $id: 'form', componentId: 'form', props: {} } }

let targetBeforeBoot: ReturnType<typeof formRecordTarget>
let refusalBeforeBoot: unknown
let targetAfterBoot: ReturnType<typeof formRecordTarget>

beforeAll(async () => {
  resetFormRecordTargetForTests()
  targetBeforeBoot = formRecordTarget()
  refusalBeforeBoot = await stampFormRecordTargets(WITH_FORM, 'h1').catch(
    (error: unknown) => error,
  )
  await registerPluginServerDeclarations()
  targetAfterBoot = formRecordTarget()
})

describe('the plugin a form files its records with, in this app', () => {
  it('THE CONTROL: with boot not run, a page with a form is refused', () => {
    // Everything below would pass against a boot that registered nothing if
    // the slot happened to be filled already.
    expect(targetBeforeBoot).toBeNull()
    expect(refusalBeforeBoot).toBeInstanceOf(FormRecordTargetUnavailableError)
  })

  it('registers the target at boot, from the plugin the config declares', () => {
    expect(declaredFormRecordTarget()?.pluginId).toBe('data')
    expect(targetAfterBoot?.pluginId).toBe(declaredFormRecordTarget()?.pluginId)
    expect(typeof targetAfterBoot?.target.stamp).toBe('function')
    expect(typeof targetAfterBoot?.target.write).toBe('function')
  })
})
