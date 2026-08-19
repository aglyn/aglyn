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

import { trackEvent } from '@aglyn/aglyn/app-utils/analytics-events'
import { mdiDotsVertical } from '@aglyn/shared-data-mdi'
import { AppLink, CardDisplay, MdiIcon } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Timestamp } from '@aglyn/shared-util-timestamp'
import {
  Alert,
  Avatar,
  Button,
  Chip,
  Divider,
  IconButton,
  Link,
  Menu,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import {
  PUBLISHER_AGREEMENT_POINTS,
  PUBLISHER_AGREEMENT_TITLE,
  PUBLISHER_AGREEMENT_VERSION,
  publisherAgreementPresentation,
  publisherAgreementState,
} from '@aglyn/aglyn/app-utils/publisher-agreement'
import { useRouter } from 'next/navigation'
import { collection, doc, query, updateDoc, where } from 'firebase/firestore'
import { type ReactElement, useCallback, useEffect, useState } from 'react'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import { buildRoute, Route } from '../constants/route-links'
import { docsHelp } from '../constants/docs-links'
import { useOrgSlug } from '../hooks/use-org-scope'
import useFirestoreCollection from '../hooks/use-firestore-collection'
import useFirestoreDoc from '../hooks/use-firestore-doc'
import EditListingDialog from './marketplace/edit-listing-dialog.component'
import MediaPickerDialog from './media/media-picker-dialog.component'
import mediaSrc from '../utils/media-src'
import { payoutReadiness } from '../utils/payout-readiness'
import {
  summarizeSellerLedger,
  type SellerLedgerSale,
} from '../utils/seller-ledger-totals'

const HANDLE_PATTERN = /^[a-z0-9][a-z0-9-]{2,29}$/

export type OrgSellerSection = 'profile' | 'listings' | 'payouts' | 'sales'

export interface OrgSellerPanelProps {
  orgId: string
  /** Which seller card to render — one per Marketplace › seller tab. */
  section: OrgSellerSection
}

/**
 * Seller area (AGL-44/798/801): the org's marketplace identity and its
 * published listings, folded out of the retired `/[orgSlug]/marketplace` page.
 * Each section (profile, listings, payouts, sales) is its own Marketplace tab
 * (AGL-801), so this renders exactly one card per the `section` prop. The
 * shared Firestore hooks run regardless of section — Firebase dedupes
 * identical listeners, and the marketplace HubTabs mounts tabs lazily, so only
 * the visited sections ever subscribe.
 */
export function OrgSellerPanel(props: OrgSellerPanelProps) {
  const { orgId, section } = props
  const orgSlug = useOrgSlug()
  const router = useRouter()
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  /** Bumped by Retry to re-subscribe the publisher profile (AGL-1380). */
  const [profileRetryNonce, setProfileRetryNonce] = useState(0)
  const { data: profile, status: profileStatus } = useFirestoreDoc<any>(
    // The org's marketplace identity (AGL-652), not the personal one. Held
    // at null rather than addressed as `publisherProfiles/-none-`: that
    // sentinel issued a guaranteed-denied read, and a denial now lands in
    // `status: 'error'`, which means something.
    () => (orgId ? doc(firestore, 'publisherProfiles', orgId) : null),
    [firestore, orgId, profileRetryNonce],
    { idField: '$id' },
  )
  /**
   * Three outcomes, not two (AGL-1380). An absent publisher profile is the
   * value BEFORE an answer as much as it is the value of a publisher who
   * never connected Stripe, so reading payout state off `stripeChargesEnabled`
   * alone told a publisher already taking payouts to "Connect a Stripe
   * account" and offered them the setup button that starts onboarding again.
   */
  const payoutsState: 'pending' | 'error' | 'loaded' =
    !orgId || profileStatus === 'loading'
      ? 'pending'
      : profileStatus === 'error'
        ? 'error'
        : 'loaded'
  /**
   * TWO questions, not one (AGL-1997). This card said "Payouts are enabled"
   * off `stripeChargesEnabled` — whether Stripe will let the account take
   * MONEY — and never read `stripePayoutsEnabled`, whether the money can
   * LEAVE. The decision itself lives in `payoutReadiness` so each of its six
   * outcomes can be asserted without mounting this tree.
   */
  const readiness = payoutReadiness({
    state: payoutsState,
    chargesEnabled: profile?.stripeChargesEnabled,
    payoutsEnabled: profile?.stripePayoutsEnabled,
  })
  /** Stripe will let this account take money — three of the six outcomes. */
  const chargesEnabled =
    readiness === 'ready' || readiness === 'blocked' || readiness === 'unknown'
  // Both held at null while the org is unknown, like the profile above
  // (AGL-1440): AGL-1380 repaired the profile ref and left these two
  // `where`-clause siblings on the sentinel. The purchases query is the one
  // that matters — `marketplacePurchases` is buyer/seller-gated, and a
  // rules-shaped LIST is evaluated against the QUERY, so the sentinel was
  // denied wholesale and retried on the refusal cadence. The listings query
  // is public and merely wasted the round trip.
  const { data: listings } = useFirestoreCollection<any>(
    () =>
      orgId
        ? query(
            collection(firestore, 'marketplaceListings'),
            // Listings are org-owned (AGL-652): `profileId` is the org id,
            // not a uid — filtering by uid left this list permanently empty
            // (AGL-781).
            where('profileId', '==', orgId),
          )
        : null,
    [firestore, orgId],
    { idField: '$id' },
  )
  // Seller ledger (AGL-46): purchase records written by the Stripe webhook.
  const { data: sales } = useFirestoreCollection<any>(
    () =>
      orgId
        ? query(
            collection(firestore, 'marketplacePurchases'),
            // Sales belong to the ORG that published (AGL-652).
            where('sellerOrgId', '==', orgId),
          )
        : null,
    [firestore, orgId],
    { idField: '$id' },
  )
  // What the publisher was actually paid (AGL-2158) — see
  // `summarizeSellerLedger`, where the arithmetic and the reasoning live. This
  // card used to render `amountCents − feeCents` as "net", which is
  // `pretax + tax − fee`: the payout PLUS sales tax that was never the
  // publisher's, summed over refunded sales as well as live ones.
  const totals = summarizeSellerLedger(sales as SellerLedgerSale[] | undefined)

  const [payoutsBusy, setPayoutsBusy] = useState(false)
  const handlePayouts = useCallback(async () => {
    setPayoutsBusy(true)
    try {
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/marketplace/connect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        // The acting org from the URL (AGL-861) — never let the server guess
        // which of the user's orgs is being set up for payouts.
        body: JSON.stringify({ orgId }),
      })
      const payload = await response.json()
      if (response.status === 501) {
        return void enqueueSnackbar(
          'Payouts are not configured on this deployment',
          { variant: 'info', persist: false },
        )
      }
      if (!response.ok) {
        return void enqueueSnackbar(payload?.error ?? 'Payout setup failed', {
          variant: 'error',
          allowDuplicate: true,
        })
      }
      if (payload.chargesEnabled) {
        // Publisher-payout half of the same activation metric (AGL-1561),
        // gated on the transition for the same reason as the commerce card:
        // the connect handler is re-entrant and reports `true` on every
        // revisit. `chargesEnabled` is the pre-request state — the metric is
        // about CONNECTING (AGL-1997 split the two flags; payout readiness
        // can arrive days later and is not a second activation).
        if (!chargesEnabled) trackEvent('stripe_connected', {})
        // The same split the card renders (AGL-1997): the route answers both
        // flags, so the toast must not announce payouts off the charges one.
        return void enqueueSnackbar(
          payload.payoutsEnabled === false
            ? 'Connected — payouts are not released yet'
            : 'Payouts are enabled',
          {
            variant: payload.payoutsEnabled === false ? 'warning' : 'success',
            persist: false,
          },
        )
      }
      if (payload.url) window.location.assign(payload.url)
    } catch (error) {
      console.error(error)
      enqueueSnackbar('An error has occurred', {
        variant: 'error',
        allowDuplicate: true,
      })
    } finally {
      setPayoutsBusy(false)
    }
  }, [orgId, user, chargesEnabled, enqueueSnackbar])

  const [handle, setHandle] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [bio, setBio] = useState('')
  // Logo, support contact and social links (AGL-1009). `avatarUrl` and
  // `website` existed server-side already — they just had no form input and
  // no rendering, so they were dead fields until now.
  const [avatarUrl, setAvatarUrl] = useState('')
  const [website, setWebsite] = useState('')
  const [supportEmail, setSupportEmail] = useState('')
  const [supportUrl, setSupportUrl] = useState('')
  const [githubUrl, setGithubUrl] = useState('')
  const [xUrl, setXUrl] = useState('')
  const [linkedinUrl, setLinkedinUrl] = useState('')
  const [logoPickerOpen, setLogoPickerOpen] = useState(false)
  useEffect(() => {
    setHandle(profile?.handle ?? '')
    setDisplayName(profile?.displayName ?? '')
    setBio(profile?.bio ?? '')
    setAvatarUrl(profile?.avatarUrl ?? '')
    setWebsite(profile?.website ?? '')
    setSupportEmail(profile?.supportEmail ?? '')
    setSupportUrl(profile?.supportUrl ?? '')
    setGithubUrl(profile?.githubUrl ?? '')
    setXUrl(profile?.xUrl ?? '')
    setLinkedinUrl(profile?.linkedinUrl ?? '')
  }, [
    profile?.handle,
    profile?.displayName,
    profile?.bio,
    profile?.avatarUrl,
    profile?.website,
    profile?.supportEmail,
    profile?.supportUrl,
    profile?.githubUrl,
    profile?.xUrl,
    profile?.linkedinUrl,
  ])

  const validHandle = HANDLE_PATTERN.test(handle)

  const handleSave = useCallback(async () => {
    if (!orgId || !validHandle || !displayName.trim()) return
    try {
      // Server-owned (AGL-652): the handle must be claimed transactionally in
      // publisherHandles, which a client write cannot do — two orgs racing
      // for one handle would both succeed and one would silently lose its
      // marketplace URL. The rules reject a client handle write outright.
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/marketplace/publisher-profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({
          orgId,
          handle,
          displayName: displayName.trim(),
          bio: bio.trim(),
          // AGL-1009: validated server-side (https-only, fixed social
          // hosts) — an empty string explicitly clears the stored field.
          avatarUrl: avatarUrl.trim(),
          website: website.trim(),
          supportEmail: supportEmail.trim(),
          supportUrl: supportUrl.trim(),
          githubUrl: githubUrl.trim(),
          xUrl: xUrl.trim(),
          linkedinUrl: linkedinUrl.trim(),
        }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        return enqueueSnackbar(payload?.error ?? 'Could not save the profile', {
          variant: 'warning',
          persist: false,
        })
      }
      enqueueSnackbar('Profile saved', { variant: 'success', persist: false })
    } catch (error) {
      console.error(error)
      enqueueSnackbar('An error has occurred', {
        variant: 'error',
        allowDuplicate: true,
      })
    }
  }, [
    orgId,
    validHandle,
    handle,
    displayName,
    bio,
    avatarUrl,
    website,
    supportEmail,
    supportUrl,
    githubUrl,
    xUrl,
    linkedinUrl,
    user,
    enqueueSnackbar,
  ])

  // The publisher agreement (AGL-1077). `none` and `outdated` get different
  // copy on purpose: "you never agreed" and "the terms moved" are different
  // situations, and one message for both reads as a bug in whichever case it
  // does not describe.
  const agreementState = publisherAgreementState(profile?.publisherAgreement)
  // Whether the document can be read at all (AGL-1660). While it has no
  // published page there is no link to render and no acceptance to collect —
  // the summary below is a summary OF something, and without the something it
  // is just seven sentences we wrote.
  const agreementPresentation = publisherAgreementPresentation(agreementState)
  const acceptedOn = (() => {
    const at = profile?.publisherAgreement?.acceptedAt
    const date = at?.toDate?.()
    return date ? date.toLocaleDateString() : ''
  })()
  const [agreementBusy, setAgreementBusy] = useState(false)
  const handleAcceptAgreement = useCallback(async () => {
    if (!orgId) return
    setAgreementBusy(true)
    try {
      // Server-owned, like the handle: an acceptance the accepting party can
      // write itself is not evidence of anything, and the rules block the
      // field outright.
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/marketplace/publisher-profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({
          action: 'accept-agreement',
          orgId,
          // Echoed back so the server can refuse an acceptance of anything
          // other than the version in force — including one made against a
          // page left open across a change.
          version: PUBLISHER_AGREEMENT_VERSION,
        }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        return void enqueueSnackbar(
          payload?.error ?? 'Could not record the acceptance',
          { variant: 'warning', persist: false },
        )
      }
      enqueueSnackbar('Agreement accepted — you can publish now', {
        variant: 'success',
        persist: false,
      })
    } catch (error) {
      console.error(error)
      enqueueSnackbar('An error has occurred', {
        variant: 'error',
        allowDuplicate: true,
      })
    } finally {
      setAgreementBusy(false)
    }
  }, [orgId, user, enqueueSnackbar])

  // The listing open in the full editor (AGL-862), or null when closed.
  const [editListing, setEditListing] = useState<any | null>(null)
  // Per-row overflow menu (AGL-999): the anchor plus the row it belongs to,
  // so one <Menu> serves every row instead of one per listing.
  const [rowMenu, setRowMenu] = useState<{
    anchor: HTMLElement
    listing: any
  } | null>(null)
  const closeRowMenu = () => setRowMenu(null)
  const listingHref = (listing: any) =>
    buildRoute(Route.ORG_MARKETPLACE_LISTING, {
      orgSlug,
      listingId: listing.$id,
    })
  // Shipping a new version was invisible as a path (AGL-1008): the only door
  // was the generic publish form, which reads entirely like first-time
  // publishing, so updating looked like creating a second listing. Same
  // form, pre-bound to the listing.
  const newVersionHref = (listing: any) =>
    `${buildRoute(Route.ORG_MARKETPLACE_PUBLISH_PLUGIN, { orgSlug })}` +
    `?listing=${encodeURIComponent(listing.$id)}`

  // Private ⇄ public (AGL-968/994). Goes through the API rather than a client
  // write: making a listing public is gated on it actually carrying the docs
  // a stranger needs, and that check has to live somewhere a client can't
  // skip. No re-review either way — the bytes are unchanged.
  const [visibilityBusy, setVisibilityBusy] = useState('')
  const handleVisibility = useCallback(
    (listing: any) => async () => {
      const next = listing.visibility === 'private' ? 'public' : 'private'
      setVisibilityBusy(listing.$id)
      try {
        const idToken = await (user as any)?.getIdToken?.()
        const response = await fetch('/api/marketplace/publish-plugin', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
          },
          body: JSON.stringify({
            action: 'set-visibility',
            listingId: listing.$id,
            visibility: next,
          }),
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) {
          return void enqueueSnackbar(
            payload?.error ?? 'Visibility change failed',
            { variant: 'error', allowDuplicate: true },
          )
        }
        enqueueSnackbar(
          next === 'private'
            ? 'Now private — only your sites can install it'
            : 'Published to the marketplace',
          { variant: 'success', persist: false },
        )
      } catch (error) {
        console.error(error)
        enqueueSnackbar('An error has occurred', {
          variant: 'error',
          allowDuplicate: true,
        })
      } finally {
        setVisibilityBusy('')
      }
    },
    [user, enqueueSnackbar],
  )
  const handleUnpublish = useCallback(
    (listing: any) => async () => {
      try {
        await updateDoc(doc(firestore, 'marketplaceListings', listing.$id), {
          deletedAt: listing.deletedAt ? null : Timestamp.now(),
        })
        enqueueSnackbar(listing.deletedAt ? 'Republished' : 'Unpublished', {
          variant: 'success',
          persist: false,
        })
      } catch (error) {
        console.error(error)
        enqueueSnackbar('An error has occurred', {
          variant: 'error',
          allowDuplicate: true,
        })
      }
    },
    [firestore, enqueueSnackbar],
  )

  const cards: Record<OrgSellerSection, ReactElement> = {
    profile: (
      <Stack spacing={2}>
      <CardDisplay
        header={'Public profile'}
        help={docsHelp('publisherHandbook', {
          anchor: '#before-your-first-publish',
          excerpt:
            'Your public publisher identity — handle, name, and bio shown ' +
            'on everything you publish to the marketplace.',
        })}
        contentGutterX
        contentGutterY
      >
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            {'Shown on every component you publish to the marketplace. A ' +
              'profile is required before publishing.'}
          </Typography>
          <TextField
            label="Handle"
            value={handle}
            onChange={(event) => setHandle(event.target.value.toLowerCase())}
            size="small"
            error={Boolean(handle) && !validHandle}
            helperText={
              Boolean(handle) && !validHandle
                ? '3–30 chars: lowercase letters, digits, dashes'
                : ' '
            }
          />
          <TextField
            label="Display name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            size="small"
          />
          <TextField
            label="Bio"
            value={bio}
            onChange={(event) => setBio(event.target.value)}
            size="small"
            multiline
            minRows={2}
          />
          {/* Logo (AGL-1009): picked from the media library like every
              other image the console chooses — never a pasted URL. */}
          <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
            <Avatar
              src={avatarUrl || undefined}
              alt={displayName || 'Publisher logo'}
              sx={{ width: 56, height: 56 }}
              variant="rounded"
            >
              {(displayName || handle || '?').slice(0, 1).toUpperCase()}
            </Avatar>
            <Stack direction="row" spacing={1}>
              <Button size="small" onClick={() => setLogoPickerOpen(true)}>
                {avatarUrl ? 'Replace logo' : 'Choose logo from library'}
              </Button>
              {avatarUrl ? (
                <Button
                  size="small"
                  color="error"
                  onClick={() => setAvatarUrl('')}
                >
                  {'Remove'}
                </Button>
              ) : null}
            </Stack>
          </Stack>
          {/* Support contact (AGL-1009): buyers of a paid plugin need
              somewhere to go, and a reviewer needs it more. */}
          <TextField
            label="Support email"
            value={supportEmail}
            onChange={(event) => setSupportEmail(event.target.value)}
            size="small"
            type="email"
          />
          <TextField
            label="Support URL"
            value={supportUrl}
            onChange={(event) => setSupportUrl(event.target.value)}
            size="small"
            helperText="https:// only"
          />
          <TextField
            label="Website"
            value={website}
            onChange={(event) => setWebsite(event.target.value)}
            size="small"
            helperText="https:// only"
          />
          {/* Fixed social set (AGL-1009): the storefront renders these as
              icons, so it is a known trio rather than a free-form list. */}
          <TextField
            label="GitHub"
            value={githubUrl}
            onChange={(event) => setGithubUrl(event.target.value)}
            size="small"
            helperText="https://github.com/…"
          />
          <TextField
            label="X"
            value={xUrl}
            onChange={(event) => setXUrl(event.target.value)}
            size="small"
            helperText="https://x.com/…"
          />
          <TextField
            label="LinkedIn"
            value={linkedinUrl}
            onChange={(event) => setLinkedinUrl(event.target.value)}
            size="small"
            helperText="https://linkedin.com/…"
          />
          <MediaPickerDialog
            orgId={orgId}
            open={logoPickerOpen}
            onClose={() => setLogoPickerOpen(false)}
            onPick={(media) => {
              setLogoPickerOpen(false)
              const url = mediaSrc(media)
              if (url) setAvatarUrl(url)
            }}
          />
          <Button
            variant="contained"
            color="primary"
            disabled={!validHandle || !displayName.trim()}
            onClick={handleSave}
          >
            {'Save profile'}
          </Button>
        </Stack>
      </CardDisplay>

      {/* The publisher agreement (AGL-1077). Its own card, directly under
          the identity it belongs to, rather than a seventh checkbox on the
          publish form — an agreement accepted in the same breath as six
          per-bundle confirmations is an agreement nobody read. Publishing
          then simply requires it, so the first publish is where it STOPS
          you rather than where it hides. */}
      <CardDisplay
        header={PUBLISHER_AGREEMENT_TITLE}
        help={docsHelp('publisherHandbook', {
          anchor: '#the-publisher-agreement',
          excerpt:
            'The terms your organization publishes under — accepted once, ' +
            're-asked when they change.',
        })}
        contentGutterX
        contentGutterY
      >
        <Stack spacing={2}>
          {agreementState === 'current' ? (
            <Alert severity="success">
              {`Accepted — version ${profile?.publisherAgreement?.version}` +
                (acceptedOn ? ` on ${acceptedOn}` : '')}
            </Alert>
          ) : null}
          {/* An unpublished document replaces the state copy rather than
              sitting beside it (AGL-1660): "you have not accepted these
              terms" reads as something the publisher failed to do, and while
              there is no page to read, the omission is entirely ours. */}
          {agreementPresentation.unavailableNotice ? (
            <Alert severity="warning">
              {agreementPresentation.unavailableNotice}
            </Alert>
          ) : agreementState === 'current' ? null : (
            <Alert severity={agreementState === 'outdated' ? 'warning' : 'info'}>
              {agreementState === 'outdated'
                ? 'These terms have changed since your organization accepted ' +
                  `them (you accepted ${profile?.publisherAgreement?.version}). ` +
                  'Publishing is paused until someone who can bind the ' +
                  'organization accepts the current version.'
                : 'Your organization has not accepted these terms. You can ' +
                  'set up a profile without them, but you cannot publish.'}
            </Alert>
          )}
          <Typography variant="body2" color="text.secondary">
            {'In summary — this is not the agreement, it is what tends to ' +
              'surprise people later:'}
          </Typography>
          <Stack spacing={1}>
            {PUBLISHER_AGREEMENT_POINTS.map((point) => (
              <Stack key={point.id} spacing={0.25}>
                <Typography variant="body2">{point.label}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {point.detail}
                </Typography>
              </Stack>
            ))}
          </Stack>
          {/* The href comes from the presentation helper, never from the
              constant: while the document is unpublished the helper hands back
              null and there is nothing here to click. That is the point — a
              link to a 404 above an Accept button is how a publisher ends up
              having "read" a document that was never served. */}
          {agreementPresentation.documentUrl ? (
            <Typography variant="body2">
              <Link
                href={agreementPresentation.documentUrl}
                target="_blank"
                rel="noopener noreferrer"
                underline="always"
              >
                {`Read the full ${PUBLISHER_AGREEMENT_TITLE}`}
              </Link>
              {` (version ${PUBLISHER_AGREEMENT_VERSION})`}
            </Typography>
          ) : (
            <Typography variant="body2" color="text.secondary">
              {`Version ${PUBLISHER_AGREEMENT_VERSION} has no published page ` +
                'yet, so there is no full text to link to.'}
            </Typography>
          )}
          {agreementPresentation.canAccept ? (
            <Button
              variant="contained"
              color="primary"
              disabled={agreementBusy}
              onClick={() => void handleAcceptAgreement()}
              sx={{ alignSelf: 'flex-start' }}
            >
              {agreementBusy
                ? 'Recording…'
                : agreementState === 'outdated'
                  ? 'Accept the current version'
                  : 'Accept on behalf of this organization'}
            </Button>
          ) : null}
          {agreementPresentation.canAccept ? (
            <Typography variant="caption" color="text.secondary">
              {'Accepting binds the organization, not you personally — only ' +
                'an owner or admin can do it, and we record who did and when.'}
            </Typography>
          ) : null}
        </Stack>
      </CardDisplay>
      </Stack>
    ),
    listings: (
      <CardDisplay
        header={'Your listings'}
        help={docsHelp('publisherHandbook', {
          anchor: '#authoring-your-listing',
          excerpt:
            'Everything you have published, with preview images and ' +
            'per-listing unpublish/republish.',
        })}
        contentGutterX
        contentGutterY
      >
        {(listings ?? []).length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {'Publish a reusable component from a site’s Setup page to list ' +
              'it here.'}
          </Typography>
        ) : (
          <Stack spacing={1}>
            {/* Private plugins are invisible in Browse by design (AGL-993),
                which makes this the only door to them — say so, or a
                publisher looking for the one they just uploaded will hunt
                for it in the marketplace grid. */}
            {(listings ?? []).some(
              (listing: any) => listing.visibility === 'private',
            ) ? (
              <Typography variant="caption" color="text.secondary">
                {'Private plugins never appear in the marketplace — open one ' +
                  'with View to install it on your sites.'}
              </Typography>
            ) : null}
            {(listings ?? []).map((listing: any) => (
              <Stack
                key={listing.$id}
                direction="row"
                spacing={1}
                sx={{
                  alignItems: 'center',
                  // The whole row is the way in (AGL-999) — the name and its
                  // metadata are what you aim at, so they should behave like
                  // the link they read as.
                  borderRadius: 1,
                  mx: -1,
                  px: 1,
                  '&:hover': { bgcolor: 'action.hover' },
                }}
              >
                <Stack
                  onClick={() => router.push(listingHref(listing))}
                  sx={{
                    flex: 1,
                    minWidth: 0,
                    py: 0.75,
                    cursor: 'pointer',
                  }}
                >
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: 'center', minWidth: 0 }}
                  >
                    <Typography variant="body2" noWrap>
                      {listing.displayName}
                    </Typography>
                    {/* This tab is the ONLY place a private listing appears
                        (AGL-993 keeps it out of browse), so the row has to
                        say which of the two things it is. */}
                    {listing.visibility === 'private' ? (
                      <Chip size="small" variant="outlined" label="Private" />
                    ) : null}
                  </Stack>
                  <Typography variant="caption" color="text.secondary">
                    {`v${listing.latestVersion}` +
                      (Number(listing.priceUsd ?? 0) > 0
                        ? ` · $${listing.priceUsd}`
                        : ' · free') +
                      (listing.previewImageUrl ? ' · has preview' : '') +
                      (listing.deletedAt ? ' · unpublished' : '')}
                  </Typography>
                </Stack>
                {/* View what a buyer sees (AGL-988). The one action that
                    stays visible (AGL-999): every other row action is either
                    rare or destructive, and flattening them all out made the
                    columns jump between rows — the action count varies by
                    artifact type — while putting Unpublish at the end of the
                    row, the easiest place to hit by mistake. */}
                <AppLink href={listingHref(listing)}>
                  <Button size="small" color="primary" component="span">
                    {'View'}
                  </Button>
                </AppLink>
                <IconButton
                  size="small"
                  aria-label={`More actions for ${listing.displayName}`}
                  onClick={(event) =>
                    setRowMenu({
                      anchor: event.currentTarget,
                      listing,
                    })
                  }
                >
                  <MdiIcon path={mdiDotsVertical.path} fontSize="small" />
                </IconButton>
              </Stack>
            ))}
          </Stack>
        )}
        {/* One menu for every row (AGL-999) — the open row is state, not a
            mounted <Menu> per listing. */}
        <Menu
          anchorEl={rowMenu?.anchor ?? null}
          open={Boolean(rowMenu)}
          onClose={closeRowMenu}
        >
          {/* Plugins only: bytes are the thing being shipped, and only a
              plugin listing has a bundle (AGL-1008). */}
          {(rowMenu?.listing?.artifactType ?? rowMenu?.listing?.type) ===
          'plugin' ? (
            <MenuItem
              onClick={() => {
                const listing = rowMenu?.listing
                closeRowMenu()
                if (listing) router.push(newVersionHref(listing))
              }}
            >
              {'Publish new version…'}
            </MenuItem>
          ) : null}
          <MenuItem
            onClick={() => {
              setEditListing(rowMenu?.listing ?? null)
              closeRowMenu()
            }}
          >
            {'Edit listing'}
          </MenuItem>
          {/* Plugins only (AGL-994). `visibility` is enforced in
              `install-plugin`; the component/layout/template install routes
              have no such check, so offering the switch there would promise
              a boundary that does not exist. */}
          {(rowMenu?.listing?.artifactType ?? rowMenu?.listing?.type) ===
          'plugin' ? (
            <MenuItem
              disabled={visibilityBusy === rowMenu?.listing?.$id}
              onClick={() => {
                const listing = rowMenu?.listing
                closeRowMenu()
                if (listing) void handleVisibility(listing)()
              }}
            >
              {rowMenu?.listing?.visibility === 'private'
                ? 'Make public…'
                : 'Make private'}
            </MenuItem>
          ) : null}
          <Divider />
          <MenuItem
            sx={{
              color: rowMenu?.listing?.deletedAt ? undefined : 'error.main',
            }}
            onClick={() => {
              const listing = rowMenu?.listing
              closeRowMenu()
              if (listing) void handleUnpublish(listing)()
            }}
          >
            {rowMenu?.listing?.deletedAt ? 'Republish' : 'Unpublish'}
          </MenuItem>
        </Menu>
        <EditListingDialog
          orgId={orgId}
          listing={editListing}
          open={Boolean(editListing)}
          onClose={() => setEditListing(null)}
          user={user}
        />
      </CardDisplay>
    ),
    payouts: (
      <CardDisplay
        header={'Payouts'}
        help={docsHelp('publisherHandbook', {
          anchor: '#getting-paid',
          excerpt:
            'Connect Stripe to receive payouts for paid listings. Platform ' +
            'fee: 20% per sale, 30% on the Free plan.',
        })}
        contentGutterX
        contentGutterY
      >
        <Stack spacing={2}>
          {payoutsState === 'error' ? (
            // Neither sentence is safe here: "Payouts are enabled" and
            // "Connect a Stripe account" both state a payout arrangement we
            // failed to read, and the button under them acts on it.
            <Alert
              severity="error"
              action={
                <Button
                  color="inherit"
                  size="small"
                  onClick={() => setProfileRetryNonce((n) => n + 1)}
                >
                  {'Retry'}
                </Button>
              }
            >
              {'We couldn’t load your payout setup. This says nothing about ' +
                'whether payouts are on — nothing has changed.'}
            </Alert>
          ) : payoutsState === 'pending' ? (
            <Typography variant="body2" color="text.secondary">
              {'Checking your payout setup…'}
            </Typography>
          ) : (
            <>
              {/* The charges-yes/payouts-no state (AGL-1997), which used to
                  render as unqualified success. Stripe will let this account
                  take money and will not let it out yet, so the honest thing
                  is to say both halves — a publisher who reads "enabled" and
                  sells has no reason to go finish verification. */}
              {readiness === 'blocked' ? (
                <Alert severity="warning">
                  {'Your Stripe account can take payments, but payouts are ' +
                    'not enabled yet — sales would stay in Stripe rather ' +
                    'than reaching your bank. Finish verification in Stripe ' +
                    'to release them.'}
                </Alert>
              ) : null}
              <Typography variant="body2" color="text.secondary">
                {readiness === 'ready'
                  ? 'Payouts are enabled — paid listings transfer to your ' +
                    'Stripe account automatically (platform fee 20%, 30% on ' +
                    'the Free plan).'
                  : readiness === 'unknown'
                    ? // Connected, payout readiness unread. Says only what is
                      // known, like the error branch above.
                      'Your Stripe account is connected. We haven’t checked ' +
                      'whether payouts are released yet — recheck to ' +
                      'confirm. The platform fee is 20% per sale (30% on ' +
                      'the Free plan).'
                    : readiness === 'blocked'
                      ? 'The platform fee is 20% per sale (30% on the Free ' +
                        'plan).'
                      : 'Connect a Stripe account to sell components. The ' +
                        'platform fee is 20% per sale (30% on the Free plan).'}
              </Typography>
              <Button
                variant={chargesEnabled ? 'outlined' : 'contained'}
                color="primary"
                disabled={payoutsBusy}
                onClick={handlePayouts}
              >
                {payoutsBusy
                  ? 'Opening Stripe…'
                  : readiness === 'ready'
                    ? 'Payouts enabled — recheck status'
                    : readiness === 'blocked'
                      ? 'Finish payout setup in Stripe'
                      : readiness === 'unknown'
                        ? 'Recheck payout status'
                        : 'Set up payouts'}
              </Button>
            </>
          )}
        </Stack>
      </CardDisplay>
    ),
    sales: (
      <CardDisplay
        header={'Sales'}
        help={docsHelp('publishAPlugin', {
          anchor: '#paid-listings',
          excerpt:
            'Net paid out is your share after the platform fee — sales tax ' +
            'is collected on Aglyn’s registration and is never yours.',
        })}
        contentGutterX
        contentGutterY
      >
        {(sales ?? []).length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {'No sales yet. Paid listings appear here with what buyers paid ' +
              'and what was paid out to you.'}
          </Typography>
        ) : (
          <Stack spacing={0.5}>
            <Typography variant="body2">
              {`${totals.paidCount} sale${totals.paidCount === 1 ? '' : 's'}`}
              {totals.refundedCount > 0
                ? ` · ${totals.refundedCount} refunded or charged back`
                : ''}
            </Typography>
            {/*
              The payout FIRST, and named for what it is. It is the number a
              publisher reconciles against their Stripe account, and it is the
              one this card used to get wrong.
            */}
            <Typography variant="body2">
              {`Net paid out $${(totals.netPaidCents / 100).toFixed(2)}`}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {`Buyers paid $${(totals.buyersPaidCents / 100).toFixed(2)} · ` +
                `sales tax $${(totals.salesTaxCents / 100).toFixed(2)} · ` +
                `platform fee $${(totals.platformFeeCents / 100).toFixed(2)}`}
            </Typography>
            {totals.refundedCount > 0 ? (
              <Typography variant="body2" color="text.secondary">
                {`$${(totals.returnedCents / 100).toFixed(2)} returned on refunded ` +
                  'and charged-back sales, and excluded above'}
              </Typography>
            ) : null}
            {/*
              THE COPY THAT LANDS WITH THE SMALLER NUMBER. A publisher who
              read `net $88.25` yesterday and reads `net paid out $80.00`
              today is owed the reason on the same card, not in a changelog.
            */}
            <Typography variant="caption" color="text.secondary">
              {'Net paid out is what reached your Stripe account: the ' +
                'pre-tax price less the platform fee. Sales tax is collected ' +
                'and remitted by Aglyn under its marketplace-provider ' +
                'registration and was never part of your share.'}
            </Typography>
          </Stack>
        )}
      </CardDisplay>
    ),
  }

  return cards[section]
}
OrgSellerPanel.displayName = 'OrgSellerPanel'

export default OrgSellerPanel
