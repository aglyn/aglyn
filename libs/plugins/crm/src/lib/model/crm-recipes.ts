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

import { CONTACT_TAG_MAX_LENGTH } from '@aglyn/aglyn/app-utils/crm-kinds'
import type {
  InteractionRecipe,
  InteractionRecipeInput,
} from '@aglyn/aglyn/plugin-manager/interaction-recipes'

/*
 * THE CRM'S RECIPES (AGL-2626).
 *
 * A recipe is a ready-to-edit automation — a trigger, its conditions and an
 * ordered step list — built from the vocabulary the automation editor already
 * offers and handed to that editor as a draft. Nothing is written until the
 * person saves, and every field is theirs to change first: the recipe decides
 * where the editor starts, not what the site runs.
 *
 * The CRM's own, because what each one is FOR is the CRM's: who a new lead is,
 * when a deal is won, when a lead has gone quiet. They reach the automation
 * editor through the platform's recipe seam
 * (`plugin-manager/interaction-recipes`, AGL-3080), registered from this
 * plugin's declarations; the org hub's Recipes card and its install routes
 * read them here. Their ids are declared in `plugins.config.json`
 * (`interactionRecipes`) because a stored automation names one.
 *
 * Definitions only. Three of the four are complete as written. `tagByForm`
 * needs a form, and a form belongs to a site, so the picker that supplies it
 * is the editor's business and host-scoped by nature. That is the seam an
 * org-level mount keeps: the recipes are the same at either level, and only
 * the form picker knows where it is.
 */
export const CRM_ACTION_RECIPE_IDS = [
  'welcomeNewLead',
  'followUpWonDeal',
  'reengageStaleLead',
  'tagByForm',
] as const

export type CrmActionRecipeId = (typeof CRM_ACTION_RECIPE_IDS)[number]

/** What a recipe is handed before it builds — today only the form `tagByForm` reads. */
export type CrmActionRecipeInput = InteractionRecipeInput

export interface CrmActionRecipe extends InteractionRecipe {
  id: CrmActionRecipeId
}

/**
 * The field a resumed wait carries in its scope when it ended on the CLOCK
 * rather than on the event it watched for — the automation engine's word for
 * it, written into the step guard the stale-lead recipe stores.
 */
const WAIT_TIMED_OUT_FIELD = '_waitTimedOut'

/**
 * How long the stale-lead recipe holds before it decides a lead has gone
 * quiet. A week: long enough that a rep who is working the lead has had a
 * chance to move its stage, short enough that a lead nobody touched is
 * still warm when the reminder lands.
 */
export const STALE_LEAD_WAIT_MINUTES = 7 * 24 * 60

/**
 * The tag a form's captures get: the form's own name, cut to the tag cap.
 * The name is what the person calls the form, so it is the tag they would
 * have typed; the editor is open to change it before anything is saved.
 */
export function crmRecipeTagForForm(formName: string): string {
  return formName.trim().slice(0, CONTACT_TAG_MAX_LENGTH)
}

export const CRM_ACTION_RECIPES: readonly CrmActionRecipe[] = [
  {
    id: 'welcomeNewLead',
    title: 'Welcome a new lead',
    description:
      'When a form makes a new lead: rotate in an owner, book a call for ' +
      'tomorrow, send a thank-you, and tag them website.',
    /*
     * ON A NEW LEAD (AGL-3458), because that is the record a lead-routed form
     * makes: under the one-record model (AGL-3232) a form with lead routing
     * on files a LEAD and no contact, so a new-contact trigger would never
     * reach the people this recipe is named for. `formId` is on the `lead`
     * event exactly when a form filed the lead, so the condition keeps the
     * recipe to forms and leaves a booking request to the booking's own
     * confirmation. Every step below acts on the lead the event names when
     * the workspace holds no contact for the person.
     *
     * The owner first, because the task that follows names no assignee and
     * so goes to whoever owns the lead when it is created — the member the
     * rotation just chose. Round robin rather than a named member: a recipe
     * cannot know who is on the team, and the pool under CRM → Settings is
     * the one place that does. On a workspace with no pool the step fails
     * and the run continues, so the call, the email and the tag still land
     * and the run history says who was not assigned.
     *
     * The email comes before any wait, which makes it an immediate reply to
     * what the visitor just did — a transactional reply, sent from the org's
     * own identity to the address the event carries, with no unsubscribe.
     *
     * Its words promise no response time. The org hub installs this recipe
     * into a site without its editor opening, so the business never reads
     * the sentence it is sending, and a "within a day" written here would be
     * a commitment made on its behalf that nothing in the run keeps.
     */
    build: () => ({
      recipe: 'welcomeNewLead',
      name: 'Welcome a new lead',
      trigger: {
        event: 'lead',
        conditions: [{ field: 'formId', op: 'notEmpty' }],
        combinator: 'and',
      },
      steps: [
        { type: 'assignContactOwner', roundRobin: true },
        {
          type: 'createCrmTask',
          title: 'Call the new lead',
          kind: 'call',
          dueInDays: 1,
        },
        {
          type: 'sendEmail',
          subject: 'Thanks for getting in touch',
          body:
            'Hi {{firstName|there}},\n\nThanks for reaching out. We have your ' +
            'message and will reply to this email address.',
        },
        { type: 'addContactTag', tag: 'website' },
      ],
      enabled: true,
    }),
  },
  {
    id: 'followUpWonDeal',
    title: 'Follow up a won deal',
    description:
      'When a deal is won — which makes the contact a Customer on its own — ' +
      'book a check-in call a week out.',
    /*
     * No stage step (AGL-2641): the win itself floors the contact at
     * `customer` before `dealWon` is announced, so a step setting the stage
     * here would at best repeat the write and at worst move an evangelist
     * back to customer — a SET, which is what the step is, and not the
     * floor the win applies. The recipe books the follow-up and nothing
     * else.
     */
    build: () => ({
      recipe: 'followUpWonDeal',
      name: 'Follow up a won deal',
      trigger: { event: 'dealWon' },
      steps: [
        {
          type: 'createCrmTask',
          title: 'Check in with the new customer',
          kind: 'call',
          dueInDays: 7,
        },
      ],
      enabled: true,
    }),
  },
  {
    id: 'reengageStaleLead',
    title: 'Re-engage a stale lead',
    description:
      'When a contact becomes a lead: wait a week, and if their stage has ' +
      'not moved, book a call to bring them back.',
    /*
     * "Unless the stage moved on" is the wait's own event: the flow watches
     * for the next stage change on this person and gives up after a week.
     * Resumed by the clock, the run carries `_waitTimedOut`, and the task
     * step's guard reads it; resumed by the event, the field is absent and
     * the task is skipped — the lead was worked, and nobody is told to
     * re-engage somebody who just moved to Sales qualified.
     */
    build: () => ({
      recipe: 'reengageStaleLead',
      name: 'Re-engage a stale lead',
      trigger: {
        event: 'contactStageChanged',
        conditions: [{ field: 'lifecycleStage', op: 'equals', value: 'lead' }],
        combinator: 'and',
      },
      steps: [
        {
          type: 'waitForEvent',
          eventName: 'contactStageChanged',
          timeoutMinutes: STALE_LEAD_WAIT_MINUTES,
        },
        {
          type: 'createCrmTask',
          title: 'Re-engage a lead that has gone quiet',
          kind: 'call',
          dueInDays: 1,
          when: {
            conditions: [{ field: WAIT_TIMED_OUT_FIELD, op: 'notEmpty' }],
          },
        },
      ],
      enabled: true,
    }),
  },
  {
    id: 'tagByForm',
    title: 'Tag by form',
    description:
      'When a form you pick makes a new lead or contact: tag them with the ' +
      'form’s name.',
    picks: {
      kind: 'form',
      label: 'Form',
      plural: 'forms',
      prompt: 'Pick the form whose new leads or contacts get the tag.',
      none: 'This site has no forms yet. Add one in the besigner, then come back.',
    },
    /*
     * The event follows the form's routing (AGL-3458): a lead-routed form
     * makes a lead and no contact, so keyed on `contactCreated` it would
     * never fire. The Forms plugin shares the routing as the picked form's
     * `routesLeads` fact; both events carry `formId` when a form made the
     * record.
     */
    build: (input) => {
      const form = input?.picked
      return {
        recipe: 'tagByForm',
        name: form ? `Tag ${form.name.trim()} submissions` : 'Tag by form',
        trigger: {
          event: form?.facts?.['routesLeads'] === true ? 'lead' : 'contactCreated',
          conditions: [{ field: 'formId', op: 'equals', value: form?.id ?? '' }],
          combinator: 'and',
        },
        steps: [{ type: 'addContactTag', tag: form ? crmRecipeTagForForm(form.name) : '' }],
        enabled: true,
      }
    },
  },
]

/** The recipe with this id, or null for a string that names none. */
export function crmActionRecipe(id: unknown): CrmActionRecipe | null {
  return CRM_ACTION_RECIPES.find((recipe) => recipe.id === id) ?? null
}
