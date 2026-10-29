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

import { pluginDocsHelp, type ConsoleStaffPagePaths } from '@aglyn/aglyn'
import { buildRoute, Route } from '@aglyn/aglyn/app-utils/console-routes'
import { SITE_FONT_PAIRINGS } from '@aglyn/aglyn/app-utils/site-font-pairings'
import { siteLiveUrlForSlug } from '@aglyn/aglyn/app-utils/site-live-url'
import { SITE_STARTER_BRAND_KEYS } from '@aglyn/aglyn/app-utils/site-starter-theme'
import { siteStyleOf } from '@aglyn/aglyn/app-utils/site-styles'
import { AppLink, CardDisplay } from '@aglyn/shared-ui-jsx'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Divider,
  FormControlLabel,
  Link as MuiLink,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { useState } from 'react'
import { orgMarketplacePath, publisherPath } from '../model/marketplace-paths'
import {
  rejectionCategoriesFor,
  rejectionHeadline,
  rejectionInputError,
  pluginRejectionCategory,
} from '../model/plugin-rejection-categories'
import { SITE_STARTER_REVIEW_CHECKLIST } from '../model/plugin-review-checklist'
import { starterReviewStatusMeaning } from '../model/plugin-review-status'

/** One site starter, as the review route answers for its page (AGL-4049). */
export interface SiteStarterReviewDetail {
  artifactType: 'siteStarter'
  listingId: string
  displayName: string
  description: string
  category: string | null
  previewImageUrl: string | null
  priceUsd: number
  official: boolean
  reviewStatus: string
  rejectionReason: string
  rejectionCategory: string
  /** The version the last List or Reject was given on. */
  reviewedVersion: string | null
  hidden: boolean
  hiddenReason: string
  unpublished: boolean
  latestVersion: string
  /** The version the pages, theme and checklist below are read from. */
  reviewVersion: string
  mode: 'base' | 'ai'
  facets: { kind: string | null; base: string | null; fonts: string | null; pages: number; mode: string }
  pages: Array<{ name: string; slug: string | null; published: boolean }>
  layout: { name: string } | null
  theme:
    | {
        kind: 'builtin'
        base: string
        fonts: string | null
        brand: { light: Record<string, string>; dark?: Record<string, string> }
      }
    | { kind: 'full' }
    | null
  publisherId: string
  publisherName: string
  publisherSlug: string | null
  publisherAgreement: { version: string | null; required: string; state: 'none' | 'outdated' | 'current' }
  sourceSite: { hostId: string; name: string | null; subdomain: string | null; cname: string | null } | null
  versions: Array<{ version: string; publishedAt: string | null; pages: number }>
  checklist: Record<string, { by: string | null }>
  checklistOutstanding: string[]
}

export interface SiteStarterReviewBodyProps {
  detail: SiteStarterReviewDetail
  busy: boolean
  /** Sends one action to the review route, then reads the page again. */
  post: (payload: Record<string, unknown>, success: string) => Promise<void>
  /** Reads the page for another version. */
  onSelectVersion: (version: string) => void
  staffPaths?: ConsoleStaffPagePaths
}

const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? '' : 's'}`

/** A font pairing as a reviewer reads it: its heading face over its text face. */
function fontsLabel(id: string | null): string {
  if (!id) return 'The base theme’s own fonts'
  const pairing = SITE_FONT_PAIRINGS.find((entry) => entry.id === id)
  return pairing ? `${pairing.heading.family} headings, ${pairing.body.family} text` : id
}

/** One brand color, drawn from the publisher's value with the theme's border around it. */
function Swatch({ scheme, name, value }: { scheme: string; name: string; value: string }) {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
      <Box
        role="img"
        aria-label={`${scheme} ${name} ${value}`}
        sx={{
          width: (theme) => theme.spacing(3),
          height: (theme) => theme.spacing(3),
          borderRadius: 1,
          border: 1,
          borderColor: 'divider',
          // The publisher's own color, as their starter stores it: data, not style.
          bgcolor: value,
        }}
      />
      <Typography variant="caption" color="text.secondary">{`${name} ${value}`}</Typography>
    </Stack>
  )
}

/**
 * A site starter's review page (AGL-4049): what a site created from it gets,
 * the starter checklist, and its two verdicts.
 *
 * A starter is not code. Nothing on the plugin page — manifest, verifier,
 * per-version approval, realm trust — has anything to act on in it, so this
 * page reads what a person's new site is made of instead: every page, with a
 * link to it on the site it was published from, the layout they sit in, the
 * theme and its brand colors in both schemes, the picture and facets a search
 * shows. List waits for every checklist item on the newest version; Reject
 * takes one of a starter's own reasons, which its publisher is told.
 */
export function SiteStarterReviewBody({
  detail,
  busy,
  post,
  onSelectVersion,
  staffPaths,
}: SiteStarterReviewBodyProps) {
  const [rejectCategory, setRejectCategory] = useState('')
  const [reason, setReason] = useState('')
  const [takedownReason, setTakedownReason] = useState('')

  const status = starterReviewStatusMeaning(detail.reviewStatus)
  const outstanding = detail.checklistOutstanding.length
  // List is a verdict on the newest version, so reading an older one holds it.
  const readingOlder = detail.reviewVersion !== detail.latestVersion
  const blocked = outstanding > 0 || readingOlder
  const newerSinceReview =
    Boolean(detail.reviewedVersion) && detail.reviewedVersion !== detail.latestVersion
  const rejectBlocked = rejectionInputError(rejectCategory, reason, 'siteStarter')
  const needsComment = Boolean(pluginRejectionCategory(rejectCategory)?.requiresComment)
  const style = siteStyleOf(detail.facets.kind)
  const site = detail.sourceSite
  const siteName = site?.name ?? 'the site it came from'
  const pageUrl = (slug: string) =>
    site?.subdomain || site?.cname
      ? siteLiveUrlForSlug({ subdomain: site.subdomain, cname: site.cname }, slug)
      : undefined
  const ticked = SITE_STARTER_REVIEW_CHECKLIST.filter((item) => detail.checklist?.[item.id]).length
  const blockedReason = readingOlder
    ? `List reviews the newest version, v${detail.latestVersion}. Pick it under Versions.`
    : `Complete the review checklist first — ${plural(outstanding, 'required item')} outstanding for v${detail.reviewVersion}`

  const checklistLink = (id: string) => {
    if (id === 'starter-pages' && site) {
      return (
        <AppLink href={buildRoute(Route.ADMIN_SITE_DETAIL, { hostId: site.hostId })}>
          {site.name ? `${site.name}’s staff page` : 'The site’s staff page'}
        </AppLink>
      )
    }
    if (id === 'publisher') {
      const href = staffPaths?.orgDetail(detail.publisherId)
      return href ? <AppLink href={href}>{`${detail.publisherName}’s staff page`}</AppLink> : null
    }
    return null
  }

  return (
    <Stack spacing={3}>
      <CardDisplay
        header="Status"
        help={pluginDocsHelp('staffConsole', { anchor: '#plugin-reviews-site-starters' })}
        contentGutterX
        contentGutterY
      >
        <Stack spacing={1.5}>
          <Stack useFlexGap direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <Chip size="small" color={status.color} label={status.label} />
            <Chip size="small" variant="outlined" label={`v${detail.latestVersion || '—'}`} />
            <Chip size="small" variant="outlined" label={detail.priceUsd > 0 ? `$${detail.priceUsd}` : 'Free'} />
            {detail.official ? <Chip size="small" variant="outlined" label="Official" /> : null}
            {detail.hidden ? <Chip size="small" color="error" label="Taken down" /> : null}
            {detail.unpublished ? (
              <Chip size="small" color="warning" label="Unpublished by the publisher" />
            ) : null}
          </Stack>
          <Typography variant="caption" color="text.secondary">
            {status.meaning}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {'Publisher: '}
            {detail.publisherSlug ? (
              <AppLink href={publisherPath(orgMarketplacePath(detail.publisherSlug), detail.publisherId)}>
                {detail.publisherName}
              </AppLink>
            ) : (
              detail.publisherName
            )}
            {` · ${detail.listingId}`}
          </Typography>
          {detail.publisherAgreement.state !== 'current' ? (
            <Alert severity="warning">
              {detail.publisherAgreement.state === 'none'
                ? 'This publisher has not accepted the Marketplace Publisher Agreement.'
                : `This publisher accepted an older Marketplace Publisher Agreement (${detail.publisherAgreement.version}); ${detail.publisherAgreement.required} is in force.`}
            </Alert>
          ) : null}
          {newerSinceReview ? (
            <Alert severity="info">
              {`v${detail.latestVersion} was published after the review of v${detail.reviewedVersion}. ` +
                'A listed starter stays listed when it is published again: read the new version, and reject it or take it down if it no longer passes.'}
            </Alert>
          ) : null}
          {detail.rejectionReason || detail.rejectionCategory ? (
            <Alert severity="error">
              {`Rejected: ${rejectionHeadline(detail.rejectionCategory, detail.rejectionReason)}${
                detail.rejectionReason && pluginRejectionCategory(detail.rejectionCategory)
                  ? ` — ${detail.rejectionReason}`
                  : ''
              }`}
            </Alert>
          ) : null}
          {detail.hidden ? (
            <Alert severity="error">
              {detail.hiddenReason ? `Taken down: ${detail.hiddenReason}` : 'Taken down (no reason recorded)'}
            </Alert>
          ) : null}
        </Stack>
      </CardDisplay>

      <CardDisplay header="Overview" contentGutterX contentGutterY>
        <Stack spacing={1.5}>
          {detail.previewImageUrl ? (
            <Box
              component="img"
              src={detail.previewImageUrl}
              alt={`The picture ${detail.displayName} is shown with`}
              sx={{
                width: '100%',
                maxWidth: (theme) => theme.spacing(60),
                borderRadius: 1,
                border: 1,
                borderColor: 'divider',
              }}
            />
          ) : (
            <Alert severity="warning">{'No picture: the starter shows without one in the marketplace.'}</Alert>
          )}
          <Typography variant="body2">{detail.description || 'No description.'}</Typography>
          <Stack useFlexGap direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            {detail.category ? <Chip size="small" label={detail.category} /> : null}
            {style ? <Chip size="small" variant="outlined" label={`Style: ${style.name}`} /> : null}
            <Chip size="small" variant="outlined" label={plural(detail.facets.pages, 'page')} />
            {detail.mode === 'ai' ? <Chip size="small" variant="outlined" label="AI starter" /> : null}
          </Stack>
        </Stack>
      </CardDisplay>

      <CardDisplay header={`Pages (${detail.pages.length})`} contentGutterX contentGutterY>
        <Stack spacing={1.5}>
          <Typography variant="body2" color="text.secondary">
            {`What a site created from v${detail.reviewVersion} starts with. Each published page links to the same page on ${siteName}, as that site is now.`}
          </Typography>
          <Stack divider={<Divider flexItem />} spacing={1}>
            {detail.pages.map((page, index) => {
              const href = page.published && page.slug ? pageUrl(page.slug) : undefined
              return (
                <Stack
                  key={`${page.slug ?? ''}-${index}`}
                  useFlexGap
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                >
                  <Typography variant="body2">{page.name}</Typography>
                  {page.published && page.slug ? (
                    <Typography variant="caption" color="text.secondary">
                      {page.slug}
                    </Typography>
                  ) : (
                    <Chip size="small" variant="outlined" label="Not published" />
                  )}
                  {href ? (
                    <Typography variant="caption">
                      <MuiLink href={href} target="_blank" rel="noopener noreferrer">
                        {`Open on ${siteName} ↗`}
                      </MuiLink>
                    </Typography>
                  ) : null}
                </Stack>
              )
            })}
          </Stack>
          <Divider />
          <Stack spacing={0.5}>
            <Typography variant="subtitle2">{'Shared layout'}</Typography>
            <Typography variant="body2">{detail.layout?.name ?? 'None'}</Typography>
          </Stack>
          {site && !site.subdomain && !site.cname ? (
            <Alert severity="warning">
              {'The site it was published from is gone, so its pages can only be read here.'}
            </Alert>
          ) : null}
        </Stack>
      </CardDisplay>

      <CardDisplay header="Theme" contentGutterX contentGutterY>
        {detail.theme?.kind === 'builtin' ? (
          <Stack spacing={1.5}>
            <Typography variant="body2">{'Built-in theme with its brand colors'}</Typography>
            <Stack useFlexGap direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
              <Typography variant="caption" color="text.secondary">
                {'Base theme'}
              </Typography>
              <Chip size="small" variant="outlined" label={detail.theme.base} />
            </Stack>
            <Typography variant="body2" color="text.secondary">
              {fontsLabel(detail.theme.fonts)}
            </Typography>
            {(['light', 'dark'] as const).map((scheme) => {
              const builtin = detail.theme?.kind === 'builtin' ? detail.theme : null
              const colors = scheme === 'dark' ? (builtin?.brand.dark ?? null) : (builtin?.brand.light ?? {})
              const label = scheme === 'dark' ? 'Dark' : 'Light'
              return (
                <Stack key={scheme} spacing={0.5}>
                  <Typography variant="subtitle2">{label}</Typography>
                  {colors ? (
                    <Stack useFlexGap direction="row" spacing={2} sx={{ flexWrap: 'wrap' }}>
                      {SITE_STARTER_BRAND_KEYS.filter((key) => colors[key]).map((key) => (
                        <Swatch key={key} scheme={label} name={key} value={colors[key]} />
                      ))}
                    </Stack>
                  ) : (
                    <Typography variant="caption" color="text.secondary">
                      {'Uses the light colors.'}
                    </Typography>
                  )}
                </Stack>
              )
            })}
          </Stack>
        ) : detail.theme?.kind === 'full' ? (
          <Typography variant="body2">
            {'The site’s own full theme. Read it on the pages, in light and in dark.'}
          </Typography>
        ) : (
          <Alert severity="warning">{'No theme is stored with this version.'}</Alert>
        )}
      </CardDisplay>

      <CardDisplay
        header={`Review checklist — v${detail.reviewVersion} (${ticked}/${SITE_STARTER_REVIEW_CHECKLIST.length})`}
        help={pluginDocsHelp('staffConsole', { anchor: '#plugin-reviews-site-starters' })}
        contentGutterX
        contentGutterY
      >
        <Stack spacing={1}>
          <Typography variant="body2" color="text.secondary">
            {'Every item is required before the starter is listed. Ticks are recorded against this version and start again when it is published again.'}
          </Typography>
          {outstanding ? (
            <Alert severity="info">
              {`${plural(outstanding, 'required item')} outstanding — List stays blocked until they are done. Rejecting never needs the checklist.`}
            </Alert>
          ) : (
            <Alert severity="success">{'Every required item is recorded for this version.'}</Alert>
          )}
          {SITE_STARTER_REVIEW_CHECKLIST.map((item) => {
            const link = checklistLink(item.id)
            return (
              <Stack key={item.id} spacing={0.25} sx={{ pl: 0.5 }}>
                <FormControlLabel
                  control={
                    <Checkbox
                      size="small"
                      checked={Boolean(detail.checklist?.[item.id])}
                      disabled={busy}
                      onChange={(event) =>
                        void post(
                          {
                            action: 'checklist',
                            version: detail.reviewVersion,
                            itemId: item.id,
                            checked: event.target.checked,
                          },
                          event.target.checked ? 'Recorded' : 'Cleared',
                        )
                      }
                    />
                  }
                  label={
                    <Stack useFlexGap direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                      <Typography variant="body2">{item.label}</Typography>
                      {item.required ? <Chip size="small" label="Required" /> : null}
                    </Stack>
                  }
                />
                <Typography variant="caption" color="text.secondary" sx={{ pl: 4 }}>
                  {item.detail}
                </Typography>
                {link ? (
                  <Typography variant="caption" sx={{ pl: 4 }}>
                    {link}
                  </Typography>
                ) : null}
              </Stack>
            )
          })}
        </Stack>
      </CardDisplay>

      <CardDisplay
        header="Review verdict"
        help={pluginDocsHelp('staffConsole', { anchor: '#plugin-reviews-site-starters' })}
        contentGutterX
        contentGutterY
      >
        <Stack spacing={2}>
          <Stack useFlexGap direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <Typography variant="body2">{'Currently:'}</Typography>
            <Chip size="small" color={status.color} label={status.label} />
            {status.live ? (
              <Chip size="small" color="warning" label="Anyone can choose it" />
            ) : (
              <Chip size="small" variant="outlined" label="Its publisher only" />
            )}
          </Stack>
          {!status.live || newerSinceReview ? (
            <Stack spacing={0.5}>
              <Stack useFlexGap direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                <Tooltip
                  title={
                    blocked
                      ? blockedReason
                      : 'Lists it in the marketplace, where anyone creating a site can choose it, and tells its publisher.'
                  }
                >
                  <span>
                    <Button
                      size="small"
                      color="warning"
                      variant="outlined"
                      disabled={busy || blocked}
                      onClick={() => void post({ action: 'list' }, 'Listed — anyone creating a site can choose it')}
                    >
                      {'List in marketplace'}
                    </Button>
                  </span>
                </Tooltip>
              </Stack>
              {blocked ? (
                <Alert severity="info" sx={{ mt: 0.5 }}>
                  {readingOlder
                    ? blockedReason
                    : `Blocked: ${plural(outstanding, 'required checklist item')} outstanding for v${detail.reviewVersion}.`}
                </Alert>
              ) : null}
            </Stack>
          ) : null}
          <Divider />
          <Stack spacing={0.5}>
            <Typography variant="subtitle2">{'Reject'}</Typography>
            <Stack useFlexGap direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
              <TextField
                select
                size="small"
                label="Rejection reason"
                value={rejectCategory}
                onChange={(event) => setRejectCategory(event.target.value)}
                slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
                sx={{ minWidth: (theme) => theme.spacing(32) }}
              >
                <MenuItem value="">{'Select a reason…'}</MenuItem>
                {rejectionCategoriesFor('siteStarter').map((entry) => (
                  <MenuItem key={entry.id} value={entry.id}>
                    {entry.label}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                size="small"
                placeholder={needsComment ? 'Comment (required for “Other”)' : 'Comment (optional)'}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                sx={{ minWidth: (theme) => theme.spacing(32) }}
              />
              <Button
                size="small"
                color="error"
                disabled={busy || Boolean(rejectBlocked)}
                onClick={() => void post({ action: 'reject', category: rejectCategory, reason }, 'Rejected')}
              >
                {'Reject'}
              </Button>
            </Stack>
            {rejectBlocked ? (
              <Typography variant="caption" color="text.secondary">
                {rejectBlocked}
              </Typography>
            ) : null}
            <Typography variant="caption" color="text.secondary">
              {'Rejecting tells the publisher the reason and what to do about it, and takes a listed starter out of the marketplace. Sites already created from it keep their pages. Publishing it again sends it back here.'}
            </Typography>
          </Stack>
        </Stack>
      </CardDisplay>

      <CardDisplay header="Versions" contentGutterX contentGutterY>
        <Stack divider={<Divider flexItem />} spacing={1}>
          {detail.versions.map((entry) => (
            <Stack
              key={entry.version}
              useFlexGap
              direction="row"
              spacing={1}
              sx={{ alignItems: 'center', flexWrap: 'wrap' }}
            >
              <Typography variant="body2">{`v${entry.version}`}</Typography>
              <Typography variant="caption" color="text.secondary">
                {[
                  entry.publishedAt ? `Published ${new Date(entry.publishedAt).toLocaleDateString()}` : '',
                  plural(entry.pages, 'page'),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Typography>
              {entry.version === detail.reviewedVersion ? (
                <Chip size="small" variant="outlined" label="Last reviewed" />
              ) : null}
              {entry.version === detail.reviewVersion ? (
                <Chip size="small" color="info" label="Shown above" />
              ) : (
                <Button size="small" disabled={busy} onClick={() => onSelectVersion(entry.version)}>
                  {'Read this version'}
                </Button>
              )}
            </Stack>
          ))}
        </Stack>
      </CardDisplay>

      <CardDisplay header="Danger zone" contentGutterX contentGutterY>
        <Stack spacing={1.5}>
          <Typography variant="body2" color="text.secondary">
            {'Taking a starter down takes it out of the marketplace and refuses every new site from it, whatever its review status. Sites already created from it keep their own copy. Restoring returns it to the status it had.'}
          </Typography>
          <Stack useFlexGap direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            {detail.hidden ? null : (
              <TextField
                size="small"
                placeholder="Takedown reason"
                value={takedownReason}
                onChange={(event) => setTakedownReason(event.target.value)}
                sx={{ minWidth: (theme) => theme.spacing(32) }}
              />
            )}
            <Button
              size="small"
              variant={detail.hidden ? 'text' : 'outlined'}
              color={detail.hidden ? 'success' : 'error'}
              disabled={busy || (!detail.hidden && !takedownReason.trim())}
              onClick={() =>
                void post(
                  { action: detail.hidden ? 'unhide' : 'hide', reason: takedownReason },
                  detail.hidden ? `${detail.displayName} restored` : `${detail.displayName} taken down`,
                ).then(() => setTakedownReason(''))
              }
            >
              {detail.hidden ? 'Restore listing' : 'Take down'}
            </Button>
          </Stack>
        </Stack>
      </CardDisplay>
    </Stack>
  )
}

SiteStarterReviewBody.displayName = 'SiteStarterReviewBody'

export default SiteStarterReviewBody
