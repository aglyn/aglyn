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
import { useMarketingHubPath } from './use-marketing-hub-path'
import { useMarketingOrgId } from './marketing-org-mount'
import { campaignContainerDoc, campaignSendDoc } from './campaign-queries'
import {
  campaignConversionId,
  campaignCreditRule,
  campaignTouchLabel,
  type CampaignConversionKind,
  type CampaignConversionRecord,
} from '../model/campaign-conversions'

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
 * ## The channels do not render the same, because they are not the same
 *
 * An EMAIL touch names a campaign document, so the label is a link to it. A
 * WEB touch names `utm_` text a marketer typed into a URL — there is no
 * document at the other end and no page to open — so it is rendered as text.
 * A link that resolves nowhere is worse than no link. A SEQUENCE touch
 * (AGL-3254) names the campaign a rep's sequence is in, a container with a
 * page, so it links like an email touch and says which door it came through.
 * A PAGE touch (AGL-3461) names the campaign the viewed page is filed under,
 * and a web touch whose label a campaign declares names that campaign: both
 * link to it.
 *
 * ## Filed under is not credited to
 *
 * A surface that knows what its record is filed under — the Inbox knows the
 * form's campaigns and the page's — hands them in as `filedUnder`, and they
 * are drawn ABOVE the credit under their own heading. The two answer
 * different questions: which campaigns the merchant put this form and page
 * in, and which campaign's touch the visitor arrived through. A submission can
 * be filed under one campaign and credited to another, or to none, and a
 * screen that ran the two together would hide exactly that.
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
  /**
   * The campaigns the record is FILED under, by container id (AGL-3461) —
   * drawn as "Filed under" above the credit. Absent: the heading is not drawn.
   */
  filedUnder?: readonly string[]
}

/** Which collection a campaign id on a record names. */
type CampaignIdKind = 'container' | 'send'

/**
 * A campaign's name, read from its own document: the container's `name`, or
 * a send's `subject` — the id until the read answers or when the document is
 * gone, because an id is still the true value and a blank is not.
 */
function CampaignName(props: {
  orgId: string | null
  id: string
  of: CampaignIdKind
}) {
  const { orgId, id, of } = props
  const firestore = useFirestore()
  const { data } = useFirestoreDoc<{ name?: string; subject?: string }>(
    () =>
      orgId && id
        ? of === 'container'
          ? campaignContainerDoc(firestore, orgId, id)
          : campaignSendDoc(firestore, orgId, id)
        : null,
    [firestore, orgId, id, of],
  )
  const label = String((of === 'container' ? data?.name : data?.subject) ?? '').trim()
  return <>{label || id}</>
}

/** The chip a channel is drawn with, and whether its credit names a document. */
function channelChip(record: CampaignConversionRecord): {
  label: string
  linked: boolean
} {
  switch (record.channel) {
    case 'email':
      return { label: 'Campaign email', linked: true }
    case 'sequence':
      return { label: 'Sequence', linked: true }
    case 'page':
      return { label: 'Campaign page', linked: true }
    default:
      return record.campaignId
        ? { label: 'Campaign link', linked: true }
        : { label: 'Web link', linked: false }
  }
}

/** When and how the visitor was touched, in the sentence under the credit. */
function touchSentence(record: CampaignConversionRecord): string {
  const touched = Number(record.touchedAtMs ?? 0)
  const at = touched ? ` on ${new Date(touched).toLocaleString()}` : ''
  switch (record.channel) {
    case 'sequence':
      return touched ? `Reached by a sequence email${at}` : 'Reached by a sequence email'
    case 'page':
      return `Viewed ${record.path ? record.path : 'a page filed under it'}${at}`
    default:
      return touched ? `Followed the link${at}` : 'Followed a campaign link'
  }
}

export function ConversionAttribution(props: ConversionAttributionProps) {
  const { hostId, kind, refId, quiet } = props
  const filedUnder = props.filedUnder ?? []
  const firestore = useFirestore()
  // The org whose campaigns the names are read from; nothing is read until it
  // is known, and the ids stand in until then.
  const { orgId } = useMarketingOrgId(hostId)
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

  const campaignHref = (id: string | undefined) =>
    marketingBasePath && id ? `${marketingBasePath}/campaigns/${id}` : undefined

  /*
   * FILED UNDER — the merchant's declaration, drawn first and under its own
   * heading so it can never be read as the credit below it.
   */
  const filed = filedUnder.length ? (
    <Stack spacing={0.5}>
      <Typography variant="caption" color="text.secondary">
        {'Filed under'}
      </Typography>
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
        {filedUnder.map((id) => {
          const href = campaignHref(id)
          const name = <CampaignName orgId={orgId} id={id} of="container" />
          return href ? (
            <AppLink key={id} href={href}>
              {name}
            </AppLink>
          ) : (
            <Typography key={id} variant="body2">
              {name}
            </Typography>
          )
        })}
      </Stack>
    </Stack>
  ) : null

  if (!record) {
    if (quiet && !filed) return null
    return (
      <Stack spacing={1}>
        <Typography variant="overline" color="text.secondary">
          {'Campaign'}
        </Typography>
        {filed}
        {quiet ? null : (
          <Stack spacing={0.5}>
            {filed ? (
              <Typography variant="caption" color="text.secondary">
                {'Credited to'}
              </Typography>
            ) : null}
            {/*
              NOT a zero, and not an empty campaign chip. The sentence says
              which fact this is: nobody was credited, and nothing was guessed.
             */}
            <Typography variant="body2" color="text.secondary">
              {'Not credited to a campaign — this arrived directly, or from a ' +
                'link that carried no campaign, and no page filed under a ' +
                'campaign was viewed before it. Nothing is inferred from a ' +
                'referrer and no campaign is credited for being the most ' +
                'recent one to run.'}
            </Typography>
          </Stack>
        )}
      </Stack>
    )
  }

  const label = campaignTouchLabel(record)
  const converted = Number(record.convertedAtMs ?? 0)
  const chip = channelChip(record)
  const creditedHref = chip.linked ? campaignHref(record.campaignId) : undefined
  const creditedName =
    chip.linked && record.campaignId ? (
      <CampaignName
        orgId={orgId}
        id={record.campaignId}
        of={record.channel === 'email' ? 'send' : 'container'}
      />
    ) : null

  return (
    <Stack spacing={1}>
      <Typography variant="overline" color="text.secondary">
        {'Campaign'}
      </Typography>
      {filed}
      <Stack spacing={0.5}>
        {filed ? (
          <Typography variant="caption" color="text.secondary">
            {'Credited to'}
          </Typography>
        ) : null}
        <Stack
          direction="row"
          spacing={1}
          useFlexGap
          sx={{ alignItems: 'center', flexWrap: 'wrap' }}
        >
          {/*
            The CHANNEL is on screen beside the label, because the two are
            read differently: one names a campaign whose report can be opened,
            the other names text somebody typed into a URL.
           */}
          <Chip
            size="small"
            color={chip.linked ? 'primary' : 'default'}
            variant={chip.linked ? 'filled' : 'outlined'}
            label={chip.label}
          />
          {creditedHref ? (
            <AppLink href={creditedHref}>{creditedName}</AppLink>
          ) : creditedName ? (
            <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
              {creditedName}
            </Typography>
          ) : (
            <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
              {label || 'unnamed'}
            </Typography>
          )}
          {/* A declared label keeps its text beside the campaign it names. */}
          {record.channel === 'web' && record.campaignId && label ? (
            <Typography variant="caption" color="text.secondary">
              {label}
            </Typography>
          ) : null}
        </Stack>
        {/*
          THE RULE, under the claim. A credit whose rule the reader cannot
          state is a credit they will use anyway, and the two things they
          need are which touch wins and how long one stays creditable.
          `model` and `windowDays` come off the RECORD, so a conversion
          credited under an older rule prints the rule it was credited under.
         */}
        <Typography variant="caption" color="text.secondary">
          {touchSentence(record) +
            (converted ? `, converted ${new Date(converted).toLocaleString()}` : '') +
            '. ' +
            campaignCreditRule(record.model, record.windowDays)}
        </Typography>
      </Stack>
    </Stack>
  )
}
ConversionAttribution.displayName = 'ConversionAttribution'

export default ConversionAttribution
