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

import { Stack } from '@mui/material'
import { useCallback, useRef } from 'react'
import AppIconCard from '../../../../../../../../components/app-icon-card.component'
import EntityLogoCard from '../../../../../../../../components/entity-logo-card.component'
import FaviconCard from '../../../../../../../../components/favicon-card.component'
import { useHostSubdomain } from '../../../../../../../../components/host-id-provider'
import PluginWidgetSlot from '../../../../../../../../components/plugin-widget-slot.component'
import SearchIndexingCard from '../../../../../../../../components/search-indexing-card.component'
import SocialImageCard from '../../../../../../../../components/social-image-card.component'
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
 * A STACK OF CARDS (AGL-3258), which is what every other settings section in
 * the console is. Entity, its Address and the AI-agent guidance were
 * `SUB_FORM` groups inside the SEO card under headings of their own, and the
 * four media controls were drawn inside that same card by a bespoke form
 * template — so this section looked like nothing else in the product. Each is
 * a card now, each with its own header, help tip and Update, and each media
 * control sits beside the card it is about: the entity logo under Entity, the
 * icons and the social image under the titles they accompany.
 *
 * Order is the point, as it was when they were sections (AGL-2486). Entity is
 * followed immediately by the logo that belongs to it; putting the favicon
 * between them is what made the entity read as separated in the first place.
 *
 * The indexing switch is its own card rather than a field on a schema: a
 * toggle that writes on change does not belong inside a form that writes on
 * save. It is last because it is the only control here that is not metadata.
 *
 * The `hostSeo` zone sits at the top (AGL-2910). A widget there proposes
 * values for these fields — a structured-data description, the agent guidance
 * `/llms.txt` leads with — and they land in the forms as unsaved edits,
 * routed to whichever card owns each field. Every card's Update is still the
 * only write, so nothing a widget proposes reaches the published site until
 * somebody saves it.
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
      proposeFormDraft(values)
    },
    [proposeFormDraft],
  )
  return (
    <Stack spacing={3}>
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
      <FaviconCard hostId={hostId} />
      {/* Beside the favicon, which is the icon it is most often confused
          with: both are the site's mark drawn small by somebody else's
          chrome, and seeing the two together is what makes the difference in
          size and shape legible. */}
      <AppIconCard hostId={hostId} />
      <SocialImageCard hostId={hostId} />
      <HostSettingsForm schemaId="hostSeoEntity" />
      <EntityLogoCard hostId={hostId} />
      <HostSettingsForm schemaId="hostSeoAddress" />
      <HostSettingsForm schemaId="hostSeoAgent" />
      <SearchIndexingCard hostId={hostId} />
    </Stack>
  )
}
