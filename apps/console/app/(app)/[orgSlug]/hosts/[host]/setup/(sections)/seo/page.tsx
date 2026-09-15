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

import { useCallback, useRef } from 'react'
import { useHostSubdomain } from '../../../../../../../../components/host-id-provider'
import PluginWidgetSlot from '../../../../../../../../components/plugin-widget-slot.component'
import SearchIndexingCard from '../../../../../../../../components/search-indexing-card.component'
import useCurrentOrg from '../../../../../../../../hooks/use-current-org'
import { useOrgSlug } from '../../../../../../../../hooks/use-org-scope'
import {
  HostSettingsForm,
  useHostSettingsScope,
} from '../../../host-settings-scope'

/**
 * SEO — the metadata a search engine reads, plus the switch that decides
 * whether it may read the site at all (AGL-2501).
 *
 * The indexing switch is its own card rather than a field on the schema: a
 * toggle that writes on change does not belong inside a form that writes on
 * save.
 *
 * The `hostSeo` zone sits above the form (AGL-2910). A widget there proposes
 * values for the form's fields — a structured-data description, the agent
 * guidance `/llms.txt` leads with — and they land in the form as unsaved
 * edits. The form's Update is still the only write, so nothing a widget
 * proposes reaches the published site until somebody saves it.
 */
export default function HostSetupSeoSection() {
  const { hostId, data, proposeFormDraft } = useHostSettingsScope()
  const { orgId } = useCurrentOrg()
  const orgSlug = useOrgSlug()
  const host = useHostSubdomain()
  /** The last proposal applied, so a widget that proposes the same thing twice applies it once. */
  const lastKeyRef = useRef<string | null>(null)
  const proposeDraft = useCallback(
    (values: Record<string, string>, key: string) => {
      if (key && key === lastKeyRef.current) return
      lastKeyRef.current = key || null
      proposeFormDraft('hostSeo', values)
    },
    [proposeFormDraft],
  )
  return (
    <>
      <PluginWidgetSlot
        slot="hostSeo"
        hostId={hostId}
        orgId={orgId}
        orgSlug={orgSlug}
        host={host ?? null}
        seo={data?.seo}
        proposeDraft={proposeDraft}
      />
      <HostSettingsForm schemaId="hostSeo" />
      <div style={{ marginTop: 24 }}>
        <SearchIndexingCard hostId={hostId} />
      </div>
    </>
  )
}
