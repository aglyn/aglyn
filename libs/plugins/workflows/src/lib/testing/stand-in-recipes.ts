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
  type InteractionRecipe,
  registerInteractionRecipes,
} from '@aglyn/aglyn/plugin-manager/interaction-recipes'
import { registerPluginRecordListSource } from '@aglyn/aglyn/plugin-manager/plugin-record-lists'
import { collection, documentId, limit, orderBy, query } from 'firebase/firestore'

/**
 * The CRM's four recipes (AGL-2626), stood in for this plugin's specs — this
 * plugin may not load the CRM, which writes them and registers them through
 * the platform's recipe seam (AGL-3080). Built as the CRM builds them, so the
 * editor is driven with the automations it is really handed; what the CRM's
 * recipes ARE is held in the CRM's own spec, and that each is an automation
 * this plugin accepts in `apps/console/specs/interaction-recipes.spec.ts`.
 */
export const STAND_IN_RECIPES: readonly InteractionRecipe[] = [
  {
    id: 'welcomeNewLead',
    title: 'Welcome a new lead',
    description:
      'When a form makes a new lead: rotate in an owner, book a call for ' +
      'tomorrow, send a thank-you, and tag them website.',
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
        { type: 'createCrmTask', title: 'Call the new lead', kind: 'call', dueInDays: 1 },
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
    build: () => ({
      recipe: 'followUpWonDeal',
      name: 'Follow up a won deal',
      trigger: { event: 'dealWon' },
      steps: [
        { type: 'createCrmTask', title: 'Check in with the new customer', kind: 'call', dueInDays: 7 },
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
    build: () => ({
      recipe: 'reengageStaleLead',
      name: 'Re-engage a stale lead',
      trigger: {
        event: 'contactStageChanged',
        conditions: [{ field: 'lifecycleStage', op: 'equals', value: 'lead' }],
        combinator: 'and',
      },
      steps: [
        { type: 'waitForEvent', eventName: 'contactStageChanged', timeoutMinutes: 7 * 24 * 60 },
        {
          type: 'createCrmTask',
          title: 'Re-engage a lead that has gone quiet',
          kind: 'call',
          dueInDays: 1,
          when: { conditions: [{ field: '_waitTimedOut', op: 'notEmpty' }] },
        },
      ],
      enabled: true,
    }),
  },
  {
    id: 'tagByForm',
    title: 'Tag by form',
    description:
      'When a form you pick makes a new lead or contact: tag them with the form’s name.',
    picks: {
      kind: 'form',
      label: 'Form',
      plural: 'forms',
      prompt: 'Pick the form whose new leads or contacts get the tag.',
      none: 'This site has no forms yet. Add one in the besigner, then come back.',
    },
    build: (input) => {
      const form = input?.picked
      return {
        recipe: 'tagByForm',
        name: form ? `Tag ${form.name.trim()} submissions` : 'Tag by form',
        trigger: {
          // A lead-routed form makes a lead and no contact (AGL-3458).
          event: form?.facts?.['routesLeads'] === true ? 'lead' : 'contactCreated',
          conditions: [{ field: 'formId', op: 'equals', value: form?.id ?? '' }],
          combinator: 'and',
        },
        steps: [{ type: 'addContactTag', tag: form ? form.name.trim().slice(0, 60) : '' }],
        enabled: true,
      }
    },
  },
]

/** Registers the stood-in recipes as the CRM's declarations would. */
export function standInRecipes(): void {
  registerInteractionRecipes(STAND_IN_RECIPES, { pluginId: 'crm' })
}

/**
 * The `form` list source the Forms plugin publishes (AGL-3080), stood in: a
 * site's forms by document id, an archived one left out, a form named by its
 * display name or its id, and whether it files leads shared as its
 * `routesLeads` fact. What the Forms plugin itself answers is held in its own
 * spec.
 */
export function standInFormList(): void {
  registerPluginRecordListSource(
    'form',
    {
      query(firestore, request) {
        if (!request.hostId) return null
        return query(
          collection(firestore, 'hosts', request.hostId, 'forms'),
          orderBy(documentId()),
          limit(request.limit),
        )
      },
      record(id, data) {
        if (data['archivedAt'] != null) return null
        const routing = data['routing'] as { lead?: unknown } | null | undefined
        return {
          id,
          name: String(data['displayName'] ?? '').trim() || id,
          facts: { routesLeads: routing?.lead === true },
        }
      },
    },
    { pluginId: 'forms' },
  )
}
