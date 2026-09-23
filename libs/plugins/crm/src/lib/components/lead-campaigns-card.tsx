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

import {
  campaignMembershipUnchanged,
  campaignMembershipValue,
  pluginDocsHelp,
  readCampaignIds,
} from '@aglyn/aglyn'
import CampaignPicker, {
  type CampaignPickerOption,
} from '@aglyn/shared-ui-email-campaigns/components/campaign-picker.component'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  type FirestoreDocStatus,
  useFirestore,
  writeGuardedBySeed,
} from '@aglyn/tenant-feature-instance'
import { Button, Stack } from '@mui/material'
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { useCrmScope } from '../hooks/use-crm-scope'

/** The helper line under the picker — the contact card's, word for word. */
export const LEAD_CAMPAIGNS_HELPER_TEXT =
  'Your own filing. It never adds anyone to a send — a campaign mails its lists.'

/**
 * The campaigns a lead is filed under, as NAMES for the record header.
 *
 * Resolved from the site's containers; an id with no live container — a
 * campaign the console deleted, or one still loading — is left out rather
 * than shown, because a document id on a chip tells a reader nothing and
 * looks like a fault. The picker below keeps such an id visible as itself,
 * so the filing is never silently lost; the header only ever names.
 */
export function leadCampaignNames(
  lead: Record<string, unknown> | null | undefined,
  options: readonly CampaignPickerOption[],
): string[] {
  const labels = new Map(options.map((option) => [option.value, option.label]))
  return readCampaignIds(lead)
    .map((id) => labels.get(id))
    .filter((name): name is string => Boolean(name))
}

export interface LeadCampaignsCardProps {
  /**
   * The lead's own site, or `null` at the organization level for a lead no
   * site captured (AGL-3278). Read for the org root alone — the containers
   * themselves are handed down as `options` — so the card serves both
   * levels; the org-level mount answers the same org without a site.
   */
  hostId: string | null
  leadId: string
  lead: Record<string, unknown>
  leadStatus: FirestoreDocStatus
  /** The listener has not confirmed this document with the server yet. */
  fromCache: boolean
  /** The site's campaigns, read once by the page for this card and the header. */
  options: readonly CampaignPickerOption[]
  /** The campaign read has answered — false while it settles. */
  optionsReady: boolean
  /**
   * What a saved filing changed, once it has landed: the ids added to and
   * removed from the lead's membership. The page files the activity
   * entries (AGL-3274); the card only knows the document.
   */
  onFiled?: (change: { added: string[]; removed: string[] }) => void
}

/**
 * WHICH CAMPAIGNS THIS LEAD IS FILED UNDER (AGL-3274).
 *
 * The contact's Relationship card has carried this picker since AGL-2596;
 * the lead's page had none, so a lead filed under a campaign by the New
 * lead drawer, the bulk bar or a sequence's enroll showed nothing of it —
 * the one field on the record the reader had no way to see or change.
 *
 * The same control, the same value helper, the same helper line. The save
 * is the lead's own client door — a one-field `update` on
 * `hosts/{hostId}/leads`, as the properties card writes status and notes —
 * guarded by the seed like every draft edited over a cached read, and
 * `campaignMembershipUnchanged` keeps Save quiet while the picker only
 * reorders what is stored.
 *
 * It is FILING, not audience: the helper says so, in the sentence the
 * contact card uses, because a reader who finds a campaign picker on a
 * person's page assumes the opposite.
 */
export function LeadCampaignsCard(props: LeadCampaignsCardProps) {
  const { hostId, leadId, lead, leadStatus, fromCache, options, optionsReady, onFiled } = props
  // The lead's collection is the org's now (AGL-3275); the site still names
  // the surface, and the scope hook resolves the org from it.
  const { orgId } = useCrmScope({ hostId })
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const stored = readCampaignIds(lead)
  const [selected, setSelected] = useState<string[]>(stored)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  // A newer membership from the server replaces an UNEDITED selection — a
  // sequence's enroll or a bulk add lands while the page is open — and an
  // edited one is the reader's, decided by the guard on save.
  const storedKey = stored.join(',')
  useEffect(() => {
    if (!dirty) setSelected(stored)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storedKey, dirty])

  const unchanged = campaignMembershipUnchanged(stored, selected)
  const empty = optionsReady && !options.length

  const save = async () => {
    if (unchanged) return
    if (!orgId) {
      enqueueSnackbar('Still loading this workspace — try again in a moment.', {
        variant: 'warning',
        persist: false,
      })
      return
    }
    setSaving(true)
    const next = campaignMembershipValue(selected)
    const verdict = await writeGuardedBySeed(
      { subject: 'lead', fromCache, unreadable: leadStatus === 'error' },
      async () => {
        await updateDoc(doc(firestore, 'orgs', orgId, 'leads', leadId), {
          campaignIds: next,
          updatedAt: serverTimestamp(),
        })
      },
    )
    setSaving(false)
    if (!verdict.ok) {
      enqueueSnackbar(verdict.message ?? 'The filing could not be saved.', { variant: 'warning' })
      return
    }
    setDirty(false)
    enqueueSnackbar('Filing saved', { variant: 'success', persist: false })
    onFiled?.({
      added: next.filter((id) => !stored.includes(id)),
      removed: stored.filter((id) => !next.includes(id)),
    })
  }

  return (
    <CardDisplay
      header={'Campaigns'}
      help={pluginDocsHelp('crmLeads', { anchor: '#a-leads-page' })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        <CampaignPicker
          options={options}
          value={selected}
          onChange={(next) => {
            setSelected(next)
            setDirty(true)
          }}
          label="Filed under campaigns"
          helperText={LEAD_CAMPAIGNS_HELPER_TEXT}
          disabled={saving}
          empty={empty}
          emptyText="There are no campaigns to file this lead under yet. Create one from Marketing."
        />
        {empty ? null : (
          <Stack direction="row">
            <Button
              size="small"
              variant="outlined"
              disabled={saving || unchanged}
              onClick={() => void save().catch((error: unknown) => {
                console.error(error)
                enqueueSnackbar(
                  error instanceof Error && error.message ? error.message : 'An error has occurred',
                  { variant: 'error', allowDuplicate: true },
                )
                setSaving(false)
              })}
            >
              {saving ? 'Saving…' : 'Save filing'}
            </Button>
          </Stack>
        )}
      </Stack>
    </CardDisplay>
  )
}
LeadCampaignsCard.displayName = 'LeadCampaignsCard'

export default LeadCampaignsCard
