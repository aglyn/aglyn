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

import * as Aglyn from '@aglyn/aglyn'
import {
  CONTACT_SOURCE_LABELS,
  type ConsentGroup,
  type ContactSource,
  MARKETING_BASIS_LABELS,
  personKeyInBrowser,
  readMarketingBasis,
} from '@aglyn/aglyn'
/*
 * The component path and NOT the marketing barrel: that barrel is the entry
 * point the tenant's loader imports to activate the plugin's SITE half, so a
 * console card named there ships to every published page.
 */
import { default as ConversionAttribution } from '@aglyn/plugins-marketing/components/conversion-attribution.component'
import CampaignPicker from '@aglyn/shared-ui-email-campaigns/components/campaign-picker.component'
import { AppLink, CardDisplay } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  useFirestore,
  useHostCampaigns,
  writeGuardedBySeed,
} from '@aglyn/tenant-feature-instance'
import { Button, Chip, Divider, Stack, Typography } from '@mui/material'
import { doc, getDoc, updateDoc } from 'firebase/firestore'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ContactRecord } from '../model/contact-record'
import { crmRoutes } from '../model/crm-routes'

export interface ContactAssociationsCardProps {
  /**
   * The site whose lead, campaigns and attribution are shown — the mounted
   * site, or at the organization level the holder's own; `null` for a row
   * no site has captured, when none of the three has an address.
   */
  hostId: string | null
  /** The row, flattened through the viewing group's facet. */
  record: ContactRecord
  /** The document as read, for the consent fields the projection leaves out. */
  row: Record<string, unknown>
  consentGroup: ConsentGroup
  /** `['orgs', orgId]` — where the contact document lives. */
  scope: readonly [string, string]
  /** The listener's verdict on the row, for the stale-seed guard. */
  seed: { status: 'loading' | 'success' | 'error'; fromCache: boolean }
  /** The hub's own path, for the link to this person's lead. */
  basePath: string
}

/**
 * WHERE THIS PERSON CAME FROM AND WHAT THEY ARE FILED UNDER (AGL-2596).
 *
 * Four facts that were in the v1 drawer and are not properties of the
 * person so much as of the RELATIONSHIP:
 *
 *  - The SOURCES say which mechanism created the record — a form, a
 *    checkout, an import.
 *  - The ATTRIBUTION says which campaign led to it, recorded from the link
 *    they followed and never editable. One keyed read, paid on opening the
 *    page rather than per row of the list.
 *  - The CONSENT is the basis this controller holds for marketing email:
 *    opted in, opted out, or no record — three states that never collapse
 *    into two, because "no record" is the commonest and is not a refusal.
 *  - The FILING is which campaigns the team has PUT them in, a working set
 *    kept by hand. It adds nobody to a send: a campaign's audience is its
 *    lists and each email's own picker, and the helper says so where a
 *    reader would otherwise assume the opposite.
 *
 * The filing is the one editable thing here and has its own Save, through
 * the same stale-seed guard the properties card uses: a campaign membership
 * written over a cached read could revert somebody else's filing.
 *
 * ## The lead (AGL-2612)
 *
 * A LEAD is the sales record a lead surface — a sign-up, a booking, a form
 * with lead routing — files beside the contact, under the capturing site at
 * `hosts/{hostId}/leads/{personKey}`. The lead's page links the contact
 * once converted; nothing linked back, so the two halves of one person
 * read as unrelated. One `getDoc` by the key the capture derives — the
 * address, normalized and hashed, computed here on WebCrypto — is what
 * answers "does this site hold a lead for this person", and it is a read
 * this page pays because opening the record IS the ask. Absence is a fact
 * too: a contact captured by an order or an import has no lead, and the
 * chip is simply not there.
 */
export function ContactAssociationsCard(props: ContactAssociationsCardProps) {
  const { hostId, record, row, consentGroup, scope, seed, basePath } = props
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const routes = crmRoutes(basePath)

  const [leadKey, setLeadKey] = useState<string | null>(null)
  const email = record.email
  useEffect(() => {
    let active = true
    setLeadKey(null)
    if (!hostId) return undefined
    void (async () => {
      const key = await personKeyInBrowser(email)
      if (!key || !active) return
      const snapshot = await getDoc(
        doc(firestore, 'hosts', hostId, 'leads', key),
      ).catch(() => null)
      if (active && snapshot?.exists()) setLeadKey(key)
    })().catch(() => undefined)
    return () => {
      active = false
    }
  }, [firestore, hostId, email])

  const [campaigns, setCampaigns] = useState<string[]>(record.campaignIds)
  const [saving, setSaving] = useState(false)
  const recordId = record.$id
  useEffect(() => {
    setCampaigns(record.campaignIds)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordId])

  /*
   * The site's campaigns, read because this page IS the ask: one picker on
   * one record, and nothing in the list ever paid for the campaign list.
   */
  const siteCampaigns = useHostCampaigns(hostId ?? undefined, { enabled: Boolean(hostId) })

  const consent = useMemo(
    () => readMarketingBasis(row, consentGroup),
    [row, consentGroup],
  )

  const handleSaveFiling = useCallback(async () => {
    setSaving(true)
    try {
      const verdict = await writeGuardedBySeed(
        {
          subject: 'contact',
          unreadable: seed.status === 'error',
          fromCache: seed.fromCache,
        },
        async () => {
          await updateDoc(
            doc(firestore, scope[0], scope[1], 'contacts', record.$id),
            {
              // An empty selection is written as an empty array rather than
              // removed, so "filed under no campaign" has one shape here and
              // in the pass that detaches a deleted campaign.
              [Aglyn.contactCampaignFieldPath(consentGroup.groupId)]:
                Aglyn.campaignMembershipValue(campaigns),
              updatedAt: new Date(),
            },
          )
        },
      )
      if (!verdict.ok) {
        return void enqueueSnackbar(verdict.message, {
          variant: 'warning',
          persist: false,
        })
      }
      enqueueSnackbar('Filing saved', { variant: 'success', persist: false })
    } catch (error) {
      console.error(error)
      enqueueSnackbar('An error has occurred', {
        variant: 'error',
        allowDuplicate: true,
      })
    } finally {
      setSaving(false)
    }
  }, [
    campaigns,
    consentGroup.groupId,
    enqueueSnackbar,
    firestore,
    record.$id,
    scope,
    seed.fromCache,
    seed.status,
  ])

  const sources = Object.keys(record.sources ?? {}) as ContactSource[]
  const consentDetail = [
    consent.basisAtMs
      ? `recorded ${new Date(consent.basisAtMs).toLocaleDateString()}`
      : null,
    consent.assertedBy === 'operator' ? 'entered by your team' : null,
    consent.otherGrant === 'other-host'
      ? 'opted in to another site in this workspace'
      : null,
  ].filter(Boolean)

  return (
    <CardDisplay
      header={'Relationship'}
      help={Aglyn.pluginDocsHelp('contactRecord', { anchor: '#what-each-site-keeps-to-itself' })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        <Stack spacing={0.5}>
          <Typography variant="subtitle2">{'Sources'}</Typography>
          {sources.length || leadKey ? (
            <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
              {sources.map((source) => (
                <Chip
                  key={source}
                  label={CONTACT_SOURCE_LABELS[source] ?? source}
                  size="small"
                />
              ))}
              {/*
                This site's lead for the person, when it holds one — a link,
                in the shape the lead's page uses to point back here.
              */}
              {leadKey ? (
                <Button
                  component={AppLink as any}
                  {...({ componentVariant: 'naked', nativeButton: false } as any)}
                  href={routes.lead(leadKey)}
                  size="small"
                  variant="outlined"
                  sx={{ py: 0, minHeight: 24, lineHeight: 1.5 }}
                >
                  {'Lead on this site'}
                </Button>
              ) : null}
            </Stack>
          ) : (
            <Typography variant="body2" color="text.secondary">
              {'No capture recorded.'}
            </Typography>
          )}
        </Stack>
        {hostId ? (
          <ConversionAttribution hostId={hostId} kind="contact" refId={record.$id} />
        ) : null}
        <Stack spacing={0.5}>
          <Typography variant="subtitle2">{'Marketing email'}</Typography>
          <Typography variant="body2">
            {MARKETING_BASIS_LABELS[consent.basis]}
            {consentDetail.length ? ` · ${consentDetail.join(' · ')}` : ''}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {consent.basis === 'unrecorded'
              ? 'Nothing was recorded either way — not a refusal, and not permission.'
              : `The basis this ${
                  consentGroup.declared ? 'group' : 'site'
                } holds. Other sites in the workspace keep their own.`}
          </Typography>
        </Stack>
        <Divider />
        <CampaignPicker
          options={siteCampaigns.options}
          value={campaigns}
          onChange={setCampaigns}
          label="Filed under campaigns"
          helperText="Your own filing. It never adds anyone to a send — a campaign mails its lists."
          empty={siteCampaigns.ready && !siteCampaigns.options.length}
          emptyText="This site has no campaigns yet."
        />
        <Stack direction="row">
          <Button
            size="small"
            variant="outlined"
            disabled={saving || (siteCampaigns.ready && !siteCampaigns.options.length)}
            onClick={() => void handleSaveFiling()}
          >
            {saving ? 'Saving…' : 'Save filing'}
          </Button>
        </Stack>
      </Stack>
    </CardDisplay>
  )
}
ContactAssociationsCard.displayName = 'ContactAssociationsCard'

export default ContactAssociationsCard
