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

import { AppLink } from '@aglyn/shared-ui-jsx'
import { Chip, Stack, Typography } from '@mui/material'
import { doc } from 'firebase/firestore'
import { useFirestore, useFirestoreDoc } from '@aglyn/tenant-feature-instance'
import { useMarketingHubPath } from './use-emails-hub-path'
import {
  campaignConversionId,
  campaignTouchLabel,
  type CampaignConversionKind,
  type CampaignConversionRecord,
} from '@aglyn/shared-ui-email-campaigns/model/campaign-conversions'

/**
 * WHERE THIS RECORD CAME FROM — attribution on the converted record itself.
 *
 * The campaign's own page answers "what did this campaign cause". This
 * answers the question from the other end, which is the one a person standing
 * in front of a lead actually has: where did THIS come from. Without it the
 * join is invisible to everybody who is not already looking at a campaign.
 *
 * ## One keyed read, and only where the record is opened
 *
 * The record's id IS half the attribution's id — `{kind}:{refId}` — so this
 * is `getDoc` on a known path: no query, no index, nothing that can be
 * truncated, and no listener over a collection. Mounted on a DETAIL surface
 * (a reader dialog, a drawer) rather than in a table row, because a column
 * would multiply that one read by the page size and charge it to every reader
 * who opened the list for another reason entirely.
 *
 * ## Absence is a real answer and is rendered as one
 *
 * The join writes nothing at all for a conversion it cannot credit — no
 * `utm_source=direct` placeholder, no referrer inference, no fallback to
 * whichever campaign ran most recently. So a missing document is the ordinary
 * case and it means "this person arrived without following a campaign link",
 * which this says in words.
 *
 * What it must never render is a campaign with a zero beside it. "Came from
 * no campaign" and "came from this campaign, which produced nothing" are
 * opposite facts, and a component that reached for a default would print the
 * second when it means the first.
 *
 * ## The two channels do not render the same, because they are not the same
 *
 * An EMAIL touch names a campaign document, so the label is a link to it. A
 * WEB touch names `utm_` text a marketer typed into a URL — there is no
 * document at the other end and no page to open — so it is rendered as text.
 * A link that resolves nowhere is worse than no link.
 */
export interface ConversionAttributionProps {
  hostId: string
  /** Which identify moment this record is. */
  kind: CampaignConversionKind
  /** The record's own document id — the `refId` the writer credited. */
  refId: string
  /**
   * The marketing hub URL, when the caller already holds it.
   *
   * Resolved from the console route when it does not, which is the ordinary
   * case: the surfaces that render this belong to other plugins — the Inbox,
   * Contacts — and they are handed their OWN hub's path. Deriving one hub's
   * URL from another's by string surgery is the link that breaks silently
   * when a surface moves.
   */
  marketingBasePath?: string
  /** Rendered instead of the "no campaign" sentence, for a compact surface. */
  quiet?: boolean
}

export function ConversionAttribution(props: ConversionAttributionProps) {
  const { hostId, kind, refId, quiet } = props
  const firestore = useFirestore()
  /*
   * Free — the org slug and the subdomain are already in the URL this console
   * is on, so no host document is resolved to render a link. `null` until the
   * params settle, and the campaign is then NAMED but not linked, which is
   * the rule the web channel follows for the same reason: no link beats one
   * that resolves nowhere.
   */
  const resolvedHub = useMarketingHubPath()
  const marketingBasePath = props.marketingBasePath ?? resolvedHub

  /*
   * The id is BUILT rather than interpolated, so a ref carrying a slash or a
   * colon answers null here instead of naming a document in another
   * collection. A null builder is how this hook is told not to read at all.
   */
  const attributionId = campaignConversionId(kind, refId)
  const { data: record, status } = useFirestoreDoc<CampaignConversionRecord>(
    () =>
      attributionId
        ? doc(
            firestore,
            'hosts',
            hostId,
            'campaignAttributions',
            attributionId,
          )
        : null,
    [firestore, hostId, attributionId],
  )

  /*
   * An id that could not be built means the record's own id is unusable, so
   * the question was never asked. Drawing the "not credited" sentence here
   * would state a fact nothing checked — the one thing this component must
   * not do — so it draws nothing.
   */
  if (!attributionId) return null

  /*
   * Nothing while the read settles. Rendering "no campaign" first and
   * replacing it a tick later states the opposite of the truth for as long as
   * the reader's eye takes to reach it, and this sits inside a dialog that
   * opens with the read.
   */
  if (status === 'loading') return null

  if (!record) {
    if (quiet) return null
    return (
      <Stack spacing={0.5}>
        <Typography variant="overline" color="text.secondary">
          {'Campaign'}
        </Typography>
        {/*
          NOT a zero, and not an empty campaign chip. The sentence says which
          fact this is: nobody was credited, and nothing was guessed.
         */}
        <Typography variant="body2" color="text.secondary">
          {'Not credited to a campaign — this arrived directly, or from a ' +
            'link that carried no campaign. Nothing is inferred from a ' +
            'referrer and no campaign is credited for being the most recent ' +
            'one to run.'}
        </Typography>
      </Stack>
    )
  }

  const label = campaignTouchLabel(record)
  const converted = Number(record.convertedAtMs ?? 0)
  const touched = Number(record.touchedAtMs ?? 0)
  const isEmail = record.channel === 'email'
  const campaignHref =
    isEmail && marketingBasePath && record.campaignId
      ? `${marketingBasePath}/campaigns/${record.campaignId}`
      : undefined

  return (
    <Stack spacing={0.5}>
      <Typography variant="overline" color="text.secondary">
        {'Campaign'}
      </Typography>
      <Stack
        direction="row"
        spacing={1}
        useFlexGap
        sx={{ alignItems: 'center', flexWrap: 'wrap' }}
      >
        {/*
          The CHANNEL is on screen beside the label, because the two are read
          differently: one names a campaign whose report can be opened, the
          other names text somebody typed into a URL.
         */}
        <Chip
          size="small"
          color={isEmail ? 'primary' : 'default'}
          variant={isEmail ? 'filled' : 'outlined'}
          label={isEmail ? 'Campaign email' : 'Web link'}
        />
        {campaignHref ? (
          <AppLink href={campaignHref}>{label || record.campaignId}</AppLink>
        ) : (
          <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
            {label || 'unnamed'}
          </Typography>
        )}
      </Stack>
      {/*
        THE RULE, under the claim. A credit whose rule the reader cannot state
        is a credit they will use anyway, and the two things they need are
        which touch wins and how long one stays creditable. `model` and
        `windowDays` come off the RECORD, so a conversion credited under an
        older rule prints the rule it was credited under.
       */}
      <Typography variant="caption" color="text.secondary">
        {(touched
          ? `Followed the link on ${new Date(touched).toLocaleString()}`
          : 'Followed a campaign link') +
          (converted
            ? `, converted ${new Date(converted).toLocaleString()}`
            : '') +
          `. Credited ${
            record.model === 'last-click'
              ? 'to the last campaign whose link they clicked'
              : `under the ${String(record.model ?? 'recorded')} model`
          }, within ${Number(record.windowDays ?? 0) || 7} days of that click.`}
      </Typography>
    </Stack>
  )
}
ConversionAttribution.displayName = 'ConversionAttribution'

export default ConversionAttribution
