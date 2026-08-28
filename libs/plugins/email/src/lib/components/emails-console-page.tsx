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
import { useRouter } from 'next/navigation'
import { useEffect, type ReactNode } from 'react'
import CampaignsCard from './campaigns-card'
import EmailScreensCard from './email-screens-card'
import ListsCard from './lists-card'
import SuppressionsCard from './suppressions-card'
import {
  DEFAULT_EMAILS_CONSOLE_SECTION,
  type EmailsConsoleSectionId,
} from './emails-console-sections'

/**
 * The body of one emails section, built only when that section is the one
 * being read (AGL-693).
 *
 * A function rather than a map of nodes on purpose: a `Record<id, ReactNode>`
 * would CONSTRUCT all four every render, and each card opens its Firestore
 * listens on mount — which is the entire cost this page exists to stop paying.
 * Only the returned branch is ever built.
 */
function sectionBody(
  section: EmailsConsoleSectionId,
  hostId: string,
): ReactNode {
  switch (section) {
    case 'campaigns':
      return <CampaignsCard hostId={hostId} />
    case 'designs':
      return <EmailScreensCard hostId={hostId} />
    case 'audiences':
      return <ListsCard hostId={hostId} />
    case 'suppressions':
      return <SuppressionsCard hostId={hostId} />
    default:
      return null
  }
}

/**
 * Emails page (AGL-395): the console surface owned by the email plugin,
 * rendered by the shell's generic plugin route — Campaigns composer/history,
 * the designed-email list (which no longer clutters the main Screens list),
 * audience lists, and since AGL-2410 the suppression list, which had been
 * written by two paths and displayed by none.
 *
 * Sections are ROUTES (AGL-693). `HubTabs lazy` already mounted one panel, so
 * this is not a read saving — `emails-console-read-cost.spec.tsx` was written
 * BEFORE the conversion precisely to hold that line, and reports the same
 * counts after. What routing adds is that the URL names the section: it is
 * linkable, the back button walks sections, the breadcrumb says where you are,
 * and "mount only what is open" is structural rather than a `lazy` flag
 * somebody has to remember on the next surface.
 */
export function EmailsConsolePage(props: ConsolePluginPageProps) {
  const { hostId, section, sections, basePath } = props
  const router = useRouter()

  /*
   * `/emails` names no section, so it lands on the first one the reader may
   * open. The FIRST VISIBLE one, not the default outright: a section can be
   * held behind its own release flag, and redirecting to one this viewer is
   * refused would answer the nav tab with a "coming soon" notice.
   *
   * `replace`, not `push`: a redirect the reader did not ask for must not
   * become a history entry their back button bounces off.
   */
  const landing =
    sections?.find(
      (item) => item.visible && item.id === DEFAULT_EMAILS_CONSOLE_SECTION,
    ) ?? sections?.find((item) => item.visible)

  useEffect(() => {
    if (section || !landing) return
    router.replace(landing.href)
  }, [section, landing, router])

  /*
   * Nothing, deliberately, while the redirect is in flight. Rendering the
   * default section here would issue its listens on a URL about to be
   * replaced — on every arrival at `/emails`, which is every nav-tab click.
   */
  if (!section || !sections?.length || !basePath) return null

  return (
    <HubSections sections={sections}>
      {sectionBody(section as EmailsConsoleSectionId, hostId)}
    </HubSections>
  )
}
EmailsConsolePage.displayName = 'EmailsConsolePage'

export default EmailsConsolePage
