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

import type { ConsoleNavSection } from '@aglyn/aglyn'

export type WorkflowsConsoleSectionId =
  | 'workflows'
  | 'actions'
  | 'webhooks'
  // The ORGANIZATION hub's own section (AGL-3302); no site rail carries it.
  | 'automations'

/**
 * The workflows console's sections, in rail order (AGL-2501).
 *
 * One list, read twice and never copied: `plugin.ts` registers it on the nav
 * item so the shell can route and gate each section, and the page switches its
 * body on the id the shell resolves back.
 *
 * Ids are the `?tab=` ids this page already deep-linked by, kept deliberately
 * so a bookmark that named a tab names the same section as a route.
 *
 * No `navTabId` on any of them: they inherit the Workflows nav item's gate,
 * which is `nav-tab-workflows`. The per-card ENTITLEMENT checks are unchanged
 * and still live in the cards — workflows, actions and webhooks are distinct
 * plan flags, and a plan is not a release flag.
 */
export const WORKFLOWS_CONSOLE_SECTIONS: readonly ConsoleNavSection[] = [
  { id: 'workflows', label: 'Workflows' },
  { id: 'actions', label: 'Actions' },
  { id: 'webhooks', label: 'Webhooks' },
]

/*
 * Rail ORDER decides where `/workflows` lands: the shell redirects a bare hub
 * URL to the first section in this list the reader may open (AGL-2501). There
 * is deliberately no separate default constant — a second place to say which
 * section is first is a second place for it to disagree with the rail.
 */

/**
 * The ORGANIZATION-level Automation hub's sections, at `/[orgSlug]/automation`
 * (AGL-3302).
 *
 * Org automations come first because they are the one thing that lives here
 * and nowhere else: the organization writes them once and places them on the
 * sites it chooses. The other three are the sites' own workflows, actions and
 * webhooks listed side by side with the site each belongs to — each row opens
 * in that site's hub, where it is edited, because a workflow calls its site's
 * functions and a webhook holds its site's secret.
 *
 * The ids are the site rail's for the three it shares, so a link built for
 * one level reads the same at the other. `automations` takes the `actions`
 * entitlement: an org automation is built from the actions builder's steps,
 * so the plan that carries one carries the other, and the shell draws the
 * section locked — with its upgrade notice — for a plan without it.
 */
export const WORKFLOWS_ORG_CONSOLE_SECTIONS: readonly ConsoleNavSection[] = [
  { id: 'automations', label: 'Org automations', featureFlag: 'actions' },
  { id: 'workflows', label: 'Workflows' },
  { id: 'actions', label: 'Actions' },
  { id: 'webhooks', label: 'Webhooks' },
]
