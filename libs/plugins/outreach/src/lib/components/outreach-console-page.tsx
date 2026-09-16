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
'use client'

import type { ConsolePluginPageProps } from '@aglyn/aglyn'
import { HubSections } from '@aglyn/shared-ui-next'
import type { ReactNode } from 'react'
import MailboxesSection from './mailboxes-section'
import type { OutreachConsoleSectionId } from './outreach-console-sections'
import SequencesSection from './sequences-section'

/**
 * The body of the section being read, and only that one — a function rather
 * than a map of nodes so an unopened section is never constructed, which is
 * what keeps its listens closed once sections read data.
 */
function sectionBody(section: OutreachConsoleSectionId): ReactNode {
  switch (section) {
    case 'sequences':
      return <SequencesSection />
    case 'mailboxes':
      return <MailboxesSection />
    default:
      return null
  }
}

/**
 * The Outreach hub (AGL-2974), mounted by the console's generic
 * ORGANIZATION-level route at `/[orgSlug]/outreach/<section>`.
 *
 * The shell has already decided everything about access before this renders:
 * the `release_outreach` gate through the nav item's tab id, the
 * `features.outreach` entitlement and the `outreach.use` permission declared
 * on the extension, and org-wide reach. It hands over `hostId: null` and an
 * `orgMount`; the sections take what they need from those as they gain data.
 */
export function OutreachConsolePage(props: ConsolePluginPageProps) {
  const { section, sections, basePath } = props

  /*
   * Nothing until the URL names a section. The shell redirects a bare
   * `/outreach` to the landing section and holds a spinner while it does, so
   * this state is transient.
   */
  if (!section || !sections?.length || !basePath) return null

  return (
    <HubSections sections={sections}>
      {sectionBody(section as OutreachConsoleSectionId)}
    </HubSections>
  )
}
OutreachConsolePage.displayName = 'OutreachConsolePage'

export default OutreachConsolePage
