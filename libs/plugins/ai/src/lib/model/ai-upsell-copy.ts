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

import { aiAddonName } from '@aglyn/aglyn/app-utils/plan-entitlements'
import type { AiBriefKind } from './ai-brief-copy'

/**
 * What a "Create with AI" or "Ask AI" entry makes: the brief kinds, an
 * automation, products, a function or variable, an overlay, and an answer
 * about the figures on a page.
 */
export type AiUpsellKind =
  | AiBriefKind
  | 'workflow'
  | 'product'
  | 'logic'
  | 'overlay'
  | 'funnel'
  | 'insight'

/** What one entry's dialog says. */
export interface AiUpsellCopy {
  title: string
  does: string
  /** The entry's own label, which the button reads and the offer names; "Create with AI" when absent. */
  label?: string
}

/** The label every "Create with AI" entry reads. */
export const AI_UPSELL_CREATE_LABEL = 'Create with AI'

/** What the dialog says one entry would do here. */
export const AI_UPSELL_COPY: Readonly<Record<AiUpsellKind, AiUpsellCopy>> = {
  page: {
    title: 'Create a page with AI',
    does:
      'Describe the page you need and AI plans it from your brief, using your theme and ' +
      'what the site already has. You confirm the plan, and the page is built as an ' +
      'unpublished draft.',
  },
  template: {
    title: 'Create a page template with AI',
    does:
      'Describe what each page should show and AI plans the template, filling what ' +
      'changes from page to page from each record. You confirm the plan, and the template ' +
      'is built as a draft in your library.',
  },
  layout: {
    title: 'Create a layout with AI',
    does:
      'Describe what the layout should hold and AI plans it, linking your pages and placing ' +
      'your navigation or menu component when the site has one. You confirm the plan, and ' +
      'the layout is built as a draft no page uses until you assign it.',
  },
  form: {
    title: 'Create a form with AI',
    does:
      'Describe what the form is for and AI plans its fields, its marketing consent and ' +
      'where each submission goes. You confirm the plan, and the form is built as a draft.',
  },
  component: {
    title: 'Create a reusable component with AI',
    does:
      'Describe what the component should show and AI plans it, making what each page can ' +
      'change into its properties. You confirm the plan, and the component is built as a ' +
      'draft.',
  },
  workflow: {
    title: 'Create an automation with AI',
    does:
      'Describe what should happen, and when, and AI drafts the automation from the ' +
      'triggers and steps your plan includes. It is saved switched off for you to review.',
  },
  email: {
    title: 'Create an email with AI',
    does:
      'Describe the email you need and AI plans a design from the email blocks, with three ' +
      'subject lines and three preheaders to choose between. You confirm the plan, and the ' +
      'design is built as a draft that is sent to nobody.',
  },
  campaign: {
    title: 'Create a campaign with AI',
    does:
      'Describe what the campaign is for and AI writes its email design and a draft campaign ' +
      'that would send it. Nothing is sent or scheduled, and the campaign is aimed at nobody ' +
      'until you pick its lists.',
  },
  product: {
    title: 'Create products with AI',
    does:
      'Describe what the store sells and AI proposes up to twelve products. You review them ' +
      'before any is created, and each is created as a draft at a suggested price that is not on ' +
      'your storefront until you review it and activate it.',
  },
  logic: {
    title: 'Create a function or variable with AI',
    does:
      'Describe what it should work out or hold and AI drafts the function or variable. It ' +
      'opens unsaved in the editor for you to check and save.',
  },
  overlay: {
    title: 'Create an overlay with AI',
    does:
      'Describe the announcement bar or popup you want and AI writes its copy within the ' +
      'overlay’s limits. It is saved switched off, for you to check and turn on.',
  },
  funnel: {
    title: 'Create a funnel with AI',
    does:
      'Describe the journey you want to measure and AI proposes its steps from the site’s ' +
      'real pages, forms and products. It opens in the funnel editor for you to check and save.',
  },
  insight: {
    title: 'Ask AI about these numbers',
    label: 'Ask a question',
    does:
      'Ask a question about the figures on this page and AI answers from them, every answer ' +
      'traced to the figures it is built from. It reads; it changes nothing.',
  },
}

/** The label an entry's button reads. */
export function aiUpsellLabel(kind: AiUpsellKind): string {
  return AI_UPSELL_COPY[kind].label ?? AI_UPSELL_CREATE_LABEL
}

/**
 * The sentence that says where the feature comes from, and who can add it.
 * `feature` is what the entry is called: "Create with AI" unless it is an ask.
 */
export function aiUpsellOffer(canManageBilling: boolean, feature = AI_UPSELL_CREATE_LABEL): string {
  // Since AGL-3965 every paid plan's own credits pay for generation, so this
  // door is reached only where it is switched off for the workspace and an
  // Aglyn AI tier (which switches it on with its credits) is for sale.
  const addon = aiAddonName()
  return canManageBilling
    ? `${feature} is switched off for this workspace. It comes with an ${addon} ` +
        'tier, which you can choose in Billing.'
    : `${feature} is switched off for this workspace. It comes with an ${addon} ` +
        'tier. Ask a workspace owner or admin to choose one in Billing.'
}
