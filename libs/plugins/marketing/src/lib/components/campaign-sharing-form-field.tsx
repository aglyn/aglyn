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

import type { ScopeSharingChoice } from '@aglyn/aglyn/app-utils/scope-tokens'
import {
  SiteSharingField,
  type SiteSharingSite,
} from '@aglyn/shared-ui-jsx/components/site-sharing-field.component'
import { FormFieldGrid } from '@aglyn/shared-ui-jsx-forms/mapper/form-field-grid'
import { useFieldApi } from '@aglyn/shared-ui-jsx-forms/vendor/data-driven-forms'
import { Typography } from '@mui/material'
import { useMemo } from 'react'
import { campaignSharingWrite } from '../model/campaign-container'

/** The `component` name the create drawer's sharing field asks for. */
export const CAMPAIGN_SHARING_FIELD = 'campaign-site-sharing'

/**
 * Who a new campaign is shared with, in the console's create drawer
 * (AGL-4047): the shared `SiteSharingField`, radios and a visible list of
 * sites, never a dropdown. It holds the choice; what the choice writes, and
 * whether it can be, is `campaignSharingWrite`, asked here to say why before
 * the create, and again by the create itself and by the manage route.
 */
export function CampaignSharingFormField(props: Record<string, unknown>) {
  const { input, meta, sites, sitesReady, label, helperText } = useFieldApi(props as never) as unknown as {
    input: { value: ScopeSharingChoice | ''; onChange: (next: ScopeSharingChoice) => void }
    meta: { submitError?: unknown; dirtySinceLastSubmit?: boolean }
    sites?: readonly SiteSharingSite[]
    sitesReady?: boolean
    label?: string
    helperText?: string
  }
  const value = input.value ? input.value : null
  const named = useMemo(() => sites ?? [], [sites])
  const ready = sitesReady !== false
  // Nothing to say about leaving sites out until the sites have been read.
  const problem = useMemo(() => {
    if (!value || (value.mode === 'allExcept' && !ready)) return null
    return campaignSharingWrite(
      value,
      named.map((site) => site.id),
    ).problem
  }, [value, named, ready])
  /*
   * Why the create refused this choice, said beside it (AGL-4047): the drawer
   * keeps the choice, and the reason goes once the choice changes. The live
   * answer above comes first; the create's own answer covers what only it
   * knows, such as the sites not having been read yet.
   */
  const refusal =
    typeof meta?.submitError === 'string' && !meta.dirtySinceLastSubmit ? meta.submitError : null
  return (
    <FormFieldGrid>
      <SiteSharingField
        label={label ?? 'Shared with'}
        value={value}
        onChange={input.onChange}
        sites={named}
        sitesReady={ready}
        problem={problem ?? refusal}
      />
      {helperText ? (
        <Typography variant="caption" color="text.secondary" component="p">
          {helperText}
        </Typography>
      ) : null}
    </FormFieldGrid>
  )
}
CampaignSharingFormField.displayName = 'CampaignSharingFormField'

export default CampaignSharingFormField
