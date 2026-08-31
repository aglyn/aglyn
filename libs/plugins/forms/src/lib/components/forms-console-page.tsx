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
import FormDetailCard from './form-detail-card'
import HostFormsCard from './host-forms-card.component'

/**
 * The Forms console surface: the catalog, and one form beneath it.
 *
 * A LIST WITH ENTITY ROUTES, not a hub with a rail. `/forms/{formId}` is one
 * of the rows, and the set of ids is a property of the site's data, so there
 * is no static section list that could name them — which is what the nav
 * item's `ownsSubtree` asks for. The alternative, an invented single section,
 * would put a one-item rail above every form and a meaningless segment in
 * every URL.
 *
 * The detail surface is a ROUTE rather than an expanded row for the same two
 * reasons a campaign's is: it is linkable, which is what an author wants to
 * paste into a message about a form that stopped collecting; and the version
 * history and the design preview are this surface's expensive reads, so a
 * reader who came for the list must not pay for them.
 */
export function FormsConsolePage(props: ConsolePluginPageProps) {
  const { hostId, basePath, segments, hostRole, org } = props
  // Everything under the surface's own href is a form id — see `ownsSubtree`.
  const formId = (segments ?? [])[0]

  return formId ? (
    <FormDetailCard
      hostId={hostId}
      formId={formId}
      basePath={basePath}
      canPublish={hostRole?.canPublish ?? false}
      hostRoleLoaded={hostRole?.loaded ?? false}
    />
  ) : (
    <HostFormsCard hostId={hostId} basePath={basePath} org={org} />
  )
}
FormsConsolePage.displayName = 'FormsConsolePage'

export default FormsConsolePage
