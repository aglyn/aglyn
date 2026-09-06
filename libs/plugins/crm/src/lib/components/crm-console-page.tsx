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
import { CrmOrgMountProvider } from '../hooks/use-crm-org-mount'
import CompaniesSection from './companies-section'
import CompanyDetailPage from './company-detail-page'
import ContactDetailPage from './contact-detail-page'
import type { CrmConsoleSectionId } from './crm-console-sections'
import DealDetailPage from './deal-detail-page'
import DealsSection from './deals-section'
import FieldsSection from './fields-section'
import LeadDetailPage from './lead-detail-page'
import LeadsSection from './leads-section'
import ContactsSection from './contacts-section'
import ReportsSection from './reports-section'
import CrmSettingsSection from './settings-section'
import TasksSection from './tasks-section'

/**
 * The body of one Contacts section, built only when that section is the one
 * being read (AGL-2595).
 *
 * A function rather than a map of nodes on purpose: a `Record<id, ReactNode>`
 * would CONSTRUCT every section on every render, and the people list alone
 * opens four Firestore listens and an aggregate read on mount. Only the
 * returned branch is ever built.
 *
 * Three sections own a deeper route — a record beneath the list — and read
 * it off `detail`, the segments after the section id. A list section with
 * nothing after it is the list; one segment is the record; the shell has
 * already 404'd anything it could not resolve to this surface.
 */
function sectionBody(
  section: CrmConsoleSectionId,
  props: ConsolePluginPageProps,
  /** The section's OWN segments — `segments[1]` onward. */
  detail: readonly string[],
  basePath: string,
): ReactNode {
  const record = detail[0]
  const recordProps = {
    hostId: props.hostId,
    org: props.org,
    permissions: props.permissions,
    releaseFlag: props.releaseFlag,
    hostRole: props.hostRole,
    basePath,
  }
  switch (section) {
    case 'contacts':
      return record ? (
        <ContactDetailPage {...recordProps} id={record} />
      ) : (
        <ContactsSection {...props} />
      )
    case 'leads':
      /*
       * A lead lives under its site, so at the organization level the
       * address names the site before the id — `leads/{hostId}/{leadId}`
       * (AGL-2630) — and the record page is mounted UNDER that site: every
       * read and write it makes is host-scoped by path, exactly as on the
       * site's own hub. Under a site the id is the one segment it always
       * was.
       */
      return record ? (
        !props.hostId && detail.length >= 2 ? (
          <LeadDetailPage {...recordProps} hostId={record} id={detail[1]} />
        ) : (
          <LeadDetailPage {...recordProps} id={record} />
        )
      ) : (
        <LeadsSection {...props} />
      )
    case 'companies':
      return record ? (
        <CompanyDetailPage {...recordProps} id={record} />
      ) : (
        <CompaniesSection
          hostId={props.hostId}
          org={props.org}
          basePath={basePath}
        />
      )
    case 'deals':
      return record ? (
        <DealDetailPage {...recordProps} id={record} />
      ) : (
        <DealsSection {...props} />
      )
    case 'tasks':
      return <TasksSection {...props} />
    case 'reports':
      // The shell's props whole, like the contacts list: the reports resolve
      // the org scope from `hostId`, the consent group from `org`, and their
      // drill-down links from `basePath` (AGL-2604).
      return <ReportsSection {...props} />
    case 'fields':
      return <FieldsSection hostId={props.hostId} org={props.org} />
    case 'settings':
      // The org-wide switches (AGL-2613): what the CRM does on its own for
      // every site in the workspace, written to the org document.
      return <CrmSettingsSection hostId={props.hostId} org={props.org} />
    default:
      return null
  }
}

/**
 * Contacts (AGL-109 → AGL-395 → AGL-2595): the CRM hub — people, companies,
 * deals, tasks, reports and fields — owned by the contacts plugin and
 * rendered by the shell's generic plugin route. The shell applies the
 * `release_contacts` gate (via the nav tab) and passes the resolved `org`
 * doc, which the people section reads for the `contactsPerHost` quota.
 *
 * Sections are ROUTES, following the hubs that migrated before it (AGL-2501):
 * `/contacts/people` is the v1 list, and every other section is a URL of its
 * own, so the page builds one section's body and the others do not exist to
 * subscribe. The v1 body moved to `contacts-section.tsx` untouched; what this
 * file adds is the rail and the switch.
 */
export function CrmConsolePage(props: ConsolePluginPageProps) {
  const { section, sections, basePath, segments, orgMount } = props

  /*
   * Nothing until the URL names a section. The shell redirects a bare
   * `/contacts` to the landing section and holds a spinner while it does, so
   * this state is transient — and rendering the people list here instead
   * would pay for its listens on a URL that is already being replaced.
   */
  if (!section || !sections?.length || !basePath) return null

  const hub = (
    <HubSections sections={sections}>
      {sectionBody(
        section as CrmConsoleSectionId,
        props,
        // `segments[0]` IS the section — the shell resolved it into `section`
        // already — so what a section owns is everything after it.
        (segments ?? []).slice(1),
        basePath,
      )}
    </HubSections>
  )
  /*
   * THE ORGANIZATION-LEVEL MOUNT (AGL-2630). The shell hands an `orgMount`
   * only from `/[orgSlug]/crm`, where there is no site: the hub publishes it
   * so every section, record page and drawer beneath resolves its scope from
   * the org rather than from the `null` host it was handed. Under a site
   * there is no provider, and `useCrmOrgMount` answering `null` is how a
   * surface knows it is on one.
   */
  return orgMount ? (
    <CrmOrgMountProvider mount={orgMount}>{hub}</CrmOrgMountProvider>
  ) : (
    hub
  )
}
CrmConsolePage.displayName = 'CrmConsolePage'

export default CrmConsolePage
