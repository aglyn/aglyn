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
  orgContactConsentLabel,
  orgContactRow,
  pluginDocsHelp,
  type OrgContactHostConsent,
} from '@aglyn/aglyn'
import { AppLink, CardDisplay } from '@aglyn/shared-ui-jsx'
import { Chip, Stack, Typography } from '@mui/material'
import { useMemo } from 'react'
import { useCrmOrgMount } from '../hooks/use-crm-org-mount'
import type { CrmOrgDoc } from '../hooks/use-crm-scope'

export interface ContactKnownByCardProps {
  /** The document as read — the projection below is an allow-list over it. */
  row: Record<string, unknown>
  contactId: string
  /** The org document, the only input that can resolve a declared consent group. */
  org: CrmOrgDoc
}

/**
 * One consent verdict, rendered.
 *
 * The label always names the controller — `orgContactConsentLabel` is what
 * guarantees that — and the color follows the basis rather than replacing
 * it: a green chip with no name on it would be a bare "consented", which is
 * the claim the per-brand model exists to stop anybody making.
 */
function ConsentChip(props: { entry: OrgContactHostConsent; siteName: string }) {
  const { entry, siteName } = props
  return (
    <Chip
      size="small"
      color={
        entry.basis === 'granted'
          ? 'success'
          : entry.basis === 'declined'
            ? 'error'
            : 'default'
      }
      variant={entry.basis === 'unrecorded' ? 'outlined' : 'filled'}
      label={orgContactConsentLabel(entry, siteName)}
    />
  )
}
ConsentChip.displayName = 'ConsentChip'

/**
 * KNOWN BY — the cross-site fact, on the organization-level record
 * (AGL-2630).
 *
 * A contact document is shared by every site that has captured the person:
 * one human who touched two of an org's sites is ONE row, which is the
 * dedupe the shared address book exists for and what makes the billing unit
 * — unique people per org — mean anything. Under a site that fact is
 * invisible on purpose: a site's hub is one holder's view. This card is the
 * one place it is shown, and it shows exactly what the old org-level
 * address book showed and nothing more: which sites know the person, and
 * the person's marketing consent FOR EACH of those sites — one verdict per
 * capturing site, each naming the controller it was read for, because a
 * basis is per (person, controller) and "consented" with nobody attached
 * would be a different and false claim.
 *
 * Notes, tags, activity and commercial figures are each holder's own
 * records and are not projected here: `orgContactRow` is an allow-list for
 * that reason, and the card renders nothing it did not return. The rest of
 * the record page reads through the person's PRIMARY holder; this card is
 * how a reader learns which other sites hold a profile, and the link on
 * each site is how they open it there.
 *
 * Rendered only beneath the org mount — under a site the hook answers
 * `null` and so does the card.
 */
export function ContactKnownByCard(props: ContactKnownByCardProps) {
  const { row, contactId, org } = props
  const mount = useCrmOrgMount()
  const projected = useMemo(
    () => orgContactRow(row, contactId, (org ?? null) as Record<string, unknown> | null),
    [row, contactId, org],
  )
  if (!mount) return null
  const { capturedByHostIds, consent } = projected
  return (
    <CardDisplay
      header={'Known by'}
      help={pluginDocsHelp('contacts', { anchor: '#at-the-organization-level' })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        {capturedByHostIds.length ? (
          <Stack spacing={1.5}>
            {capturedByHostIds.map((hostId) => {
              const entry = consent.find((verdict) => verdict.hostId === hostId)
              const href = mount.siteHubHref(hostId)
              const name = mount.siteName(hostId)
              return (
                <Stack
                  key={hostId}
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                >
                  {/*
                    A site whose subdomain has not resolved must still be
                    NAMED — the relationship is real, and hiding it would
                    understate who knows this person — but not linked,
                    because the route would not exist; a plain span, not an
                    anchor to nowhere. Two elements are safe here: the card
                    mounts only once the record's listener has answered, so
                    there is no server render for a client render to disagree
                    with.
                  */}
                  {href ? (
                    <AppLink
                      href={`${href}/contacts/${encodeURIComponent(contactId)}`}
                      underline="hover"
                    >
                      {name}
                    </AppLink>
                  ) : (
                    <Typography component="span" variant="body2">
                      {name}
                    </Typography>
                  )}
                  {entry ? <ConsentChip entry={entry} siteName={name} /> : null}
                  {entry?.declared ? (
                    <Typography variant="caption" color="text.secondary">
                      {`Consent given to ${entry.groupName ?? entry.groupId}, which ${name} is part of.`}
                    </Typography>
                  ) : null}
                </Stack>
              )
            })}
          </Stack>
        ) : (
          /*
           * Unattributed, not unknown. A row written before the attribution
           * existed names no site, and reading that as "every site" would
           * put a person in front of businesses that never met them.
           */
          <Typography variant="body2" color="text.secondary">
            {'No site recorded'}
          </Typography>
        )}
        <Typography variant="caption" color="text.secondary">
          {'The profile, notes, tags and timeline on this page are the first ' +
            "capturing site's. Open the person in another site to see what " +
            'it holds.'}
        </Typography>
      </Stack>
    </CardDisplay>
  )
}
ContactKnownByCard.displayName = 'ContactKnownByCard'

export default ContactKnownByCard
