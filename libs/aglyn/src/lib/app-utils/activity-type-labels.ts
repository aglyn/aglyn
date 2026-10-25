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

/*
 * The nouns an activity row names its target by, apart from the presenter so the native apps read the same words from
 * the contracts (AGL-4011). No imports.
 */

/** Human, singular noun for a target type. Falls back to the raw type. */
export const ACTIVITY_TYPE_LABELS: Readonly<Record<string, string>> = {
  host: 'Site',
  screen: 'Page',
  layout: 'Layout',
  theme: 'Theme',
  media: 'Media',
  content: 'Content',
  variable: 'Variable',
  function: 'Function',
  workflow: 'Workflow',
  member: 'Member',
  component: 'Component',
  template: 'Template',
  org: 'Organization',
  invite: 'Invitation',
  subscription: 'Subscription',
  // A custom role's permission flipped (AGL-2929).
  role: 'Role',
  // CRM records (AGL-2622): a person added, a company or a deal created or
  // deleted, a lead converted — logged into the feed of the site whose
  // console did it, and linked to the record the way a screen is.
  contact: 'Contact',
  lead: 'Lead',
  company: 'Company',
  deal: 'Deal',
}
