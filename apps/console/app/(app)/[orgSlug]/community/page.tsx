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

import { ICON_VARIANT_APP_SETTINGS } from '@aglyn/shared-data-enums'
import { CardDisplay, Container } from '@aglyn/shared-ui-jsx'
import HubTabs from '../../../../components/hub-tabs.component'
import OrgPluginInstallsCard from '../../../../components/org-plugin-installs-card.component'
import { NextPageTitle } from '@aglyn/shared-ui-next/contexts/next-page-title-provider'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Timestamp } from '@aglyn/shared-util-timestamp'
import { Button, Stack, TextField, Typography } from '@mui/material'
import {
  collection,
  doc,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'
import {
  type ChangeEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import AuthenticatedLayout from '../../../../components/layouts/authenticated.layout'
import DashboardLayout from '../../../../components/layouts/dashboard.layout'
import MainLayout from '../../../../components/layouts/main.layout'
import { docsHelp } from '../../../../constants/docs-links'
import { buildRoute, Route } from '../../../../constants/route-links'
import useOrgNavTabItems from '../../../../hooks/use-org-nav-tabs'
import { useOrgScope, useOrgSlug } from '../../../../hooks/use-org-scope'
import { CONTENT_MAX_WIDTH } from '../../../../constants/shared'
import useFirestoreCollection from '../../../../hooks/use-firestore-collection'
import useFirestoreDoc from '../../../../hooks/use-firestore-doc'

const HANDLE_PATTERN = /^[a-z0-9][a-z0-9-]{2,29}$/

/**
 * Publisher settings (AGL-44): the tenant's public community profile
 * (required before publishing) and their published listings with an
 * explicit unpublish. Handle format mirrors the Firestore rule.
 */
const CommunitySettings: NextPageWithLayout<Record<string, never>> = () => {
  const orgNavTabs = useOrgNavTabItems()
  const orgSlug = useOrgSlug()
  const { currentOrg } = useOrgScope()
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const uid = user?.uid
  const { data: profile } = useFirestoreDoc<any>(
    // The org's marketplace identity (AGL-652), not the personal one.
    () => doc(firestore, 'publisherProfiles', currentOrg?.$id ?? '-none-'),
    [firestore, uid],
    { idField: '$id' },
  )
  const { data: listings } = useFirestoreCollection<any>(
    () =>
      query(
        collection(firestore, 'communityListings'),
        where('profileId', '==', uid ?? '-anonymous-'),
      ),
    [firestore, uid],
    { idField: '$id' },
  )
  // Seller ledger (AGL-46): purchase records written by the Stripe webhook.
  const { data: sales } = useFirestoreCollection<any>(
    () =>
      query(
        collection(firestore, 'communityPurchases'),
        // Sales belong to the ORG that published (AGL-652).
        where('sellerOrgId', '==', currentOrg?.$id ?? '-none-'),
      ),
    [firestore, uid],
    { idField: '$id' },
  )
  const grossCents = (sales ?? []).reduce(
    (sum: number, sale: any) => sum + (sale.amountCents ?? 0),
    0,
  )
  const feeCents = (sales ?? []).reduce(
    (sum: number, sale: any) => sum + (sale.feeCents ?? 0),
    0,
  )

  const [payoutsBusy, setPayoutsBusy] = useState(false)
  const handlePayouts = useCallback(async () => {
    setPayoutsBusy(true)
    try {
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/community/connect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
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
        return void enqueueSnackbar('Payouts are enabled', {
          variant: 'success',
          persist: false,
        })
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
  }, [user, enqueueSnackbar])

  const [handle, setHandle] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [bio, setBio] = useState('')
  useEffect(() => {
    setHandle(profile?.handle ?? '')
    setDisplayName(profile?.displayName ?? '')
    setBio(profile?.bio ?? '')
  }, [profile?.handle, profile?.displayName, profile?.bio])

  const validHandle = HANDLE_PATTERN.test(handle)

  const handleSave = useCallback(async () => {
    if (!currentOrg?.$id || !validHandle || !displayName.trim()) return
    try {
      // Server-owned (AGL-652): the handle must be claimed transactionally in
      // publisherHandles, which a client write cannot do — two orgs racing
      // for one handle would both succeed and one would silently lose its
      // marketplace URL. The rules reject a client handle write outright.
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/community/publisher-profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({
          orgId: currentOrg.$id,
          handle,
          displayName: displayName.trim(),
          bio: bio.trim(),
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
    currentOrg?.$id,
    validHandle,
    handle,
    displayName,
    bio,
    user,
    enqueueSnackbar,
  ])

  // Listing preview image (AGL-95): one shared file input; the pending
  // listing id records which row opened the picker.
  const previewInputRef = useRef<HTMLInputElement>(null)
  const previewListingIdRef = useRef<string | null>(null)
  const handlePickPreview = useCallback(
    (listing: any) => () => {
      previewListingIdRef.current = listing.$id
      previewInputRef.current?.click()
    },
    [],
  )
  const handlePreviewFile = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      const listingId = previewListingIdRef.current
      event.target.value = ''
      if (!file || !listingId) return
      if (!file.type.startsWith('image/')) {
        return void enqueueSnackbar('Pick an image file', {
          variant: 'warning',
          persist: false,
        })
      }
      try {
        const buffer = await file.arrayBuffer()
        const data = btoa(
          Array.from(new Uint8Array(buffer), (byte) =>
            String.fromCharCode(byte),
          ).join(''),
        )
        const idToken = await (user as any)?.getIdToken?.()
        const response = await fetch('/api/community/preview-image', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
          },
          body: JSON.stringify({
            listingId,
            contentType: file.type,
            data,
          }),
        })
        const payload = await response.json()
        if (!response.ok) {
          return void enqueueSnackbar(payload?.error ?? 'Upload failed', {
            variant: 'error',
            allowDuplicate: true,
          })
        }
        enqueueSnackbar('Preview image saved', {
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
    [user, enqueueSnackbar],
  )

  const handleUnpublish = useCallback(
    (listing: any) => async () => {
      try {
        await updateDoc(doc(firestore, 'communityListings', listing.$id), {
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

  return (
    <>
      <NextPageTitle screen={'Community profile'} />
      <DashboardLayout
        navTabItems={orgNavTabs}
        breadcrumbItems={[
          {
            children: 'Community profile',
            href: buildRoute(Route.MANAGE_COMMUNITY_PROFILE, { orgSlug }),
          },
        ]}
        header={{
          children: 'Community profile',
          icon: { path: ICON_VARIANT_APP_SETTINGS.path },
        }}
      >
        <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
          <HubTabs
            tabs={[
              // Org-tier plugin inventory (AGL-263).
              ...(currentOrg?.$id
                ? [
                    {
                      id: 'plugins',
                      label: 'Plugins',
                      content: (
                        <OrgPluginInstallsCard orgId={currentOrg.$id} />
                      ),
                    },
                  ]
                : []),
              {
                id: 'profile',
                label: 'Public profile',
                content: (
                  <CardDisplay
                    header={'Public profile'}
                    help={docsHelp('publisherHandbook', {
                      anchor: '#before-your-first-publish',
                      excerpt:
                        'Your public publisher identity — handle, name, and ' +
                        'bio shown on everything you publish to the ' +
                        'marketplace.',
                    })}
                    contentGutterX
                    contentGutterY
                  >
                    <Stack spacing={2}>
                      <Typography variant="body2" color="text.secondary">
                        {'Shown on every component you publish to the ' +
                          'community. A profile is required before publishing.'}
                      </Typography>
                      <TextField
                        label="Handle"
                        value={handle}
                        onChange={(event) =>
                          setHandle(event.target.value.toLowerCase())
                        }
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
                        onChange={(event) =>
                          setDisplayName(event.target.value)
                        }
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
                      <Button
                        variant="contained"
                        color="secondary"
                        disabled={!validHandle || !displayName.trim()}
                        onClick={handleSave}
                      >
                        {'Save profile'}
                      </Button>
                    </Stack>
                  </CardDisplay>
                ),
              },
              {
                id: 'listings',
                label: 'Your listings',
                content: (
                  <CardDisplay
                    header={'Your listings'}
                    help={docsHelp('publisherHandbook', {
                      anchor: '#authoring-your-listing',
                      excerpt:
                        'Everything you have published, with preview images ' +
                        'and per-listing unpublish/republish.',
                    })}
                    contentGutterX
                    contentGutterY
                  >
                    {(listings ?? []).length === 0 ? (
                      <Typography variant="body2" color="text.secondary">
                        {'Publish a reusable component from a site’s ' +
                          'Setup page to list it here.'}
                      </Typography>
                    ) : (
                      <Stack spacing={1}>
                        <input
                          ref={previewInputRef}
                          type="file"
                          accept="image/*"
                          hidden
                          onChange={handlePreviewFile}
                        />
                        {(listings ?? []).map((listing: any) => (
                          <Stack
                            key={listing.$id}
                            direction="row"
                            spacing={1}
                            sx={{ alignItems: 'center' }}
                          >
                            <Stack sx={{ flex: 1, minWidth: 0 }}>
                              <Typography variant="body2" noWrap>
                                {listing.displayName}
                              </Typography>
                              <Typography
                                variant="caption"
                                color="text.secondary"
                              >
                                {`v${listing.latestVersion}` +
                                  (Number(listing.priceUsd ?? 0) > 0
                                    ? ` · $${listing.priceUsd}`
                                    : ' · free') +
                                  (listing.previewImageUrl
                                    ? ' · has preview'
                                    : '') +
                                  (listing.deletedAt ? ' · unpublished' : '')}
                              </Typography>
                            </Stack>
                            <Button
                              size="small"
                              color="secondary"
                              onClick={handlePickPreview(listing)}
                            >
                              {listing.previewImageUrl ? 'Replace' : 'Image'}
                            </Button>
                            <Button
                              size="small"
                              color={listing.deletedAt ? 'secondary' : 'error'}
                              onClick={handleUnpublish(listing)}
                            >
                              {listing.deletedAt ? 'Republish' : 'Unpublish'}
                            </Button>
                          </Stack>
                        ))}
                      </Stack>
                    )}
                  </CardDisplay>
                ),
              },
              {
                id: 'payouts',
                label: 'Payouts',
                content: (
                  <CardDisplay
                    header={'Payouts'}
                    help={docsHelp('publisherHandbook', {
                      anchor: '#getting-paid',
                      excerpt:
                        'Connect Stripe to receive payouts for paid ' +
                        'listings. Platform fee: 20% per sale, 30% on the ' +
                        'Free plan.',
                    })}
                    contentGutterX
                    contentGutterY
                  >
                    <Stack spacing={2}>
                      <Typography variant="body2" color="text.secondary">
                        {profile?.stripeChargesEnabled
                          ? 'Payouts are enabled — paid listings transfer to ' +
                            'your Stripe account automatically (platform ' +
                            'fee 20%, 30% on the Free plan).'
                          : 'Connect a Stripe account to sell components. ' +
                            'The platform fee is 20% per sale (30% on the ' +
                            'Free plan).'}
                      </Typography>
                      <Button
                        variant={
                          profile?.stripeChargesEnabled
                            ? 'outlined'
                            : 'contained'
                        }
                        color="secondary"
                        disabled={payoutsBusy}
                        onClick={handlePayouts}
                      >
                        {profile?.stripeChargesEnabled
                          ? 'Payouts enabled — recheck status'
                          : payoutsBusy
                            ? 'Opening Stripe…'
                            : 'Set up payouts'}
                      </Button>
                    </Stack>
                  </CardDisplay>
                ),
              },
              {
                id: 'sales',
                label: 'Sales',
                content: (
                  <CardDisplay
                    header={'Sales'}
                    help={docsHelp('publishAPlugin', {
                      anchor: '#paid-listings',
                      excerpt:
                        'Your sales ledger — gross, platform fee, and net ' +
                        'across every paid listing.',
                    })}
                    contentGutterX
                    contentGutterY
                  >
                    {(sales ?? []).length === 0 ? (
                      <Typography variant="body2" color="text.secondary">
                        {'No sales yet. Paid listings appear here with ' +
                          'gross, platform fee, and your net.'}
                      </Typography>
                    ) : (
                      <Stack spacing={0.5}>
                        <Typography variant="body2">
                          {`${(sales ?? []).length} sale${
                            (sales ?? []).length === 1 ? '' : 's'
                          }`}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {`Gross $${(grossCents / 100).toFixed(2)} · ` +
                            `platform fee $${(feeCents / 100).toFixed(2)} · ` +
                            `net $${((grossCents - feeCents) / 100).toFixed(2)}`}
                        </Typography>
                      </Stack>
                    )}
                  </CardDisplay>
                ),
              },
            ]}
          />
        </Container>
      </DashboardLayout>
    </>
  )
}
CommunitySettings.displayName = 'Page:CommunitySettings'

export default CommunitySettings
