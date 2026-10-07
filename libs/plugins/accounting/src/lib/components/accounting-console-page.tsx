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
import AccountingActivitySection from './accounting-activity-section'
import AccountingConnectionSection from './accounting-connection-section'
import type { AccountingConsoleSectionId } from './accounting-console-sections'

/**
 * The Accounting page (AGL-3614), mounted by the console's generic
 * ORGANIZATION-level route at `/[orgSlug]/accounting/<section>`. Code-split
 * by `plugin.ts`, so it loads only when the page is opened.
 *
 * The shell has decided access before this renders: the `release_accounting`
 * gate through the nav item's tab id, the `commerce` entitlement and the
 * `accounting.manage` permission declared on the extension.
 */
export function AccountingConsolePage(props: ConsolePluginPageProps) {
  const { section, sections } = props
  if (!section || !sections?.length) return null
  const orgId = props.orgMount?.orgId ?? null
  const id = section as AccountingConsoleSectionId
  return (
    <HubSections sections={sections}>
      {id === 'connection' ? <AccountingConnectionSection orgId={orgId} /> : null}
      {id === 'activity' ? <AccountingActivitySection orgId={orgId} /> : null}
    </HubSections>
  )
}
AccountingConsolePage.displayName = 'AccountingConsolePage'

export default AccountingConsolePage
