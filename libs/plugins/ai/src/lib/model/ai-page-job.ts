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
  AI_BUILD_PLAN_CREATION_NOUNS,
  aiPlanUndeclaredRefs,
  type AiBuildPlan,
  type AiBuildPlanCreateKind,
} from './ai-build-plan'
import type { AiPlanUncreatable } from './ai-plan-capabilities'

/**
 * What a page job is (AGL-2907): the page types a brief may name, the inputs
 * the job doors admit, and the plans a page generator can build.
 *
 * A page job builds ONE screen. It places the site's components by id, binds
 * its forms by id, and renders inside a layout — and since AGL-3031 it first
 * builds the layout, forms and components its own plan creates, in the same
 * job, through the steps that own them, so a doctrine-correct plan is one it
 * finishes rather than one it sends the member away from. Anything else a
 * plan creates — a template, a theme change, a dataset, an email — is another
 * job's work, and such a plan is refused before anything is spent, with a
 * sentence naming what to make first.
 *
 * This module imports nothing at runtime, so the doors, the step, the console
 * dialog and the specs read one vocabulary.
 */

export type AiPageType =
  | 'landing'
  | 'about'
  | 'pricing'
  | 'contact'
  | 'blogIndex'
  | 'product'
  | 'service'
  | 'event'

export interface AiPageTypeDefinition {
  id: AiPageType
  /** The chip's label in the Describe dialog. */
  label: string
  /** What the page is for, as the plan and the generation are told. */
  purpose: string
}

export const AI_PAGE_TYPES: readonly AiPageTypeDefinition[] = [
  {
    id: 'landing',
    label: 'Landing',
    purpose: 'a landing page that makes one offer and asks for one action',
  },
  {
    id: 'about',
    label: 'About',
    purpose: 'an about page: who the business is, what it stands for and who is behind it',
  },
  {
    id: 'pricing',
    label: 'Pricing',
    purpose: 'a pricing page: the plans or packages, what each includes and how to start',
  },
  {
    id: 'contact',
    label: 'Contact',
    purpose: 'a contact page: how to reach the business, and where and when',
  },
  {
    id: 'blogIndex',
    label: 'Blog index',
    purpose: 'a blog index that lists the posts of the site’s content collection',
  },
  {
    id: 'product',
    label: 'Product',
    purpose: 'a page about one product: what it is, who it is for and how to get it',
  },
  {
    id: 'service',
    label: 'Service',
    purpose: 'a page about one service: what it covers, how it works and how to book it',
  },
  {
    id: 'event',
    label: 'Event',
    purpose: 'an event page: what it is, when and where, and how to attend',
  },
]

const PAGE_TYPE_BY_ID = new Map(AI_PAGE_TYPES.map((type) => [type.id, type]))

/** The definition of a page type id, or `null` for anything else. */
export function aiPageTypeDefinition(id: unknown): AiPageTypeDefinition | null {
  return typeof id === 'string' ? (PAGE_TYPE_BY_ID.get(id as AiPageType) ?? null) : null
}

export interface AiPageJobInputs {
  /** The type the member picked; `null` when they picked none. */
  pageType: AiPageType | null
}

/** A page job's inputs, or the sentence the door refuses them with. */
export function parseAiPageJobInputs(
  inputs: Readonly<Record<string, unknown>> | null | undefined,
): AiPageJobInputs | string {
  const raw = inputs?.['pageType']
  if (raw === undefined || raw === null || raw === '') return { pageType: null }
  const definition = aiPageTypeDefinition(raw)
  return definition
    ? { pageType: definition.id }
    : `pageType must be one of ${AI_PAGE_TYPES.map((type) => type.id).join(', ')}`
}

/** A creation a plan names, as the refusal lists it. */
export interface AiPagePrerequisite {
  kind: AiBuildPlanCreateKind
  name: string
}

/**
 * What the plan asks to be created that a page job does not build, in the
 * order the plan lists it, each named once: every entry is something a
 * member makes first.
 */
export function aiPagePlanPrerequisites(plan: AiBuildPlan): AiPagePrerequisite[] {
  const seen = new Set<string>()
  const prerequisites: AiPagePrerequisite[] = []
  const add = (kind: AiBuildPlanCreateKind, name: string) => {
    const key = `${kind}:${name.toLowerCase()}`
    if (seen.has(key)) return
    seen.add(key)
    prerequisites.push({ kind, name })
  }
  for (const entry of plan.create) {
    if (!AI_PAGE_CREATE_KINDS.includes(entry.kind)) add(entry.kind, entry.name)
  }
  // A reference the create list does not carry is refused by the plan rules
  // before a plan is kept: rule 2 for a screen's layout, rule 7 for anything
  // else (`plan-creation-undeclared`, AGL-3040). A plan confirmed before that
  // rule existed can still carry one. It is named as a component: the
  // reference carries no kind, and the refusal must say where one is made.
  for (const { name } of aiPlanUndeclaredRefs(plan)) add('component', name)
  return prerequisites
}

/**
 * The creations a page job builds itself from its own plan (AGL-3031): the
 * layout the page renders inside, and the forms and components it places.
 * Each is built before the page, as a draft, by the step that builds that
 * kind on its own. The plan step is told this list before it answers, and
 * the plan rules refuse a creation outside it with the one re-ask every rule
 * gets, so a plan that needs another never reaches a member's Confirm.
 */
export const AI_PAGE_CREATE_KINDS: readonly AiBuildPlanCreateKind[] = ['layout', 'form', 'component']

/**
 * Why a page job cannot build a plan of this SHAPE — no page, several pages,
 * a page with no sections — in a sentence a member reads; `null` when the
 * shape is one it builds. The plan step holds a plan to it with a re-ask, and
 * the doors hold a confirmed plan to it again through `aiPagePlanRefusal`.
 */
export function aiPagePlanShapeRefusal(plan: AiBuildPlan): string | null {
  if (plan.screens.length === 0) {
    return 'This plan has no page to build. Describe the page again.'
  }
  if (plan.screens.length > 1) {
    return `This plan builds ${plan.screens.length} pages, and a page job builds one. Describe each page on its own.`
  }
  if (!plan.screens[0].sections.length) {
    return 'This plan’s page has no sections to build. Describe the page again.'
  }
  return null
}

/**
 * Why a page job cannot build this plan, in a sentence a member reads when
 * confirming it; `null` when it can. A page job builds exactly one screen,
 * from what the site already has.
 */
export function aiPagePlanRefusal(plan: AiBuildPlan): string | null {
  const shape = aiPagePlanShapeRefusal(plan)
  if (shape) return shape
  const prerequisites = aiPagePlanPrerequisites(plan)
  if (!prerequisites.length) return null
  const parts = prerequisites.map(
    ({ kind, name }) => `the ${AI_BUILD_PLAN_CREATION_NOUNS[kind].noun} “${name}” ${AI_BUILD_PLAN_CREATION_NOUNS[kind].where}`,
  )
  const listed =
    parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
  return `This page needs what the site does not have yet. Create ${listed}, then describe the page again.`
}

/**
 * Why a page job cannot build the creations its plan names ON THIS SITE NOW,
 * in a sentence a member reads when confirming it: what the workspace's plan
 * does not include, or what the site has no room left for. The plan step was
 * told what could be created, so this is the site changing between the plan
 * and its confirmation.
 */
export function aiPageCreationRefusal(refused: readonly AiPlanUncreatable[]): string | null {
  if (!refused.length) return null
  const parts = refused.map(
    ({ kind, name, reason }) => `the ${AI_BUILD_PLAN_CREATION_NOUNS[kind].noun} “${name}”, because ${reason}`,
  )
  const listed =
    parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join('; ')}; and ${parts[parts.length - 1]}`
  return `This page cannot be built as planned: it creates ${listed}. Describe the page again.`
}
