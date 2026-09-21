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

import { PageHeaderHelp, PageHeaderRecord } from '@aglyn/aglyn'
import { Alert, Stack } from '@mui/material'
import { doc } from 'firebase/firestore'
import { useSearchParams } from 'next/navigation'
import { useFirestore, useFirestoreDoc } from '@aglyn/tenant-feature-instance'
import PublishPluginForm from './publish-plugin-form.component'

/**
 * Publish a plugin (AGL-1078), at `{marketplace}/publish/plugin`.
 *
 * This was `UploadPluginDialog`, a modal with no URL, no draft and no room.
 * The address exists so a publish can be linked, reloaded, and reached from a
 * listing pre-bound to it with `?listing=` (AGL-1008) — an update is this
 * same form with a listing already chosen.
 *
 * It was a console route until AGL-3080 and is now a page of the marketplace
 * hub's own subtree. The chrome it used to build itself — the trail, the
 * heading, the help `?` — is published upward instead, which is what lets the
 * shell own one layout for every plugin surface.
 */
export function PublishPluginPage(props: {
  orgId: string
  basePath: string
  /**
   * The reader's org permissions, and whether they have settled. Both, never
   * just the map: it fails OPEN and answers as an ADMIN's until the member
   * read lands, so reading it early renders the form for someone who cannot
   * publish and lets them get as far as a 403.
   */
  permissions?: Record<string, boolean | undefined>
  permissionsLoaded: boolean
}) {
  const { orgId, basePath, permissions, permissionsLoaded } = props
  const firestore = useFirestore()

  // `?listing=` binds this to an existing listing (AGL-1008) — the same form,
  // shipping a new version rather than creating a listing. The server still
  // decides which it is, from profileId plus the manifest id; this only
  // pre-fills what the publisher already owns and lets the page say what is
  // about to happen.
  const searchParams = useSearchParams()
  const listingId = String(searchParams?.get('listing') ?? '')
  const { data: listing } = useFirestoreDoc<any>(
    () => doc(firestore, 'marketplaceListings', listingId || '-none-'),
    [firestore, listingId],
    { idField: '$id' },
  )
  // The kill switch on that listing (AGL-2368). The form tells a publisher
  // which version "is what installs today", and it read the review-verdict
  // mirror to say so — which revocation does not clear, so a publisher whose
  // live version had been stopped was told it was still serving customers.
  const { data: revocation } = useFirestoreDoc<any>(
    () => (listingId ? doc(firestore, 'revocations', listingId) : null),
    [firestore, listingId],
  )

  // Only bind to a listing this org actually publishes. Otherwise a guessed
  // id would pre-fill someone else's listing content into this form.
  const target =
    listingId && listing?.profileId && listing.profileId === orgId
      ? listing
      : null

  const allowed = permissionsLoaded && permissions?.['publishToMarketplace'] === true

  return (
    <>
      {/*
        The heading and the last crumb, which the surface's own declaration
        cannot supply: "Publish a plugin" and "New version of X" are different
        pages at one address, and which one you are on depends on a listing
        this page reads.
      */}
      <PageHeaderRecord
        title={
          target
            ? `New version of ${target.displayName ?? 'your plugin'}`
            : 'Publish a plugin'
        }
      />
      <PageHeaderHelp topic="publisherHandbook" anchor="#publishing-a-version" />
      {!permissionsLoaded ? null : !allowed ? (
        <Stack spacing={2}>
          <Alert severity="info">
            {'Your organization role does not allow publishing to the ' +
              'marketplace.'}
          </Alert>
        </Stack>
      ) : orgId && (!listingId || listing !== undefined) ? (
        <PublishPluginForm
          orgId={orgId}
          basePath={basePath}
          listing={target}
          revocation={revocation ?? null}
        />
      ) : null}
    </>
  )
}

PublishPluginPage.displayName = 'PublishPluginPage'

export default PublishPluginPage
