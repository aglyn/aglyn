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

import { CardDisplay } from '@aglyn/shared-ui-jsx'
import {
  Alert,
  Chip,
  Divider,
  Stack,
  Typography,
} from '@mui/material'
import { useEffect, useState } from 'react'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  attestationLabels,
  PUBLISHER_ATTESTATION,
  requiredAttestationIds,
} from '@aglyn/aglyn/app-utils/publisher-attestation'
import { docsHelp } from '../../constants/docs-links'

export interface PublisherVersion {
  version: string
  publishedAtMs: number | null
  sha256: string
  reviewState: string
  grandfathered: boolean
  signed: boolean
  changelog: string
  rejectionReason: string
  activeInstalls: number
  attestation: string[]
}

interface PublisherVersionsPayload {
  versions: PublisherVersion[]
  latestApprovedVersion: string
  latestVersion: string
}

/**
 * A review state said in words (AGL-1079).
 *
 * `grandfathered` is checked FIRST and deliberately: those versions were
 * published before review was per-version (AGL-966), so they carry no
 * verdict at all. Calling them "pending" would promise a reviewer who is
 * never coming, and calling them "approved" would claim a judgement nobody
 * made.
 */
function reviewLabel(entry: PublisherVersion): {
  label: string
  color: 'default' | 'success' | 'warning' | 'error' | 'info'
  detail: string
} {
  if (entry.grandfathered) {
    return {
      label: 'Published before review',
      color: 'default',
      detail:
        'Published before versions were reviewed individually. It installs, ' +
        'but no reviewer ever signed off on these bytes.',
    }
  }
  switch (entry.reviewState) {
    case 'approved':
      return {
        label: 'Approved',
        color: 'success',
        detail: 'A reviewer approved these exact bytes.',
      }
    case 'rejected':
      return {
        label: 'Rejected',
        color: 'error',
        detail:
          'Not installable. Fix what the reason says and publish a new ' +
          'version — these bytes cannot be edited.',
      }
    case 'pending':
      return {
        label: 'In review',
        color: 'warning',
        detail:
          'Waiting for a reviewer. Nobody else can install it — but you ' +
          'can, on your own sites, which is how you test a version before ' +
          'it is approved.',
      }
    default:
      return {
        label: 'Unknown',
        color: 'default',
        detail: 'No review state was recorded for this version.',
      }
  }
}

export interface ListingReviewStatusProps {
  listingId: string
  /** Only a plugin listing has a review-per-version story to tell. */
  isPlugin: boolean
}

/**
 * What review is doing with a publisher's versions (AGL-1079).
 *
 * AGL-966's guarantee — a new version waits in the queue while the
 * previously approved one keeps installing — has been true and invisible
 * since the day it shipped. A publisher got an email on the outcome and,
 * in between, a listing row identical to the one they had before they
 * published. This is the page that answers what they submitted, what state
 * it is in, which version their customers are actually on, and why one was
 * sent back.
 *
 * Reads through the publisher-scoped versions endpoint rather than
 * Firestore: `pluginVersions` is server-only, because the docs carry
 * publish internals a client has no business holding.
 */
export function ListingReviewStatus(props: ListingReviewStatusProps) {
  const { listingId, isPlugin } = props
  const { data: user } = useUser()
  const [payload, setPayload] = useState<PublisherVersionsPayload | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!listingId || !isPlugin) return undefined
    void (async () => {
      try {
        const idToken = await (
          user as { getIdToken?: () => Promise<string> }
        )?.getIdToken?.()
        if (!idToken) return
        const response = await fetch(
          `/api/marketplace/listing-versions?scope=publisher&listingId=${encodeURIComponent(
            listingId,
          )}`,
          { headers: { Authorization: `Bearer ${idToken}` } },
        )
        if (!response.ok) {
          if (!cancelled) setFailed(true)
          return
        }
        const data = (await response.json()) as PublisherVersionsPayload
        if (!cancelled) setPayload(data)
      } catch {
        if (!cancelled) setFailed(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [listingId, isPlugin, user])

  if (!isPlugin) return null
  if (failed) return null
  // Nothing rather than an empty shell: this card is only worth space once
  // it has something to say, and a skeleton that never fills is worse than
  // a card that appears.
  if (!payload) return null

  const { versions, latestApprovedVersion, latestVersion } = payload
  const inReview = versions.filter(
    (entry) => entry.reviewState === 'pending' && !entry.grandfathered,
  )
  const behind =
    latestApprovedVersion &&
    latestVersion &&
    latestApprovedVersion !== latestVersion

  return (
    <CardDisplay
      header={'Review status'}
      help={docsHelp('publisherHandbook', {
        anchor: '#review-what-happens-after-you-publish',
        excerpt:
          'What state each version is in, which one installs today, and why ' +
          'anything was sent back.',
      })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        {/* The AGL-966 guarantee, in a sentence. It has been true since the
            day it shipped and nobody has ever read it. */}
        {behind && inReview.length ? (
          <Alert severity="info">
            {`v${latestVersion} is in review. New installs get ` +
              `v${latestApprovedVersion} until it is approved, and anyone ` +
              'already running it stays where they are.'}
          </Alert>
        ) : behind ? (
          <Alert severity="warning">
            {`v${latestVersion} is not approved, so new installs get ` +
              `v${latestApprovedVersion}.`}
          </Alert>
        ) : latestApprovedVersion ? (
          <Alert severity="success">
            {`v${latestApprovedVersion} is approved and is what installs today.`}
          </Alert>
        ) : (
          <Alert severity="info">
            {'Nothing is approved yet, so nobody else can install this. A ' +
              'reviewer sees your submission in the queue. You can still ' +
              'install it on your own sites to test it — that is the only ' +
              'way these bytes run today.'}
          </Alert>
        )}

        {/* Stated rather than implied (AGL-1079). Both halves are things a
            publisher currently has to infer from behaviour. */}
        <Typography variant="caption" color="text.secondary">
          {'While a version is in review you can still edit this listing — ' +
            'name, description, README, screenshots and links — and it will ' +
            'not send anything back to the queue, because approval is about ' +
            'the bundle’s bytes. The bytes themselves are never edited: ' +
            'changing them means publishing a new version.'}
        </Typography>

        <Divider />

        <Stack spacing={2}>
          {versions.map((entry) => {
            const state = reviewLabel(entry)
            const claimed = entry.attestation.length
            // Which set applied to THIS version: the first one published is
            // not asked for a changelog, so measuring every version against
            // the update set would report the first as permanently short.
            const expected = requiredAttestationIds(
              entry.version !== versions[versions.length - 1]?.version,
            ).length
            return (
              <Stack key={entry.version} spacing={0.5}>
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                >
                  <Typography variant="subtitle2">{`v${entry.version}`}</Typography>
                  <Chip size="small" color={state.color} label={state.label} />
                  {entry.version === latestApprovedVersion ? (
                    <Chip
                      size="small"
                      variant="outlined"
                      label="Installs today"
                    />
                  ) : null}
                  {entry.signed ? (
                    <Chip
                      size="small"
                      variant="outlined"
                      label="Realm-trusted"
                    />
                  ) : null}
                  {entry.activeInstalls ? (
                    <Chip
                      size="small"
                      variant="outlined"
                      color={
                        state.label === 'Approved' ? undefined : 'warning'
                      }
                      label={`${entry.activeInstalls} on this version`}
                    />
                  ) : null}
                </Stack>
                <Typography variant="caption" color="text.secondary">
                  {state.detail}
                  {entry.publishedAtMs
                    ? ` Published ${new Date(
                        entry.publishedAtMs,
                      ).toLocaleDateString()}.`
                    : ''}
                </Typography>
                {/* An unreviewed version that is nonetheless RUNNING
                    somewhere. The publisher-testing carve-out in
                    `install-plugin` is deliberate — you cannot test a
                    version you cannot install — but it is invisible, and a
                    card that said "nothing installs it yet" over a live
                    install was worse than saying nothing. */}
                {entry.activeInstalls &&
                entry.reviewState !== 'approved' &&
                !entry.grandfathered ? (
                  <Alert severity="warning" sx={{ mt: 0.5 }}>
                    {`${entry.activeInstalls} of your sites ${
                      entry.activeInstalls === 1 ? 'is' : 'are'
                    } running this version, which no reviewer has approved. ` +
                      'Only your own organization can install it — but if ' +
                      'one of those is a live site, unreviewed code is ' +
                      'serving real visitors.'}
                  </Alert>
                ) : null}
                {/* In place, on the version it belongs to — it only ever
                    reached an email before. */}
                {entry.rejectionReason ? (
                  <Alert severity="error" sx={{ mt: 0.5 }}>
                    {entry.rejectionReason}
                  </Alert>
                ) : null}
                {entry.changelog ? (
                  <Typography variant="caption">
                    {entry.changelog}
                  </Typography>
                ) : null}
                <Typography variant="caption" color="text.secondary">
                  {claimed
                    ? `You confirmed ${claimed}/${expected}: ` +
                      attestationLabels(entry.attestation)
                        .map((label) => label.replace(/\s+/g, ' '))
                        .join('; ')
                    : `Nothing was confirmed for these bytes — published ` +
                      'before the pre-publish checklist existed, or ' +
                      'republished since.'}
                </Typography>
                {entry.sha256 ? (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ fontFamily: 'monospace' }}
                  >
                    {`sha256 ${entry.sha256.slice(0, 12)}…`}
                  </Typography>
                ) : null}
              </Stack>
            )
          })}
          {versions.length ? null : (
            <Typography variant="caption" color="text.secondary">
              {'No versions published yet.'}
            </Typography>
          )}
        </Stack>
      </Stack>
    </CardDisplay>
  )
}

ListingReviewStatus.displayName = 'ListingReviewStatus'

export default ListingReviewStatus

/** Exported for the spec: the words each state is said in. */
export { reviewLabel, PUBLISHER_ATTESTATION }
