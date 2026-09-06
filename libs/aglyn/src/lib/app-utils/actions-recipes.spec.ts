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
 * The CRM recipes (AGL-2626): every one builds an action the validator
 * accepts and the editor can open, from the vocabulary the catalog holds.
 */

import {
  ACTION_MAX_STEPS,
  CONTACT_TAG_MAX_LENGTH,
  CRM_ACTION_RECIPE_IDS,
  CRM_ACTION_RECIPES,
  crmActionRecipe,
  crmRecipeTagForForm,
  FLOW_TIMED_OUT_FIELD,
  HOST_ACTION_STEP_LABELS,
  type HostAction,
  hostActionDocument,
  hostActionRecipeId,
  hostActionStepsForClient,
  STALE_LEAD_WAIT_MINUTES,
  validateHostAction,
} from './actions'
import { HOST_EVENT_PAYLOAD_KEYS, HOST_EVENT_TYPES } from './workflows'

const FORM = { id: 'form-contact', name: 'Contact us' }

/** Every recipe, built with what it needs. */
const built = () =>
  CRM_ACTION_RECIPES.map((recipe) => ({
    recipe,
    action: recipe.build(recipe.needs === 'form' ? { form: FORM } : undefined),
  }))

describe('CRM_ACTION_RECIPES', () => {
  it('offers the four recipes, in the order the menu lists them, each with a one-sentence description', () => {
    expect(CRM_ACTION_RECIPES.map((recipe) => recipe.id)).toEqual([
      ...CRM_ACTION_RECIPE_IDS,
    ])
    for (const recipe of CRM_ACTION_RECIPES) {
      expect(recipe.title.trim()).not.toBe('')
      expect(recipe.description.trim()).not.toBe('')
      expect(recipe.description.trim().endsWith('.')).toBe(true)
    }
  })

  it('builds an action the validator accepts, from steps the catalog labels and events the picker offers', () => {
    for (const { recipe, action } of built()) {
      expect({ id: recipe.id, problem: validateHostAction(action) }).toEqual({
        id: recipe.id,
        problem: null,
      })
      expect(HOST_EVENT_TYPES).toContain(action.trigger.event)
      expect(action.steps.length).toBeGreaterThan(0)
      expect(action.steps.length).toBeLessThanOrEqual(ACTION_MAX_STEPS)
      for (const step of action.steps) {
        expect(HOST_ACTION_STEP_LABELS[step.type]).toBeTruthy()
      }
      expect(action.enabled).toBe(true)
      expect(action.name).toBe(recipe.title === 'Tag by form' ? action.name : recipe.title)
    }
  })

  it('names only payload keys the trigger event puts in scope', () => {
    for (const { action } of built()) {
      const keys = HOST_EVENT_PAYLOAD_KEYS[action.trigger.event as never] ?? []
      for (const condition of action.trigger.conditions ?? []) {
        expect(keys).toContain(condition.field)
      }
    }
  })

  it('builds a fresh action on every call, so an edited draft never bleeds into the next', () => {
    for (const recipe of CRM_ACTION_RECIPES) {
      const input = recipe.needs === 'form' ? { form: FORM } : undefined
      const first = recipe.build(input)
      const second = recipe.build(input)
      expect(first).toEqual(second)
      expect(first).not.toBe(second)
      expect(first.steps).not.toBe(second.steps)
      expect(first.trigger).not.toBe(second.trigger)
    }
  })

  it('looks a recipe up by id and answers null for anything else', () => {
    expect(crmActionRecipe('welcomeNewLead')?.title).toBe('Welcome a new lead')
    expect(crmActionRecipe('nope')).toBeNull()
    expect(crmActionRecipe(undefined)).toBeNull()
  })

  it('stamps every action it builds with its own id, so a writer saving what it was handed keeps the provenance (AGL-2639)', () => {
    for (const { recipe, action } of built()) {
      expect(action.recipe).toBe(recipe.id)
      expect(hostActionRecipeId(action)).toBe(recipe.id)
    }
  })
})

describe('the stored recipe stamp (AGL-2639)', () => {
  it('reads a known id, null for "no recipe", and UNKNOWN for a document from before the stamp', () => {
    expect(hostActionRecipeId({ recipe: 'followUpWonDeal' })).toBe('followUpWonDeal')
    expect(hostActionRecipeId({ recipe: null })).toBeNull()
    // A retired or mistyped id says nothing usable; it reads as no recipe.
    expect(hostActionRecipeId({ recipe: 'retiredRecipe' })).toBeNull()
    // No field at all is the older document: unknown, not absent.
    expect(hostActionRecipeId({})).toBeUndefined()
    expect(hostActionRecipeId(undefined)).toBeUndefined()
  })

  it('refuses a stamp that names no recipe, and passes null and absent alike', () => {
    const action = crmActionRecipe('followUpWonDeal')!.build()
    expect(validateHostAction({ ...action, recipe: 'retiredRecipe' as never })).toBe(
      'Unknown recipe',
    )
    expect(validateHostAction({ ...action, recipe: null })).toBeNull()
    const { recipe: _stamp, ...unstamped } = action
    expect(validateHostAction(unstamped)).toBeNull()
  })
})

describe('hostActionDocument (AGL-2639)', () => {
  const action: HostAction = {
    name: 'Nudge',
    trigger: {
      event: 'scrollDepth',
      threshold: 50,
      oncePerVisitor: true,
      cooldownMinutes: 30,
      condition: { field: 'x', op: 'notEmpty' },
      conditions: [{ field: 'path', op: 'contains', value: '/pricing' }],
      combinator: 'or',
    },
    steps: [{ type: 'siteAlert', message: 'Hi', severity: 'info' }],
  }

  it('writes every cap and list out, so a merge-set clears what the editor switched off', () => {
    const stored = hostActionDocument(action)
    expect(stored.trigger).toEqual({
      event: 'scrollDepth',
      threshold: 50,
      oncePerVisitor: true,
      oncePerSession: false,
      cooldownMinutes: 30,
      everyTime: false,
      // The legacy single condition is always nulled; the list is canonical.
      condition: null,
      conditions: [{ field: 'path', op: 'contains', value: '/pricing' }],
      combinator: 'or',
    })
    expect(stored.enabled).toBe(true)
    expect(stored.steps).toEqual(action.steps)
    expect(stored.name).toBe('Nudge')
    const bare = hostActionDocument({
      name: 'Bare',
      trigger: { event: 'formSubmission' },
      steps: [],
      enabled: false,
    })
    expect(bare.trigger).toEqual({
      event: 'formSubmission',
      oncePerVisitor: false,
      oncePerSession: false,
      cooldownMinutes: null,
      everyTime: false,
      condition: null,
      conditions: null,
      combinator: null,
    })
    expect(bare.enabled).toBe(false)
  })

  it('carries the recipe stamp only when the action says something about it', () => {
    expect('recipe' in hostActionDocument(action)).toBe(false)
    expect(hostActionDocument({ ...action, recipe: null }).recipe).toBeNull()
    expect(hostActionDocument(crmActionRecipe('welcomeNewLead')!.build()).recipe).toBe(
      'welcomeNewLead',
    )
  })

  it('is the shape a recipe install writes: the validator accepts it as it accepts the action', () => {
    for (const recipe of CRM_ACTION_RECIPES) {
      const built = recipe.build(recipe.needs === 'form' ? { form: FORM } : undefined)
      expect(validateHostAction(hostActionDocument(built))).toBeNull()
    }
  })
})

describe('Welcome a new lead', () => {
  const action = crmActionRecipe('welcomeNewLead')!.build()

  it('starts on a form capture, rotates in an owner FIRST, then books the call, thanks them and tags them', () => {
    expect(action.trigger).toEqual({
      event: 'contactCreated',
      conditions: [{ field: 'source', op: 'equals', value: 'form' }],
      combinator: 'and',
    })
    expect(action.steps.map((step) => step.type)).toEqual([
      'assignContactOwner',
      'createCrmTask',
      'sendEmail',
      'addContactTag',
    ])
    expect(action.steps[0]).toEqual({ type: 'assignContactOwner', roundRobin: true })
    // No assignee: the task goes to the owner the rotation just chose.
    expect(action.steps[1]).toEqual({
      type: 'createCrmTask',
      title: 'Call the new lead',
      kind: 'call',
      dueInDays: 1,
    })
    expect(action.steps[3]).toEqual({ type: 'addContactTag', tag: 'website' })
  })

  it('sends the acknowledgement before any wait, so it is an immediate reply rather than marketing', () => {
    expect(hostActionStepsForClient(action.steps)).toHaveLength(action.steps.length)
    const email = action.steps[2] as { type: 'sendEmail'; subject: string; body: string }
    expect(email.subject.trim()).not.toBe('')
    expect(email.body.trim()).not.toBe('')
    expect('toField' in email).toBe(false)
  })
})

describe('Follow up a won deal', () => {
  it('moves the contact to Customer and books a call a week out', () => {
    const action = crmActionRecipe('followUpWonDeal')!.build()
    expect(action.trigger).toEqual({ event: 'dealWon' })
    expect(action.steps).toEqual([
      { type: 'setContactStage', lifecycleStage: 'customer' },
      {
        type: 'createCrmTask',
        title: 'Check in with the new customer',
        kind: 'call',
        dueInDays: 7,
      },
    ])
  })
})

describe('Re-engage a stale lead', () => {
  const action = crmActionRecipe('reengageStaleLead')!.build()

  it('starts when a contact becomes a lead and waits a week for the next stage change', () => {
    expect(action.trigger).toEqual({
      event: 'contactStageChanged',
      conditions: [{ field: 'lifecycleStage', op: 'equals', value: 'lead' }],
      combinator: 'and',
    })
    expect(STALE_LEAD_WAIT_MINUTES).toBe(7 * 24 * 60)
    expect(action.steps[0]).toEqual({
      type: 'waitForEvent',
      eventName: 'contactStageChanged',
      timeoutMinutes: STALE_LEAD_WAIT_MINUTES,
    })
  })

  it('books the call only on the timeout branch — a stage that moved on skips it', () => {
    const task = action.steps[1]
    expect(task.type).toBe('createCrmTask')
    expect(task.when).toEqual({
      conditions: [{ field: FLOW_TIMED_OUT_FIELD, op: 'notEmpty' }],
    })
  })

  it('ships nothing past the wait to the visitor’s browser', () => {
    expect(hostActionStepsForClient(action.steps)).toEqual([])
  })
})

describe('Tag by form', () => {
  const recipe = crmActionRecipe('tagByForm')!

  it('needs a form, and built without one is an action the validator refuses', () => {
    expect(recipe.needs).toBe('form')
    expect(validateHostAction(recipe.build())).toMatch(/value/i)
  })

  it('keys the trigger on the picked form’s id and tags with the form’s name', () => {
    const action = recipe.build({ form: FORM })
    expect(action.name).toBe('Tag Contact us submissions')
    expect(action.trigger).toEqual({
      event: 'contactCreated',
      conditions: [{ field: 'formId', op: 'equals', value: 'form-contact' }],
      combinator: 'and',
    })
    expect(action.steps).toEqual([{ type: 'addContactTag', tag: 'Contact us' }])
  })

  it('cuts a long form name to the tag cap', () => {
    const long = 'x'.repeat(CONTACT_TAG_MAX_LENGTH + 20)
    expect(crmRecipeTagForForm(`  ${long}  `)).toHaveLength(CONTACT_TAG_MAX_LENGTH)
    const action = recipe.build({ form: { id: 'f', name: long } })
    expect(validateHostAction(action)).toBeNull()
  })
})
