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
 * A bound form never reads an empty registry as "writes nowhere" (AGL-3080).
 *
 * The page's composition stamps each form through `stampFormRecordTargets`
 * and the submit route files each submission through `writeFormRecordTarget`.
 * These cases hold the three answers apart — nothing declared, declared and
 * registered, declared but missing — and pin the two directions a missing
 * target fails in: a page with a form THROWS, a submission is kept with the
 * failure noted, and neither asks anybody for a page with no form.
 */

let mockDeclared: unknown = undefined

jest.mock('./first-party-plugins.generated', () => {
  const actual = jest.requireActual('./first-party-plugins.generated')
  return {
    __esModule: true,
    ...actual,
    get PLUGIN_FORM_RECORD_TARGET_DECLARED() {
      return mockDeclared === undefined
        ? actual.PLUGIN_FORM_RECORD_TARGET_DECLARED
        : mockDeclared
    },
  }
})

import {
  declaredFormRecordTarget,
  FormRecordTargetUnavailableError,
  formRecordTarget,
  registerFormRecordTarget,
  resetFormRecordTargetForTests,
  stampFormRecordTargets,
  writeFormRecordTarget,
  type FormRecordTarget,
} from './submission-record-target'
import {
  registerPluginDeclarationsRepair,
  resetPluginDeclarationsRepairForTests,
} from './plugin-declarations-repair'

const WITH_FORM = {
  form: { $id: 'form', componentId: 'form', props: { datasetId: 'leads' } },
}
const WITHOUT_FORM = { text: { $id: 'text', componentId: 'muiTypography' } }
const SUBMISSION = {
  hostId: 'h1',
  orgId: 'o1',
  orgBilling: {},
  body: { token: 't' },
  fields: { email: 'a@b.test' },
}

const stubTarget = () => {
  const stamp = jest.fn(async (nodes: Record<string, unknown>) => ({
    ...nodes,
    stamped: true,
  }))
  const write = jest.fn(async () => ({ routing: { filed: true } }))
  return { stamp, write, target: { stamp, write } as unknown as FormRecordTarget }
}

beforeEach(() => {
  mockDeclared = undefined
  resetFormRecordTargetForTests()
  resetPluginDeclarationsRepairForTests()
})

describe('the declared form record target', () => {
  it('is the data plugin’s datasets, compiled from the config', () => {
    expect(declaredFormRecordTarget()).toEqual({ pluginId: 'data', id: 'dataset' })
  })
})

describe('stampFormRecordTargets', () => {
  it('asks nobody for a page with no form, and hands the same tree back', async () => {
    await expect(stampFormRecordTargets(WITHOUT_FORM, 'h1')).resolves.toBe(WITHOUT_FORM)
  })

  it('hands a page with a form to the registered target', async () => {
    const target = stubTarget()
    registerFormRecordTarget(target.target, { pluginId: 'data' })
    await expect(stampFormRecordTargets(WITH_FORM, 'h1')).resolves.toEqual({
      ...WITH_FORM,
      stamped: true,
    })
    expect(target.stamp).toHaveBeenCalledWith(WITH_FORM, 'h1')
  })

  it('leaves a form unstamped when no plugin declares a target', async () => {
    mockDeclared = null
    await expect(stampFormRecordTargets(WITH_FORM, 'h1')).resolves.toBe(WITH_FORM)
  })

  it('THROWS for a page with a form when the declared target is missing', async () => {
    await expect(stampFormRecordTargets(WITH_FORM, 'h1')).rejects.toBeInstanceOf(
      FormRecordTargetUnavailableError,
    )
  })

  it('runs the app’s declarations step once more before refusing', async () => {
    const target = stubTarget()
    const repair = jest.fn(async () => {
      registerFormRecordTarget(target.target, { pluginId: 'data' })
    })
    registerPluginDeclarationsRepair(repair)
    await stampFormRecordTargets(WITH_FORM, 'h1')
    expect(repair).toHaveBeenCalledTimes(1)
    expect(target.stamp).toHaveBeenCalled()
  })
})

describe('writeFormRecordTarget', () => {
  it('answers what the registered target writes', async () => {
    const target = stubTarget()
    registerFormRecordTarget(target.target, { pluginId: 'data' })
    await expect(writeFormRecordTarget(SUBMISSION)).resolves.toEqual({
      routing: { filed: true },
    })
    expect(target.write).toHaveBeenCalledWith(SUBMISSION)
  })

  it('files nothing when no plugin declares a target', async () => {
    mockDeclared = null
    await expect(writeFormRecordTarget(SUBMISSION)).resolves.toEqual({})
  })

  it('keeps the submission and NOTES the failure when the declared target is missing', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    await expect(writeFormRecordTarget(SUBMISSION)).resolves.toEqual({
      routing: { recordTargetUnavailable: true },
    })
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('never rejects when the target itself throws', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    registerFormRecordTarget(
      { stamp: async (nodes) => nodes, write: async () => Promise.reject(new Error('x')) },
      { pluginId: 'data' },
    )
    await expect(writeFormRecordTarget(SUBMISSION)).resolves.toEqual({})
    spy.mockRestore()
  })
})

describe('registerFormRecordTarget', () => {
  it('refuses a target from a plugin other than the one declared', () => {
    expect(() => registerFormRecordTarget(stubTarget().target, { pluginId: 'crm' })).toThrow(
      /declared by "data"/,
    )
    expect(formRecordTarget()).toBeNull()
  })

  it('refuses a target with no owner', () => {
    expect(() => registerFormRecordTarget(stubTarget().target)).toThrow(/no owner/)
  })

  it('lets the owner replace its own target, and unregister only its own', () => {
    const first = registerFormRecordTarget(stubTarget().target, { pluginId: 'data' })
    const second = stubTarget()
    registerFormRecordTarget(second.target, { pluginId: 'data' })
    first()
    expect(formRecordTarget()?.target).toBe(second.target)
  })
})
