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
import { LEGAL_REFERENCE_URLS } from '../constants/shared'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Box, Button, Link, Stack, Typography } from '@mui/material'
import type { User } from 'firebase/auth'
import { useCallback, useState } from 'react'
import { docsHelp } from '../constants/docs-links'

/**
 * "Download my data" / "Download this workspace's data" (AGL-1974).
 *
 * Privacy Policy §7 grants access and portability, and there was no path for
 * either. Six surfaces meanwhile told customers to export before deleting —
 * the settings Delete tab, the Close account card, `erase-org-cli.mjs`, the
 * staff org actions, live DPA §11 and Terms §13.3 — so six places instructed
 * somebody to do a thing the product could not do.
 *
 * One component for both subjects, because the difference between them is a
 * URL and some words. What must NOT be shared is the authorization, and it is
 * not: the person route takes its subject from the token, the org route
 * resolves membership for the org named in the query, and neither trusts this
 * component for anything.
 *
 * ## Why the fetch, rather than a link
 *
 * The routes are Bearer-authenticated, and an `<a href>` cannot carry a
 * header — a plain link would arrive unauthenticated and 401. So the token is
 * attached here and the response becomes an object URL. That also means a
 * failure can be reported in words instead of dropping the customer on a JSON
 * error page, which for a statutory right is the difference between "here is
 * what to do next" and "something went wrong".
 */
export interface DataExportCardProps {
  /** Signed-in user — the source of the Bearer token, never of the subject. */
  user: Pick<User, 'getIdToken'>
  /** Omit for a personal export; pass an org id for a workspace export. */
  orgId?: string
  /** Shown above the button; each subject explains a different scope. */
  description?: string
}

export function DataExportCard({ user, orgId, description }: DataExportCardProps) {
  const { enqueueSnackbar } = useSnackbar()
  const [busy, setBusy] = useState(false)

  const download = useCallback(async () => {
    setBusy(true)
    try {
      // `true` forces a refresh so `auth_time` is the one just refreshed
      // rather than a cached hour-old value — the route checks it.
      const idToken = await user.getIdToken(true)
      const url = orgId
        ? `/api/orgs/export-data?orgId=${encodeURIComponent(orgId)}`
        : '/api/account/export'
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${idToken}` },
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}) as any)
        enqueueSnackbar(
          payload?.error === 'reauth-required'
            ? 'Sign in again, then download your data.'
            : (payload?.message ??
              payload?.error ??
              'Preparing the export failed.'),
          { variant: 'warning', persist: false },
        )
        return
      }
      // The filename the server chose, so the file a customer files away and
      // the record we keep of producing it agree.
      const disposition = response.headers.get('Content-Disposition') ?? ''
      const named = /filename="([^"]+)"/.exec(disposition)?.[1]
      const blob = await response.blob()
      const objectUrl = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = objectUrl
      anchor.download = named ?? 'aglyn-data-export.json'
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      // Revoked, not leaked: the blob is the most personal payload the console
      // holds, and an object URL keeps it alive in the tab until it is
      // released.
      URL.revokeObjectURL(objectUrl)
      enqueueSnackbar('Your data is downloading.', {
        variant: 'success',
        persist: false,
      })
    } catch (error) {
      console.error(error)
      enqueueSnackbar('Preparing the export failed.', { variant: 'error' })
    } finally {
      setBusy(false)
    }
  }, [user, orgId, enqueueSnackbar])

  return (
    <CardDisplay
      header={orgId ? 'Download workspace data' : 'Download my data'}
      contentGutterX
      contentGutterY
      help={docsHelp('account', {
        anchor: '#downloading-your-data',
        excerpt:
          'Download a machine-readable copy of everything we hold — your ' +
          'profile, your memberships and your support messages, or your ' +
          'whole workspace.',
      })}
    >
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          {description ??
            (orgId
              ? 'A machine-readable JSON copy of everything this workspace ' +
                'holds — its sites and their content, datasets, contacts, ' +
                'orders, form submissions, members, support threads and ' +
                'billing identifiers. Owners and admins only.'
              : 'A machine-readable JSON copy of everything we hold about ' +
                'you — your profile, contact details, workspace memberships, ' +
                'passkeys, public handle and the support messages you wrote.')}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {orgId
            ? 'Passwords, API keys, webhook secrets and payment links are ' +
              'listed as present but never included — a copy of a credential ' +
              'in a downloaded file is a credential you can lose.'
            : 'It does not include your colleagues’ data, and it never ' +
              'includes secrets: an API key is reported as existing, never ' +
              'reproduced.'}
        </Typography>
        {orgId ? (
          /**
           * The contract documents, reachable from the product (AGL-2189).
           *
           * They are published pages and neither is acceptance-pinned, and
           * they were linked from nowhere in the console — so an enterprise
           * reviewer, the one audience that needs them, could not reach either
           * without emailing us, while the trust page told them to do exactly
           * that for documents already on a public URL.
           *
           * Here rather than in the clickwrap, deliberately: this card is the
           * data-handling surface, this export is the DPA §11 obligation it
           * implements, and a reviewer looking for processing terms is already
           * reading this screen. Putting them in the signup checkbox would
           * make them look like something to accept, which they are not.
           */
          <Typography variant="body2" color="text.secondary">
            {'Processing terms: '}
            <Link href={LEGAL_REFERENCE_URLS.DPA} target="_blank" rel="noopener noreferrer">
              {'Data Processing Addendum'}
            </Link>
            {' · '}
            <Link
              href={LEGAL_REFERENCE_URLS.SUBPROCESSORS}
              target="_blank"
              rel="noopener noreferrer"
            >
              {'Subprocessors'}
            </Link>
          </Typography>
        ) : null}
        <Box>
          <Button
            variant="outlined"
            disabled={busy}
            onClick={() => void download()}
          >
            {busy
              ? 'Preparing…'
              : orgId
                ? 'Download workspace data'
                : 'Download my data'}
          </Button>
        </Box>
      </Stack>
    </CardDisplay>
  )
}

export default DataExportCard
