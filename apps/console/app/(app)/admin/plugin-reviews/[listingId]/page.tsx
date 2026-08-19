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

import { ICON_VARIANT_SYMBOL_FLAG } from '@aglyn/shared-data-enums'
import { AppLink, CardDisplay, Container } from '@aglyn/shared-ui-jsx'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
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
  Skeleton,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { useUser } from '@aglyn/tenant-feature-instance'
import DashboardLayout from '../../../../../components/layouts/dashboard.layout'
import { MarkdownLiteView } from '@aglyn/aglyn-markdown-editor'
import StaffOnly from '../../../../../components/staff-only.component'
import { SuperStaffOnly } from '../../../../../components/staff-super-only.component'
import { docsHelp } from '../../../../../constants/docs-links'
import { PLUGIN_REVIEW_CHECKLIST } from '../../../../../constants/plugin-review-checklist'
import {
  PLUGIN_REJECTION_CATEGORIES,
  pluginRejectionCategory,
  rejectionHeadline,
  rejectionInputError,
} from '../../../../../constants/plugin-rejection-categories'
import { PUBLISHER_ATTESTATION } from '@aglyn/aglyn/app-utils/publisher-attestation'
import { reviewStatusMeaning } from '../../../../../constants/plugin-review-status'
import { buildRoute, Route } from '../../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../../constants/shared'

interface VersionEntry {
  version: string
  trust: string | null
  sha256: string
  hostAbi: number | null
  capabilities: { network?: string[]; events?: string[] }
  publishedAt: string | null
  signed: boolean
  reviewState: string
  grandfathered: boolean
  /** Installs that ever landed on this version (AGL-1036). */
  installCount: number
  /** Installs pinned to it right now — the blast radius of a revoke. */
  activeInstalls: number
  /** Kill switch is on for these bytes (AGL-1085). */
  revoked: boolean
}

interface ListingDetail {
  listingId: string
  displayName: string
  description: string
  readme: string
  license: string
  categories: string[]
  homepageUrl: string
  repositoryUrl: string
  publisherId: string
  publisherName: string
  publisherSlug: string | null
  reviewStatus: string
  rejectionReason: string
  rejectionCategory?: string
  priceUsd: number
  latestVersion: string
  activeInstalls: number
  hidden: boolean
  hiddenReason: string
  revoked: boolean
  unpublished: boolean
  platformHostAbi: number
  /** Bucket holding the bundle objects, for the Cloud console link (AGL-990). */
  artifactsBucket: string | null
  versions: VersionEntry[]
  verifier: {
    ok?: boolean
    problems?: Array<{ level: string; message: string; check?: string }>
    /** What was checked, including what passed and what never ran (AGL-1087). */
    checks?: Array<{
      id: string
      label: string
      status: 'pass' | 'fail' | 'question' | 'unknown'
      detail?: string
    }>
    error?: string
  } | null
  /** The verdict came from the version doc rather than a fresh download. */
  verifierCached: boolean
  /** Ticked items, keyed by id, for THIS version's bytes (AGL-963). */
  checklist: Record<string, { by: string | null }>
  checklistOutstanding: string[]
  /** Ids the publisher attested to for THIS version's bytes (AGL-969). */
  attestation: string[]
  /** Who signed the attestation, and when. */
  attestedBy: string | null
  attestedAt: string | null
  /** The org-level agreement this publisher is under (AGL-1077). */
  publisherAgreement: {
    version: string | null
    acceptedAt: string | null
    required: string
    state: 'none' | 'outdated' | 'current'
  }
  /** The version the checklist and verifier verdict above refer to. */
  reviewVersion: string
  private: boolean
  /** The publisher's standing ask for the Verified badge (AGL-1217). */
  verificationRequest?: {
    state?: string
    requestedAt?: string | null
    declineReason?: string | null
  } | null
}

/** Verifier findings read as a wall of text otherwise; group by severity. */
const SEVERITY_ORDER = ['error', 'warn', 'warning', 'info']

/**
 * One plugin submission or listed plugin, in full (AGL-960).
 *
 * The index is for scanning; this is where a reviewer reads the manifest,
 * weighs the verifier findings and acts. Every consequential action lives
 * here rather than on the list, so nobody grants realm trust or takes a
 * plugin down while skimming rows.
 */
const PluginReviewDetail: NextPageWithLayout<Record<string, never>> = () => {
  const params = useParams<{ listingId: string }>()
  const listingId = String(params?.listingId ?? '')
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const [detail, setDetail] = useState<ListingDetail | null>(null)
  // Rendered by default (AGL-989) — the reviewer's first question is what a
  // buyer sees; Source is for auditing exactly what was submitted.
  const [readmeView, setReadmeView] = useState<'rendered' | 'source'>(
    'rendered',
  )
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [reason, setReason] = useState('')
  // Structured rejection (AGL-977). The comment stays — it is what tells a
  // publisher what to fix — but it is no longer the only thing recorded.
  const [rejectCategory, setRejectCategory] = useState('')
  // The same predicate the route enforces, so the button and the server
  // cannot disagree about what a complete rejection looks like.
  const rejectBlocked = rejectionInputError(rejectCategory, reason)
  const rejectCategoryNeedsComment = Boolean(
    pluginRejectionCategory(rejectCategory)?.requiresComment,
  )
  const [takedownReason, setTakedownReason] = useState('')
  // Which version is being reviewed. Empty = let the server pick the oldest
  // one still awaiting a verdict, which is the work queue for this listing.
  const [selectedVersion, setSelectedVersion] = useState('')

  const token = useCallback(
    async () =>
      (user as { getIdToken?: () => Promise<string> })?.getIdToken?.(),
    [user],
  )

  const refresh = useCallback(async () => {
    const idToken = await token()
    if (!idToken || !listingId) return
    const response = await fetch(
      `/api/admin/plugin-reviews?listingId=${encodeURIComponent(listingId)}` +
        (selectedVersion
          ? `&version=${encodeURIComponent(selectedVersion)}`
          : ''),
      { headers: { Authorization: `Bearer ${idToken}` } },
    )
    if (response.ok) setDetail(await response.json())
    setLoaded(true)
  }, [token, listingId, selectedVersion])

  useEffect(() => {
    if (user) void refresh()
  }, [user, refresh])

  const post = useCallback(
    async (payload: Record<string, unknown>, success: string) => {
      setBusy(true)
      try {
        const idToken = await token()
        const response = await fetch('/api/admin/plugin-reviews', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
          },
          body: JSON.stringify({ listingId, ...payload }),
        })
        const result = await response.json().catch(() => ({}))
        if (response.ok) {
          enqueueSnackbar(success, { variant: 'success' })
          await refresh()
        } else {
          enqueueSnackbar(result?.error ?? 'Action failed', {
            variant: 'error',
            allowDuplicate: true,
          })
        }
      } finally {
        setBusy(false)
      }
    },
    [token, listingId, enqueueSnackbar, refresh],
  )

  const signRealm = useCallback(
    async (version: string, action: 'grant' | 'revoke') => {
      setBusy(true)
      try {
        const idToken = await token()
        const response = await fetch('/api/admin/sign-plugin', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
          },
          body: JSON.stringify({
            listingId,
            version,
            ...(action === 'revoke' ? { action: 'revoke' } : {}),
          }),
        })
        const result = await response.json().catch(() => ({}))
        if (response.ok) {
          enqueueSnackbar(
            action === 'revoke'
              ? `v${version} returned to the sandbox`
              : `v${version} signed for the app realm`,
            { variant: 'success' },
          )
          await refresh()
        } else {
          enqueueSnackbar(result?.error ?? 'Signing failed', {
            variant: 'error',
            allowDuplicate: true,
          })
        }
      } finally {
        setBusy(false)
      }
    },
    [token, listingId, enqueueSnackbar, refresh],
  )

  /**
   * Per-version kill switch (AGL-1085). Distinct from `takedown`, which
   * revokes EVERY version and hides the listing: stopping one version's
   * bytes must not also stop the approved version customers are running.
   */
  const setVersionRevoked = useCallback(
    async (version: string, revoke: boolean) => {
      await post(
        {
          action: revoke ? 'revoke-version' : 'unrevoke-version',
          version,
        },
        revoke
          ? `v${version} stopped — running installs render a placeholder on next load`
          : `v${version} allowed to run again`,
      )
    },
    [post],
  )

  const takedown = useCallback(async () => {
    if (!detail) return
    if (!detail.hidden && !takedownReason.trim()) {
      return void enqueueSnackbar('Taking a plugin down needs a reason', {
        variant: 'warning',
        allowDuplicate: true,
      })
    }
    await post(
      {
        action: detail.hidden ? 'unhide' : 'hide',
        reason: takedownReason,
      },
      detail.hidden
        ? `${detail.displayName} restored`
        : `${detail.displayName} taken down — running installs stop on next load`,
    )
    setTakedownReason('')
  }, [detail, takedownReason, post, enqueueSnackbar])

  const status = reviewStatusMeaning(detail?.reviewStatus ?? '')
  const blocked = (detail?.checklistOutstanding.length ?? 0) > 0

  /**
   * The version the approve/reject buttons act on (AGL-1085). Rejecting does
   * not stop bytes that are already pinned — the runtime resolves a pin by
   * {version, sha256} and only asks whether it is revoked — so the reviewer
   * needs this version's live-install count at the moment they decide, not
   * on some other page.
   */
  const reviewEntry = detail?.versions.find(
    (entry) => entry.version === detail?.reviewVersion,
  )
  const liveOnReviewVersion = reviewEntry?.activeInstalls ?? 0

  /**
   * Where a reviewer actually goes to check each item (AGL-973).
   *
   * Without these, the checklist asks people to "read the bundle source"
   * with no way to reach it — the bundle lives in a private bucket behind
   * the plugin origin, and its URL is content-addressed, so nobody could
   * construct it by hand. An unactionable checklist gets ticked without
   * being done, which is worse than no checklist.
   */
  const artifactUrl = (version: string) => {
    const entry = detail?.versions.find((item) => item.version === version)
    if (!entry?.sha256) return null
    const path = `/artifacts/${detail?.listingId}/${version}/${entry.sha256}.bundle`
    const origin = process.env.NEXT_PUBLIC_PLUGIN_ORIGIN ?? ''
    // The plugin origin just edge-rewrites to the console's own artifact
    // route, so fall back to that directly when the origin is unset — as it
    // is on every dev machine. Without the fallback the "read the bundle
    // source" link silently vanished exactly where it matters most, and a
    // reviewer had no way to reach the code they are certifying.
    return origin
      ? `${origin.replace(/\/+$/, '')}${path}`
      : `/api/plugin-artifacts/${detail?.listingId}/${version}/${entry.sha256}.bundle`
  }

  /**
   * The stored object in the Cloud console (AGL-990) — the served bundle is
   * what a reviewer READS, this is where they see the bytes: size, upload
   * time, content type, generation. The bucket is not in the Firebase
   * console, so nobody finds this by hand.
   */
  const bucketUrl = (version: string) => {
    const entry = detail?.versions.find((item) => item.version === version)
    if (!entry?.sha256 || !detail?.artifactsBucket) return null
    const object = `artifacts/${detail.listingId}/${version}/${entry.sha256}.bundle`
    return (
      'https://console.cloud.google.com/storage/browser/_details/' +
      `${detail.artifactsBucket}/${object}`
    )
  }

  const checklistLink = (
    itemId: string,
  ): { href: string; label: string; external?: boolean } | null => {
    if (!detail) return null
    // The version approved before this one — what a diff should be against.
    const previousApproved = detail.versions
      .filter(
        (entry) =>
          entry.version !== detail.reviewVersion &&
          entry.reviewState === 'approved',
      )
      .at(0)
    switch (itemId) {
      case 'provenance':
        return detail.repositoryUrl
          ? { href: detail.repositoryUrl, label: 'Open repository', external: true }
          : null
      case 'publisher':
        return {
          href: buildRoute(Route.ADMIN_ORG_DETAIL, { orgId: detail.publisherId }),
          label: 'Publisher workspace',
        }
      case 'source-read': {
        const href = artifactUrl(detail.reviewVersion)
        return href
          ? { href, label: `Read v${detail.reviewVersion} bundle`, external: true }
          : null
      }
      case 'diff': {
        const href = previousApproved
          ? artifactUrl(previousApproved.version)
          : null
        return href
          ? {
              href,
              label: `Previous approved: v${previousApproved?.version}`,
              external: true,
            }
          : null
      }
      case 'behaviour':
        return detail.publisherSlug
          ? {
              href: buildRoute(Route.ORG_MARKETPLACE_LISTING, {
                orgSlug: detail.publisherSlug,
                listingId: detail.listingId,
              }),
              label: 'Marketplace listing',
            }
          : null
      case 'license':
      case 'support':
        return detail.homepageUrl
          ? { href: detail.homepageUrl, label: 'Homepage', external: true }
          : detail.repositoryUrl
            ? { href: detail.repositoryUrl, label: 'Repository', external: true }
            : null
      default:
        return null
    }
  }

  // Everything in the Security card is a statement about the version under
  // review, whose capabilities are what the verifier checked against.
  const reviewVersionEntry = detail?.versions.find(
    (entry) => entry.version === detail?.reviewVersion,
  )
  const reviewCapabilities = reviewVersionEntry?.capabilities

  const findings = (detail?.verifier?.problems ?? [])
    .slice()
    .sort(
      (a, b) =>
        SEVERITY_ORDER.indexOf(a.level) - SEVERITY_ORDER.indexOf(b.level),
    )

  // The per-check summary (AGL-1087). Findings hang off the check that
  // produced them, so a reviewer reads "why" beside "what", and the counts
  // below say in one line whether this verdict is mostly green or mostly
  // questions. Findings from a checker that did not tag them fall through to
  // their own list rather than disappearing.
  const checks = detail?.verifier?.checks ?? []
  const findingsByCheck = new Map<string, typeof findings>()
  const untaggedFindings: typeof findings = []
  for (const finding of findings) {
    const id = finding.check
    if (!id || !checks.some((check) => check.id === id)) {
      untaggedFindings.push(finding)
      continue
    }
    findingsByCheck.set(id, [...(findingsByCheck.get(id) ?? []), finding])
  }
  const countBy = (status: string) =>
    checks.filter((check) => check.status === status).length

  return (
    <DashboardLayout
      breadcrumbItems={[
        {
          children: 'Plugin reviews',
          href: buildRoute(Route.ADMIN_PLUGIN_REVIEWS),
        },
        {
          children: detail?.displayName ?? listingId,
          href: buildRoute(Route.ADMIN_PLUGIN_REVIEW, { listingId }),
        },
      ]}
      help="staffConsole"
      header={{
        children: detail?.displayName ?? 'Plugin review',
        icon: { path: ICON_VARIANT_SYMBOL_FLAG.path },
      }}
    >
      <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
        <StaffOnly>
          {!loaded ? (
            <Stack spacing={2}>
              <Skeleton variant="rounded" height={120} />
              <Skeleton variant="rounded" height={220} />
            </Stack>
          ) : !detail ? (
            <Alert severity="warning">
              {'That listing no longer exists.'}
            </Alert>
          ) : (
            <Stack spacing={3}>
              {/* Status first: a reviewer needs to know what state they
                  are acting on before they read a word of the manifest. */}
              <CardDisplay header="Status"
                help={docsHelp('publisherHandbook', {
                  anchor: '#review-what-happens-after-you-publish',
                  excerpt:
                    'Where this version stands: submitted, listed, verified, or ' +
                    'rejected — and what each state lets a customer do.',
                })} contentGutterX contentGutterY>
                <Stack spacing={1.5}>
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                  >
                    <Chip size="small" color={status.color} label={status.label} />
                    <Chip
                      size="small"
                      variant="outlined"
                      label={`v${detail.latestVersion || '—'}`}
                    />
                    <Chip
                      size="small"
                      variant="outlined"
                      label={
                        detail.priceUsd > 0 ? `$${detail.priceUsd}` : 'Free'
                      }
                    />
                    <Chip
                      size="small"
                      variant="outlined"
                      label={`${detail.activeInstalls} install${
                        detail.activeInstalls === 1 ? '' : 's'
                      }`}
                    />
                    {detail.hidden ? (
                      <Chip
                        size="small"
                        color="error"
                        label="Taken down — revoked"
                      />
                    ) : null}
                    {detail.unpublished ? (
                      <Chip
                        size="small"
                        color="warning"
                        label="Unpublished by the publisher"
                      />
                    ) : null}
                  </Stack>
                  <Typography variant="caption" color="text.secondary">
                    {status.meaning}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {'Publisher: '}
                    {detail.publisherSlug ? (
                      <AppLink
                        // The storefront route takes a handle now
                        // (AGL-1001). This payload carries the org's slug
                        // and name, not the publisher profile's handle, so
                        // it passes the id — which that page still
                        // resolves, the same fallback that keeps existing
                        // links working.
                        href={buildRoute(Route.ORG_MARKETPLACE_PUBLISHER, {
                          orgSlug: detail.publisherSlug,
                          handle: detail.publisherId,
                        })}
                      >
                        {detail.publisherName}
                      </AppLink>
                    ) : (
                      detail.publisherName
                    )}
                    {` · ${detail.listingId}`}
                  </Typography>
                  {/* Grandfathering (AGL-965): plugins listed before the
                      checklist existed are still listed — retroactively
                      emptying the marketplace would be worse than the gap
                      — but staff should be able to see which ones carry
                      no recorded review for the bytes running today. */}
                  {['listed', 'verified'].includes(detail.reviewStatus) &&
                  detail.checklistOutstanding.length ? (
                    <Alert severity="warning">
                      {`Live in the marketplace with no recorded review for these bytes (${detail.checklistOutstanding.length} required item(s) outstanding). Work through the checklist, or delist while you do.`}
                    </Alert>
                  ) : null}
                  {detail.rejectionReason ? (
                    <Alert severity="error">
                      {`Rejected: ${rejectionHeadline(
                        detail.rejectionCategory,
                        detail.rejectionReason,
                      )}${
                        detail.rejectionReason &&
                        pluginRejectionCategory(detail.rejectionCategory)
                          ? ` — ${detail.rejectionReason}`
                          : ''
                      }`}
                    </Alert>
                  ) : null}
                  {detail.hidden ? (
                    <Alert severity="error">
                      {detail.hiddenReason
                        ? `Taken down: ${detail.hiddenReason}`
                        : 'Taken down (no reason recorded)'}
                    </Alert>
                  ) : null}
                </Stack>
              </CardDisplay>

              <CardDisplay header="Overview"
                help={docsHelp('publisherHandbook', {
                  excerpt:
                    'The listing as a customer sees it — name, description, media and ' +
                    'links, all publisher-supplied.',
                })} contentGutterX contentGutterY>
                <Stack spacing={1.5}>
                  <Typography variant="body2">
                    {detail.description || 'No description.'}
                  </Typography>
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                  >
                    {detail.license ? (
                      <Chip size="small" variant="outlined" label={detail.license} />
                    ) : (
                      <Chip size="small" color="warning" label="No license" />
                    )}
                    {detail.categories.map((category) => (
                      <Chip key={category} size="small" label={category} />
                    ))}
                  </Stack>
                  {detail.homepageUrl || detail.repositoryUrl ? (
                    <Typography variant="body2" color="text.secondary">
                      {detail.homepageUrl ? `Homepage: ${detail.homepageUrl}` : ''}
                      {detail.homepageUrl && detail.repositoryUrl ? ' · ' : ''}
                      {detail.repositoryUrl
                        ? `Repository: ${detail.repositoryUrl}`
                        : ''}
                    </Typography>
                  ) : null}
                  <Divider />
                  {/* A reviewer needs both halves (AGL-989): the rendered
                      page a buyer lands on, and the exact source the
                      publisher submitted. */}
                  <Stack
                    direction="row"
                    sx={{
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 1,
                    }}
                  >
                    <Typography variant="subtitle2">{'README'}</Typography>
                    <ToggleButtonGroup
                      exclusive
                      size="small"
                      value={readmeView}
                      onChange={(_event, next) => {
                        if (next) setReadmeView(next as 'rendered' | 'source')
                      }}
                    >
                      <ToggleButton value="rendered">
                        <Typography variant="caption">
                          {'Rendered'}
                        </Typography>
                      </ToggleButton>
                      <ToggleButton value="source">
                        <Typography variant="caption">{'Source'}</Typography>
                      </ToggleButton>
                    </ToggleButtonGroup>
                  </Stack>
                  {detail.readme ? (
                    // Framed (AGL-991): everything inside this border is
                    // publisher-submitted content, not our page. On a review
                    // screen that boundary is the whole job.
                    <Box
                      sx={{
                        maxHeight: 480,
                        overflowY: 'auto',
                        border: 1,
                        borderColor: 'divider',
                        borderRadius: 1,
                        p: 2,
                        bgcolor: 'action.hover',
                      }}
                    >
                      {readmeView === 'rendered' ? (
                        <MarkdownLiteView source={detail.readme} />
                      ) : (
                        <Typography
                          variant="body2"
                          component="pre"
                          sx={{
                            whiteSpace: 'pre-wrap',
                            fontFamily: 'monospace',
                            fontSize: 12,
                            m: 0,
                          }}
                        >
                          {detail.readme}
                        </Typography>
                      )}
                    </Box>
                  ) : (
                    <Alert severity="warning">
                      {'No README — publishers are expected to ship one.'}
                    </Alert>
                  )}
                </Stack>
              </CardDisplay>

              {/* What the bundle is allowed to reach, and what the static
                  verifier found in it. The two questions that decide
                  whether this code may run in the app realm. */}
              <CardDisplay header="Security"
                help={docsHelp('sandboxSecurity', {
                  excerpt:
                    'What the bundle asked for, against what the sandbox enforces ' +
                    'regardless of what it asked for.',
                })} contentGutterX contentGutterY>
                <Stack spacing={1.5}>
                  {/* The version under review, not the latest one: the
                      verifier diffs network calls against THESE declared
                      origins (AGL-964), so showing another version's
                      capabilities beside its findings would misexplain
                      them. */}
                  <Typography variant="body2" color="text.secondary">
                    {`Declared network: ${
                      reviewCapabilities?.network?.join(', ') || 'none'
                    } · events: ${
                      reviewCapabilities?.events?.join(', ') || 'none'
                    }`}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {`Host ABI: declared ${
                      reviewVersionEntry?.hostAbi ?? 'none (legacy)'
                    }, platform runs ${detail.platformHostAbi}`}
                  </Typography>
                  {/* "No findings" and "never checked" must not look the
                      same. A null verdict means the artifacts bucket is
                      unreachable or unconfigured, and rendering that as a
                      clean bill of health would invite a reviewer to
                      approve a bundle nobody has inspected. */}
                  {!detail.verifier ? (
                    <Alert severity="warning">
                      {'The static verifier has not run for this version — ' +
                        'no artifact was reachable. Treat this as unchecked, ' +
                        'not as clean.'}
                    </Alert>
                  ) : detail.verifier.error ? (
                    <Alert severity="warning">
                      {`Verifier could not run: ${detail.verifier.error}`}
                    </Alert>
                  ) : (
                    <Stack spacing={1}>
                      {/* One line for the whole verdict, then the areas
                          themselves (AGL-1087). "Found nothing" alone could
                          not tell a reviewer whether ten checks passed or
                          the interesting one never ran. */}
                      <Typography variant="body2" color="text.secondary">
                        {checks.length
                          ? [
                              `${countBy('pass')} passed`,
                              countBy('fail')
                                ? `${countBy('fail')} failed`
                                : '',
                              countBy('question')
                                ? `${countBy('question')} to question`
                                : '',
                              countBy('unknown')
                                ? `${countBy('unknown')} could not run`
                                : '',
                            ]
                              .filter(Boolean)
                              .join(' · ')
                          : detail.verifier.ok
                            ? 'Static verifier found nothing.'
                            : 'Static verifier found problems.'}
                        {/* Says WHICH bytes, because that is what makes a
                            stored verdict trustworthy — not when it ran. */}
                        {detail.verifierCached
                          ? ' · stored verdict for these exact bytes'
                          : ''}
                      </Typography>
                      {checks.map((check) => {
                        // The state has to survive being read aloud and being
                        // read by someone who cannot separate the red from the
                        // green (AGL-1089), so it is named in text as well as
                        // drawn — this is a page people skim to decide whether
                        // code runs in other people's workspaces.
                        const marker =
                          check.status === 'pass'
                            ? { glyph: '✓', color: 'success.main', name: 'Passed' }
                            : check.status === 'fail'
                              ? { glyph: '✕', color: 'error.main', name: 'Failed' }
                              : check.status === 'question'
                                ? {
                                    glyph: '?',
                                    color: 'warning.main',
                                    name: 'Worth questioning',
                                  }
                                : {
                                    glyph: '—',
                                    color: 'text.disabled',
                                    name: 'Not checked',
                                  }
                        return (
                          <Stack key={check.id} spacing={0.5}>
                            <Stack
                              direction="row"
                              spacing={1}
                              sx={{ alignItems: 'baseline' }}
                            >
                              <Typography
                                variant="body2"
                                aria-label={`${marker.name}:`}
                                sx={{ color: marker.color, width: 16 }}
                              >
                                {marker.glyph}
                              </Typography>
                              <Typography
                                variant="body2"
                                color={
                                  check.status === 'unknown'
                                    ? 'text.secondary'
                                    : undefined
                                }
                              >
                                {check.label}
                                {check.status === 'unknown'
                                  ? ' — not checked'
                                  : ''}
                              </Typography>
                              {check.detail ? (
                                <Typography
                                  variant="caption"
                                  color="text.secondary"
                                >
                                  {check.detail}
                                </Typography>
                              ) : null}
                            </Stack>
                            {(findingsByCheck.get(check.id) ?? []).map(
                              (problem, index) => (
                                <Alert
                                  key={`${check.id}-${index}`}
                                  severity={
                                    problem.level === 'error'
                                      ? 'error'
                                      : 'warning'
                                  }
                                  sx={{ ml: 3 }}
                                >
                                  {problem.message}
                                </Alert>
                              ),
                            )}
                          </Stack>
                        )
                      })}
                      {/* A verdict stored before findings carried their check
                          (AGL-1087) still has to be readable. */}
                      {untaggedFindings.map((problem, index) => (
                        <Alert
                          key={`untagged-${index}`}
                          severity={
                            problem.level === 'error' ? 'error' : 'warning'
                          }
                        >
                          {problem.message}
                        </Alert>
                      ))}
                      {checks.length ? (
                        <Typography variant="caption" color="text.secondary">
                          {'A full column of ticks means these shapes were ' +
                            'not found in code the parser could read. It is ' +
                            'not a statement that the plugin is safe — that ' +
                            'is the checklist below.'}
                        </Typography>
                      ) : null}
                    </Stack>
                  )}
                </Stack>
              </CardDisplay>

              {/* What the PUBLISHER claimed (AGL-969), read before the
                  reviewer's own list below. Not evidence — nothing here is
                  verified by anyone but the person who submitted it — but it
                  says where to look: an attestation that contradicts the
                  bundle is a documented false statement by a named publisher
                  on a date, which is what makes removal defensible rather
                  than a judgement call. */}
              <CardDisplay
                header={`Publisher attestation — v${detail.reviewVersion} (${detail.attestation.length}/${PUBLISHER_ATTESTATION.length})`}
                help={docsHelp('publisherHandbook', {
                  anchor: '#the-two-badges-and-what-each-one-promises',
                  excerpt:
                    'What the publisher asserted about THIS version. Their claim, not ' +
                    'our finding — the checklist below is ours.',
                })}
                contentGutterX
                contentGutterY
              >
                <Stack spacing={1}>
                  <Typography variant="body2" color="text.secondary">
                    {detail.attestedBy
                      ? `Stated by ${detail.attestedBy}${
                          detail.attestedAt
                            ? ` on ${new Date(
                                detail.attestedAt,
                              ).toLocaleDateString()}`
                            : ''
                        }, against this version's exact bytes.`
                      : 'Nothing recorded for these bytes.'}
                  </Typography>
                  {detail.attestation.length ? null : (
                    <Alert severity="info">
                      {'Published before publishers were asked to attest, or ' +
                        'republished since. Check everything yourself — the ' +
                        'absence of a claim is not a claim.'}
                    </Alert>
                  )}
                  {PUBLISHER_ATTESTATION.map((item) => {
                    const claimed = detail.attestation.includes(item.id)
                    return (
                      <Stack key={item.id} spacing={0.25}>
                        <Stack
                          direction="row"
                          spacing={1}
                          sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                        >
                          <Typography
                            variant="body2"
                            color={claimed ? undefined : 'text.secondary'}
                          >
                            {claimed ? '✓' : '—'} {item.label}
                          </Typography>
                          {item.updateOnly ? (
                            <Chip
                              size="small"
                              variant="outlined"
                              label="Updates only"
                            />
                          ) : null}
                        </Stack>
                      </Stack>
                    )
                  })}
                  {/* Which terms this publisher is under (AGL-1077). Sits
                      with the attestation because both answer "what has this
                      publisher committed to" — but they answer it at
                      different scopes. The attestation is about these bytes;
                      this is about the relationship, and it is the one that
                      decides what we are entitled to do if the bytes turn
                      out to be a problem. */}
                  <Divider sx={{ my: 1 }} />
                  <Typography variant="body2" color="text.secondary">
                    {detail.publisherAgreement?.state === 'current'
                      ? `Publisher agreement v${detail.publisherAgreement.version} accepted` +
                        (detail.publisherAgreement.acceptedAt
                          ? ` on ${new Date(
                              detail.publisherAgreement.acceptedAt,
                            ).toLocaleDateString()}`
                          : '') +
                        '.'
                      : detail.publisherAgreement?.state === 'outdated'
                        ? `Publisher agreement: on v${detail.publisherAgreement.version}, ` +
                          `current is v${detail.publisherAgreement.required}. This ` +
                          'version was published under the older terms.'
                        : 'No publisher agreement on record — this org ' +
                          'published before one existed. Weigh a takedown ' +
                          'against the Terms of Service, not against terms ' +
                          'nobody accepted.'}
                  </Typography>
                </Stack>
              </CardDisplay>

              {/* The checklist is the actual review (AGL-963). The verifier
                  parses the bundle now (AGL-964), so computed access like
                  g['ev'+'al'] no longer walks past it — but it still reads
                  only shapes, never intent. These items are the things a
                  machine structurally cannot judge. */}
              <CardDisplay
                header={`Review checklist — v${detail.reviewVersion} (${
                  PLUGIN_REVIEW_CHECKLIST.filter(
                    (item) => detail.checklist?.[item.id],
                  ).length
                }/${PLUGIN_REVIEW_CHECKLIST.length})`}
                help={docsHelp('publisherHandbook', {
                  anchor: '#review-what-happens-after-you-publish',
                  excerpt:
                    'The checklist a reviewer works through. Re-earned per version — a ' +
                    'new release starts with none of it ticked.',
                })}
                contentGutterX
                contentGutterY
              >
                <Stack spacing={1}>
                  <Typography variant="body2" color="text.secondary">
                    {'The static verifier is a lint, not a boundary — it ' +
                      'parses the bundle and reports shapes (computed access ' +
                      'on a global, undeclared network calls), but it cannot ' +
                      'judge what the code is for, and code it cannot see ' +
                      'through it says nothing about. These are the checks ' +
                      'only a person can make. Ticks are recorded against ' +
                      "this version's exact bytes and reset if it is " +
                      'republished.'}
                  </Typography>
                  {detail.checklistOutstanding.length ? (
                    <Alert severity="info">
                      {`${detail.checklistOutstanding.length} required item(s) outstanding — List and Verify stay blocked until they are done. Rejecting never needs the checklist.`}
                    </Alert>
                  ) : (
                    <Alert severity="success">
                      {'Every required item is recorded for these bytes.'}
                    </Alert>
                  )}
                  {PLUGIN_REVIEW_CHECKLIST.map((item) => (
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
                                event.target.checked
                                  ? 'Recorded'
                                  : 'Cleared',
                              )
                            }
                          />
                        }
                        label={
                          <Stack
                            direction="row"
                            spacing={1}
                            sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                          >
                            <Typography variant="body2">
                              {item.label}
                            </Typography>
                            {item.required ? (
                              <Chip size="small" label="Required" />
                            ) : null}
                            {item.realmOnly ? (
                              <Chip
                                size="small"
                                variant="outlined"
                                label="Realm trust"
                              />
                            ) : null}
                          </Stack>
                        }
                      />
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ pl: 4 }}
                      >
                        {item.detail}
                      </Typography>
                      {(() => {
                        const link = checklistLink(item.id)
                        // The stored object sits beside what it serves
                        // (AGL-990) — read the code, then inspect the bytes.
                        const bucket =
                          item.id === 'source-read' && detail
                            ? bucketUrl(detail.reviewVersion)
                            : null
                        if (!link && !bucket) return null
                        // External targets (the raw bundle, the publisher's
                        // repo) are plain anchors on purpose; internal ones
                        // go through AppLink so the SPA does not full-reload.
                        return (
                          <Stack
                            direction="row"
                            spacing={2}
                            sx={{ pl: 4, flexWrap: 'wrap' }}
                          >
                            {link ? (
                              <Typography variant="caption">
                                {link.external ? (
                                  <MuiLink
                                    href={link.href}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    {`${link.label} ↗`}
                                  </MuiLink>
                                ) : (
                                  <AppLink href={link.href}>
                                    {link.label}
                                  </AppLink>
                                )}
                              </Typography>
                            ) : null}
                            {bucket ? (
                              <Typography variant="caption">
                                <MuiLink
                                  href={bucket}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  {'Object in Cloud Storage ↗'}
                                </MuiLink>
                              </Typography>
                            ) : null}
                          </Stack>
                        )
                      })()}
                    </Stack>
                  ))}
                </Stack>
              </CardDisplay>

              {/* Verdicts, ordered by consequence rather than by the
                  order they were built (AGL-966). The old card was a flat
                  row of same-weight text buttons where "List" — the click
                  that makes a plugin installable by every workspace — sat
                  between "Start review" and a rejection box. */}
              <CardDisplay
                header="Review verdict"
                contentGutterX
                contentGutterY
                help={docsHelp('manifestAndEnvs', {
                  anchor: '#review--trust-lifecycle',
                  excerpt:
                    'Move this submission through the review lifecycle — list, verify, or reject with a reason.',
                })}
              >
                <Stack spacing={2}>
                  <Stack spacing={0.5}>
                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                    >
                      <Typography variant="body2">{'Currently:'}</Typography>
                      <Chip
                        size="small"
                        color={status.color}
                        label={status.label}
                      />
                      {status.live ? (
                        <Chip size="small" color="warning" label="Live to customers" />
                      ) : (
                        <Chip size="small" variant="outlined" label="Not installable" />
                      )}
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                      {status.meaning}
                    </Typography>
                  </Stack>

                  <Divider />

                  {/* The verdict that matters is per VERSION (AGL-966).
                      Approving these bytes is what makes them installable;
                      listing-level state only says whether the plugin is
                      in the marketplace at all. */}
                  <Stack spacing={0.5}>
                    <Typography variant="subtitle2">
                      {`Verdict on v${detail.reviewVersion}`}
                    </Typography>
                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                    >
                      <TextField
                        size="small"
                        select
                        value={detail.reviewVersion}
                        onChange={(event) =>
                          setSelectedVersion(event.target.value)
                        }
                        sx={{ minWidth: 160 }}
                      >
                        {detail.versions.map((entry) => (
                          <MenuItem key={entry.version} value={entry.version}>
                            {`v${entry.version} · ${entry.reviewState}`}
                          </MenuItem>
                        ))}
                      </TextField>
                      <Button
                        size="small"
                        variant="contained"
                        color="success"
                        disabled={busy || blocked}
                        onClick={() =>
                          void post(
                            {
                              action: 'approve-version',
                              version: detail.reviewVersion,
                            },
                            `v${detail.reviewVersion} approved`,
                          )
                        }
                      >
                        {'Approve version'}
                      </Button>
                      <Button
                        size="small"
                        color="error"
                        disabled={busy}
                        onClick={() =>
                          void post(
                            {
                              action: 'reject-version',
                              version: detail.reviewVersion,
                              reason,
                            },
                            `v${detail.reviewVersion} rejected`,
                          )
                        }
                      >
                        {'Reject version'}
                      </Button>
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                      {'Approving makes these bytes the version new ' +
                        'installs receive. Existing installs are pinned and ' +
                        'do not move. A pending version is never installed ' +
                        'by anyone but its publisher, so an update cannot ' +
                        'ship past review.'}
                    </Typography>
                    {blocked ? (
                      <Alert severity="info" sx={{ mt: 0.5 }}>
                        {`Blocked: ${detail.checklistOutstanding.length} required checklist item(s) outstanding for these bytes.`}
                      </Alert>
                    ) : null}
                    {/* AGL-1085: a rejection is a verdict, not a kill. These
                        bytes are live somewhere, so say so HERE — the number
                        is what decides whether the kill switch is warranted,
                        and a reviewer who has to go and find it will not. */}
                    {liveOnReviewVersion > 0 ? (
                      <Alert
                        severity={reviewEntry?.revoked ? 'success' : 'warning'}
                        sx={{ mt: 0.5 }}
                        action={
                          <Button
                            size="small"
                            color="inherit"
                            disabled={busy}
                            onClick={() =>
                              void setVersionRevoked(
                                detail.reviewVersion,
                                !reviewEntry?.revoked,
                              )
                            }
                          >
                            {reviewEntry?.revoked
                              ? 'Allow again'
                              : 'Stop these bytes'}
                          </Button>
                        }
                      >
                        {reviewEntry?.revoked
                          ? `v${detail.reviewVersion} is stopped. The ` +
                            `${liveOnReviewVersion} site${
                              liveOnReviewVersion === 1
                                ? ' pinned to it renders'
                                : 's pinned to it render'
                            } a placeholder instead.`
                          : `${liveOnReviewVersion} site${
                              liveOnReviewVersion === 1
                                ? ' is'
                                : 's are'
                            } running v${detail.reviewVersion} right now. ` +
                            'Rejecting it stops new installs but leaves ' +
                            'those running — stop the bytes if they should ' +
                            'not be executing.'}
                      </Alert>
                    ) : null}
                  </Stack>

                  <Divider />

                  {/* Listing-level distribution, unchanged. */}
                  <Stack spacing={0.5}>
                    <Typography variant="subtitle2">
                      {'Marketplace listing'}
                    </Typography>
                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                    >
                      {/* The action the queue was missing (AGL-2059).
                          `list` is what turns `isListingBrowsable` true —
                          the moment third-party code becomes installable by
                          every workspace — and it had no button, while
                          `verify`, which only adds a badge, has had one all
                          along. The only way a listing reached `listed` was
                          the incidental mirror inside `approve-version`, so
                          the consequential act happened as a side effect of
                          a control labelled about something else, and a
                          delisted plugin had no path back at all.

                          Same checklist gate as `Verify` — the route gates
                          both (and the `list` half of that gate had never
                          been reachable). `warning`, matching the `listed`
                          chip: this state is the live one, and the colour
                          is the page's existing shorthand for that. */}
                      {!['listed', 'verified'].includes(detail.reviewStatus) ? (
                        <Tooltip
                          title={
                            blocked
                              ? `Complete the review checklist first — ` +
                                `${detail.checklistOutstanding.length} required ` +
                                `item(s) outstanding for this version's bytes`
                              : 'Makes this plugin browsable in the ' +
                                'marketplace and installable by every ' +
                                'workspace. This is the step that puts the ' +
                                'code in front of customers.'
                          }
                        >
                          <span>
                            <Button
                              size="small"
                              color="warning"
                              variant="outlined"
                              disabled={busy || blocked}
                              onClick={() =>
                                void post(
                                  { action: 'list' },
                                  'Listed — installable by every workspace',
                                )
                              }
                            >
                              {'List in marketplace'}
                            </Button>
                          </span>
                        </Tooltip>
                      ) : null}
                      {/* Claiming a submission (AGL-2059). Ungated, as the
                          route intends: `delist` reuses `in_review` but
                          reads as a retreat, so with more than one reviewer
                          there was no way to say "I have this one". */}
                      {detail.reviewStatus === 'submitted' ? (
                        <Button
                          size="small"
                          variant="outlined"
                          disabled={busy}
                          onClick={() =>
                            void post(
                              { action: 'start-review' },
                              'Marked in review',
                            )
                          }
                        >
                          {'Start review'}
                        </Button>
                      ) : null}
                      {detail.reviewStatus !== 'verified' ? (
                        // Say WHY it is disabled, at the button (AGL-1121).
                        // The checklist alert lives elsewhere on the page, so
                        // a reviewer met a greyed-out control with no stated
                        // cause and reasonably read it as broken. The tooltip
                        // names the count and where to clear it; a disabled
                        // MUI Button swallows pointer events, so the wrapper
                        // is what the tooltip can attach to.
                        <Tooltip
                          title={
                            blocked
                              ? `Complete the review checklist first — ` +
                                `${detail.checklistOutstanding.length} required ` +
                                `item(s) outstanding for this version's bytes`
                              : ''
                          }
                        >
                          <span>
                            <Button
                              size="small"
                              color="success"
                              variant="outlined"
                              disabled={busy || blocked}
                              onClick={() =>
                                void post({ action: 'verify' }, 'Verified')
                              }
                            >
                              {'Verify ✓ (badge)'}
                            </Button>
                          </span>
                        </Tooltip>
                      ) : null}
                      {/* Only when something is actually waiting (AGL-1217).
                          Declining is a refusal of a request, not a verdict
                          on the plugin — offering it with nothing pending
                          would invite staff to refuse something nobody
                          asked for. Verify is already on this bar and is
                          how a request is GRANTED, so there is no second
                          grant button. */}
                      {detail.verificationRequest?.state === 'pending' ? (
                        <Button
                          size="small"
                          color="warning"
                          variant="outlined"
                          disabled={busy}
                          onClick={() => {
                            const reason = window.prompt(
                              'Why is verification declined? The publisher is ' +
                                'told this, and cannot ask again for 30 days.',
                            )
                            // `prompt` returns null on cancel and '' on an
                            // empty submit. Neither is a decline — the server
                            // requires a reason, and sending one anyway would
                            // surface as an error the reviewer did not cause.
                            if (!reason?.trim()) return
                            void post(
                              { action: 'decline-verification', reason },
                              'Verification declined',
                            )
                          }}
                        >
                          {'Decline verification'}
                        </Button>
                      ) : null}
                      {detail.private ? (
                        <Chip size="small" label="Private — never listed" />
                      ) : null}
                    </Stack>
                  </Stack>

                  <Divider />

                  {/* Back down the ladder. Never checklist-gated — a
                      retreat must always be available — and deliberately
                      quieter than the danger zone below, which is the only
                      control that reaches code already running. */}
                  <Stack spacing={0.5}>
                    <Typography variant="subtitle2">{'Step back'}</Typography>
                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                    >
                      <TextField
                        select
                        size="small"
                        label="Rejection reason"
                        value={rejectCategory}
                        onChange={(event) =>
                          setRejectCategory(event.target.value)
                        }
                        // `displayEmpty` is not enough on a MUI Select: an
                        // empty value renders NOTHING without a rendered
                        // option, so the field reads as broken.
                        slotProps={{
                          select: { displayEmpty: true },
                          inputLabel: { shrink: true },
                        }}
                        sx={{ minWidth: 260 }}
                      >
                        <MenuItem value="">{'Select a reason…'}</MenuItem>
                        {PLUGIN_REJECTION_CATEGORIES.map((entry) => (
                          <MenuItem key={entry.id} value={entry.id}>
                            {entry.label}
                          </MenuItem>
                        ))}
                      </TextField>
                      <TextField
                        size="small"
                        placeholder={
                          rejectCategoryNeedsComment
                            ? 'Comment (required for “Other”)'
                            : 'Comment (optional)'
                        }
                        value={reason}
                        onChange={(event) => setReason(event.target.value)}
                        sx={{ minWidth: 260 }}
                      />
                      {status.live ? (
                        <Button
                          size="small"
                          color="warning"
                          disabled={busy}
                          onClick={() =>
                            void post(
                              { action: 'delist', reason },
                              'Delisted — back in review',
                            )
                          }
                        >
                          {'Delist'}
                        </Button>
                      ) : null}
                      {detail.reviewStatus === 'verified' ? (
                        <Button
                          size="small"
                          disabled={busy}
                          onClick={() =>
                            void post({ action: 'unverify' }, 'Badge removed')
                          }
                        >
                          {'Unverify'}
                        </Button>
                      ) : null}
                      <Button
                        size="small"
                        color="error"
                        // Disabled rather than left to fail server-side: the
                        // route validates too, but a reviewer should not have
                        // to press a button to learn the form is incomplete.
                        disabled={busy || Boolean(rejectBlocked)}
                        onClick={() =>
                          void post(
                            { action: 'reject', reason, category: rejectCategory },
                            'Rejected',
                          )
                        }
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
                      {'Delist pulls it from the marketplace and blocks new ' +
                        'installs; existing installs keep working. Unverify ' +
                        'only drops the badge. Reject notifies the publisher. ' +
                        'None of these stop code already running — that is ' +
                        'the danger zone.'}
                    </Typography>
                  </Stack>
                </Stack>
              </CardDisplay>

              <CardDisplay header="Versions"
                help={docsHelp('publisherHandbook', {
                  anchor: '#versioning--updates',
                  excerpt:
                    'Every version this publisher has submitted. Review lives on the ' +
                    'VERSION, so each one is judged on its own.',
                })} contentGutterX contentGutterY>
                <Stack spacing={1}>
                  <Typography variant="body2" color="text.secondary">
                    {'Granting realm trust signs a version to run inside ' +
                      'the app realm instead of the sandbox iframe. ' +
                      'Super-staff only, audited.'}
                  </Typography>
                  {/* The two axes get conflated constantly (AGL-966):
                      review status is per LISTING and controls who can
                      install; trust is per VERSION and controls what the
                      code can reach once installed. Verified is not realm
                      trust, and realm trust is the far more dangerous of
                      the two. */}
                  <Alert severity="info">
                    {'This is a different axis from the review verdict above. ' +
                      'Listing and verifying apply to the whole listing and ' +
                      'decide who may install it. Trust applies to ONE ' +
                      'version and decides where its code runs: sandboxed in ' +
                      'a cross-origin iframe capped by the manifest CSP, or ' +
                      'inside the app realm with neither of those between it ' +
                      'and user data. A verified plugin can be sandboxed, and ' +
                      'a sandboxed version of a verified plugin is the normal ' +
                      'case — realm trust is the exception that needs a ' +
                      'reason.'}
                  </Alert>
                  {detail.versions.map((entry) => (
                    <Stack
                      key={entry.version}
                      direction="row"
                      spacing={1}
                      sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                    >
                      <Typography variant="body2" sx={{ minWidth: 64 }}>
                        {`v${entry.version}`}
                      </Typography>
                      {entry.version === detail.latestVersion ? (
                        <Chip size="small" label="Latest" />
                      ) : null}
                      <Chip
                        size="small"
                        color={
                          entry.reviewState === 'approved'
                            ? 'success'
                            : entry.reviewState === 'rejected'
                              ? 'error'
                              : 'warning'
                        }
                        variant="outlined"
                        label={
                          entry.grandfathered
                            ? 'approved (grandfathered)'
                            : entry.reviewState
                        }
                      />
                      <Chip
                        size="small"
                        color={entry.trust === 'realm' ? 'success' : 'default'}
                        variant={entry.trust === 'realm' ? 'filled' : 'outlined'}
                        label={
                          entry.trust === 'realm' ? 'Realm-trusted' : 'Sandboxed'
                        }
                      />
                      {/* AGL-1085. Two states worth distinguishing at a
                          glance: bytes a reviewer turned off, and rejected
                          bytes still executing somewhere — which a rejection
                          alone never changes. */}
                      {entry.revoked ? (
                        <Chip size="small" color="error" label="Stopped" />
                      ) : entry.reviewState === 'rejected' &&
                        entry.activeInstalls > 0 ? (
                        <Chip
                          size="small"
                          color="error"
                          variant="outlined"
                          label="Rejected but still running"
                        />
                      ) : null}
                      <Typography variant="caption" color="text.secondary">
                        {entry.publishedAt
                          ? new Date(entry.publishedAt).toLocaleDateString()
                          : '—'}
                        {` · ${entry.sha256.slice(0, 12)}`}
                        {/* The blast radius of revoking THIS version
                            (AGL-1036) — the listing total above answers a
                            different question. */}
                        {entry.activeInstalls
                          ? ` · ${entry.activeInstalls} pinned here`
                          : ''}
                      </Typography>
                      {/* Realm trust bypasses the plugin sandbox's CSP, so
                          /api/admin/sign-plugin is super-only. The button was
                          live for support staff (AGL-2131). */}
                      <SuperStaffOnly>
                        <Button
                          size="small"
                          color={entry.trust === 'realm' ? 'error' : 'success'}
                          disabled={busy}
                          onClick={() =>
                            void signRealm(
                              entry.version,
                              entry.trust === 'realm' ? 'revoke' : 'grant',
                            )
                          }
                        >
                          {entry.trust === 'realm'
                            ? 'Revoke realm trust'
                            : 'Grant realm trust'}
                        </Button>
                      </SuperStaffOnly>
                      {/* The kill switch for THESE bytes (AGL-1085) —
                          narrower than the takedown below, which stops every
                          version including the one customers are happily
                          running. */}
                      <Button
                        size="small"
                        color={entry.revoked ? 'success' : 'error'}
                        disabled={busy}
                        onClick={() =>
                          void setVersionRevoked(entry.version, !entry.revoked)
                        }
                      >
                        {entry.revoked ? 'Allow again' : 'Stop this version'}
                      </Button>
                    </Stack>
                  ))}
                </Stack>
              </CardDisplay>

              {/* Separated on purpose: this is the only control here that
                  reaches code already running in customers' workspaces. */}
              <CardDisplay header="Danger zone"
                help={docsHelp('publisherHandbook', {
                  anchor: '#review-what-happens-after-you-publish',
                  excerpt:
                    'Rejecting a version is not a kill switch — it stops new installs ' +
                    'and leaves existing ones running.',
                })} contentGutterX contentGutterY>
                <Stack spacing={1.5}>
                  <Typography variant="body2" color="text.secondary">
                    {'Taking a plugin down de-lists it AND writes the kill ' +
                      'switch: every workspace that already installed it ' +
                      'stops loading it on the next render, and new ' +
                      'installs are refused. Restoring clears both.'}
                  </Typography>
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                  >
                    {detail.hidden ? null : (
                      <TextField
                        size="small"
                        placeholder="Takedown reason"
                        value={takedownReason}
                        onChange={(event) =>
                          setTakedownReason(event.target.value)
                        }
                        sx={{ minWidth: 260 }}
                      />
                    )}
                    <Button
                      size="small"
                      variant={detail.hidden ? 'text' : 'outlined'}
                      color={detail.hidden ? 'success' : 'error'}
                      disabled={busy}
                      onClick={() => void takedown()}
                    >
                      {detail.hidden ? 'Restore listing' : 'Take down'}
                    </Button>
                  </Stack>
                </Stack>
              </CardDisplay>
            </Stack>
          )}
        </StaffOnly>
      </Container>
    </DashboardLayout>
  )
}

export default PluginReviewDetail
