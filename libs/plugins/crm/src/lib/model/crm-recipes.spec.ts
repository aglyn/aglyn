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
 * The CRM's recipes (AGL-2626): what each one builds, as the CRM decided it.
 *
 * That every recipe is an automation the automation editor accepts — its
 * validator, its step labels, the copy a visitor's page receives — is held
 * where both plugins run, in `apps/console/specs/interaction-recipes.spec.ts`;
 * this plugin may not load the plugin that judges automations.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CONTACT_TAG_MAX_LENGTH } from '@aglyn/aglyn/app-utils/crm-kinds'
import {
  HOST_EVENT_PAYLOAD_KEYS,
  HOST_EVENT_TYPES,
  hostEventRecipientActed,
} from '@aglyn/aglyn/app-utils/host-events'
import { declaredInteractionRecipes } from '@aglyn/aglyn/plugin-manager/interaction-recipes'
import { BUNDLE_ID } from '../constants/bundle-common'
import {
  CRM_ACTION_RECIPE_IDS,
  CRM_ACTION_RECIPES,
  crmActionRecipe,
  crmRecipeTagForForm,
  STALE_LEAD_WAIT_MINUTES,
} from './crm-recipes'

const FORM = { id: 'form-contact', name: 'Contact us' }

/** Every recipe, built with what it picks. */
const built = () =>
  CRM_ACTION_RECIPES.map((recipe) => ({
    recipe,
    action: recipe.build(recipe.picks ? { picked: FORM } : undefined),
  }))

describe('CRM_ACTION_RECIPES', () => {
  it('offers the four recipes, in the order the menu lists them, each with a one-sentence description', () => {
    expect(CRM_ACTION_RECIPES.map((recipe) => recipe.id)).toEqual([...CRM_ACTION_RECIPE_IDS])
    for (const recipe of CRM_ACTION_RECIPES) {
      expect(recipe.title.trim()).not.toBe('')
      expect(recipe.description.trim()).not.toBe('')
      expect(recipe.description.trim().endsWith('.')).toBe(true)
    }
  })

  it('declares every id it ships, and no other, so a stored stamp is known without this plugin loaded', () => {
    expect(
      declaredInteractionRecipes()
        .filter((row) => row.pluginId === BUNDLE_ID)
        .map((row) => row.id),
    ).toEqual([...CRM_ACTION_RECIPE_IDS])
  })

  it('starts each one on an event the picker offers, and names only the keys that event carries', () => {
    for (const { action } of built()) {
      expect(HOST_EVENT_TYPES).toContain(action.trigger.event)
      expect(action.steps.length).toBeGreaterThan(0)
      expect(action.enabled).toBe(true)
      const keys = HOST_EVENT_PAYLOAD_KEYS[action.trigger.event as never] ?? []
      for (const condition of action.trigger.conditions ?? []) {
        expect(keys).toContain(condition.field)
      }
    }
  })

  it('builds a fresh action on every call, so an edited draft never bleeds into the next', () => {
    for (const recipe of CRM_ACTION_RECIPES) {
      const input = recipe.picks ? { picked: FORM } : undefined
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
      expect(action.name).toBe(recipe.picks ? action.name : recipe.title)
    }
  })
})

describe('Welcome a new lead', () => {
  const action = crmActionRecipe('welcomeNewLead')!.build()

  it('starts on a new lead a form filed, rotates in an owner FIRST, then books the call, thanks them and tags them', () => {
    // A lead-routed form makes a LEAD and no contact (AGL-3232), so the
    // recipe named for it listens for one (AGL-3458) — keyed to forms by the
    // `formId` the `lead` event carries only when a form filed the lead.
    expect(action.trigger).toEqual({
      event: 'lead',
      conditions: [{ field: 'formId', op: 'notEmpty' }],
      combinator: 'and',
    })
    expect(HOST_EVENT_PAYLOAD_KEYS.lead).toContain('formId')
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

  it('thanks them in words that promise nothing, to the address the event carries', () => {
    const email = action.steps[2] as { type: 'sendEmail'; subject: string; body: string }
    expect(email.type).toBe('sendEmail')
    expect(email.subject.trim()).not.toBe('')
    expect(email.body.trim()).not.toBe('')
    expect('toField' in email).toBe(false)
    // Everything that makes it a transactional reply, with no unsubscribe
    // (AGL-3458): on the person's own act, before any wait, in no topic, to
    // the address the event carries. The automation editor's own judgement of
    // it is held in the workflows plugin's recipe spec, through a stand-in.
    expect(hostEventRecipientActed(action.trigger.event)).toBe(true)
    expect('topicId' in email).toBe(false)
    expect(
      action.steps.slice(0, 2).some((step) => step.type === 'wait' || step.type === 'waitForEvent'),
    ).toBe(false)
    // Greeting the person by name, with a fallback for one who gave none.
    expect(email.body).toContain('{{firstName|there}}')
  })

  it('is the automation the AI evaluation explains, as this plugin builds it', () => {
    // The explain case is drawn from this recipe; a recipe edited without it
    // would grade the explanation of an automation nobody ships.
    const evalCase = JSON.parse(
      readFileSync(
        join(__dirname, '../../../../../../tools/ai-eval/cases/workflow/explain-welcome-new-lead.json'),
        'utf8',
      ),
    )
    expect(evalCase.automation.action).toEqual(action)
  })
})

describe('Follow up a won deal', () => {
  it('books a call a week out, and sets no stage — the win itself makes the contact a customer (AGL-2641)', () => {
    const recipe = crmActionRecipe('followUpWonDeal')!
    const action = recipe.build()
    expect(action.trigger).toEqual({ event: 'dealWon' })
    expect(action.steps).toEqual([
      {
        type: 'createCrmTask',
        title: 'Check in with the new customer',
        kind: 'call',
        dueInDays: 7,
      },
    ])
    // A stage step here would be a SET after the win's floor: a repeat at
    // best, a demotion of an evangelist at worst.
    expect(action.steps.some((step) => step.type === 'setContactStage')).toBe(false)
    expect(recipe.description).toMatch(/Customer on its own/)
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
    // The field a resumed wait carries when the clock, not the event, ended it.
    expect(task.when).toEqual({
      conditions: [{ field: '_waitTimedOut', op: 'notEmpty' }],
    })
  })
})

describe('Tag by form', () => {
  const recipe = crmActionRecipe('tagByForm')!

  it('asks for a form to be picked, and built without one names no form', () => {
    expect(recipe.picks?.kind).toBe('form')
    const unpicked = recipe.build()
    expect(unpicked.trigger.conditions).toEqual([{ field: 'formId', op: 'equals', value: '' }])
  })

  it('keys the trigger on the picked form’s id and tags with the form’s name', () => {
    const action = recipe.build({ picked: FORM })
    expect(action.name).toBe('Tag Contact us submissions')
    expect(action.trigger).toEqual({
      event: 'contactCreated',
      conditions: [{ field: 'formId', op: 'equals', value: 'form-contact' }],
      combinator: 'and',
    })
    expect(action.steps).toEqual([{ type: 'addContactTag', tag: 'Contact us' }])
  })

  it('listens for a new LEAD when the picked form routes to leads (AGL-3458)', () => {
    // Such a form makes a lead and no contact, so on `contactCreated` the
    // recipe would never fire. The Forms plugin's list source shares the
    // routing as the picked form's `routesLeads` fact.
    const action = recipe.build({ picked: { ...FORM, facts: { routesLeads: true } } })
    expect(action.trigger.event).toBe('lead')
    expect(action.trigger.conditions).toEqual([
      { field: 'formId', op: 'equals', value: 'form-contact' },
    ])
    expect(recipe.build({ picked: { ...FORM, facts: { routesLeads: false } } }).trigger.event).toBe(
      'contactCreated',
    )
  })

  it('cuts a long form name to the tag cap', () => {
    const long = 'x'.repeat(CONTACT_TAG_MAX_LENGTH + 20)
    expect(crmRecipeTagForForm(`  ${long}  `)).toHaveLength(CONTACT_TAG_MAX_LENGTH)
    const action = recipe.build({ picked: { id: 'f', name: long } })
    expect(action.steps).toEqual([{ type: 'addContactTag', tag: 'x'.repeat(CONTACT_TAG_MAX_LENGTH) }])
  })
})
