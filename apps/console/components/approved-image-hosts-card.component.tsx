'use client'
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

import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Box,
  Button,
  Chip,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { arrayRemove, arrayUnion, doc, updateDoc } from 'firebase/firestore'
import { useCallback, useMemo, useState } from 'react'
import { useFirestore } from '@aglyn/tenant-feature-instance'
// The SAME parse the tenant middleware builds the header from. Root-level
// CommonJS, outside the nx graph, because `next.config.js` must `require` it
// (AGL-523) — the console middleware imports it the same way.
// eslint-disable-next-line @nx/enforce-module-boundaries
import {
  APPROVED_IMAGE_HOSTS_MAX,
  normalizeApprovedImageHost,
} from '../../../security-origins'
import { docsHelp } from '../constants/docs-links'
import useFirestoreDoc from '../hooks/use-firestore-doc'

/**
 * Which `host` array this card edits. One directive per field, and the tenant
 * reads the same names off the verdict — a new one is added in BOTH places or
 * it is a control that stores a value nothing enforces.
 */
export type ApprovedHostsField =
  | 'approvedImageHosts'
  | 'approvedMediaHosts'
  | 'approvedFontHosts'
  | 'approvedFormActions'

export interface ApprovedHostsCardProps {
  hostId: string
  /** Defaults to images, which is what this card was before it was shared. */
  field?: ApprovedHostsField
  header?: string
  /** Sentence under the header: what this list governs, in the owner's terms. */
  description?: string
  /** Shown instead of the chip row when the list is empty. */
  emptyHint?: string
  /** Placeholder for the entry field; the validator is the same either way. */
  placeholder?: string
  /**
   * The privacy consequence of approving a host. Every one of these leaks the
   * visitor's IP to whoever is listed, because the BROWSER fetches directly —
   * the wording differs only in what is being fetched.
   */
  privacyNote?: string
}

export type ApprovedImageHostsCardProps = ApprovedHostsCardProps

/**
 * Which external hosts this site's images may come from (AGL-1152).
 *
 * ## Why the owner edits this and we do not
 *
 * The tenant's `img-src` used to be a platform-wide constant, and AGL-1726
 * refused to enforce it: pasting an external image URL is an ADVERTISED
 * authoring feature, so a first-party-only policy would silently revoke a
 * documented capability from every published site at once. Enforcement against
 * a list the OWNER chose revokes nothing — and this card is the half that makes
 * a refusal something they decided rather than something that happened to them.
 *
 * It is also the deploy-free rollback that issue asked for and did not have:
 * a write here propagates within the middleware's verdict TTL, no build.
 *
 * ## The validator is imported, never re-implemented
 *
 * The whole point of this card is to promise what the header will do. A second
 * copy of the hostname rules here is how the promise and the policy drift, and
 * the visible symptom would be an entry that looks accepted and never works.
 */
export function ApprovedImageHostsCard(props: ApprovedHostsCardProps) {
  const {
    hostId,
    field = 'approvedImageHosts',
    header = 'Approved image hosts',
    description = 'Images your pages load from somewhere other than this site. Your own uploads always work — this is only for images you point at by URL.',
    emptyHint = 'No external hosts approved. Pages can still show every image you upload here.',
    placeholder = 'cdn.example.com',
    privacyNote = 'Every host here can see the IP address of anyone who visits your site, because their browser fetches the image directly.',
  } = props
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)

  const { data: host } = useFirestoreDoc<{
    [key: string]: unknown
  }>(() => doc(firestore, 'hosts', hostId), [firestore, hostId], {
    idField: '$id',
  })

  const approved = useMemo(
    () => (Array.isArray(host?.[field]) ? (host[field] as string[]) : []),
    [host],
  )

  /**
   * What is wrong with the current draft, or null.
   *
   * Shown as the field's own error rather than on submit, because the failure
   * this prevents is a silent one: an entry that saves, looks present in the
   * list, and is dropped by the parse when the header is built.
   */
  const draftError = useMemo(() => {
    const value = draft.trim()
    if (!value) return null
    if (normalizeApprovedImageHost(value) === null) {
      return value.includes('://')
        ? 'Enter the host only, without https:// — for example cdn.example.com'
        : 'Not a valid host. Use a domain like cdn.example.com, or *.example.com to allow its subdomains.'
    }
    if (
      approved.some(
        (entry) => entry.trim().toLowerCase() === value.toLowerCase(),
      )
    ) {
      return 'Already approved.'
    }
    if (approved.length >= APPROVED_IMAGE_HOSTS_MAX) {
      return `A site can approve up to ${APPROVED_IMAGE_HOSTS_MAX} hosts.`
    }
    return null
  }, [draft, approved])

  const add = useCallback(async () => {
    const value = draft.trim().toLowerCase()
    if (!value || draftError) return
    setBusy(true)
    try {
      await updateDoc(doc(firestore, 'hosts', hostId), {
        [field]: arrayUnion(value),
      })
      setDraft('')
      enqueueSnackbar(`${value} approved`, {
        variant: 'success',
        persist: false,
      })
    } finally {
      setBusy(false)
    }
  }, [draft, draftError, firestore, hostId, enqueueSnackbar])

  const remove = useCallback(
    async (value: string) => {
      setBusy(true)
      try {
        await updateDoc(doc(firestore, 'hosts', hostId), {
          [field]: arrayRemove(value),
        })
        enqueueSnackbar(`${value} removed`, {
          variant: 'success',
          persist: false,
        })
      } finally {
        setBusy(false)
      }
    },
    [firestore, hostId, enqueueSnackbar],
  )

  return (
    <CardDisplay
      header={header}
      help={docsHelp('media', {
        title: header,
        excerpt:
          'Images loaded from another site are blocked unless you approve the host here. Your own uploads always work.',
        // The renamed tooltip has to open the SECTION, not the top of a page
        // about the media library generally (AGL-1918).
        // Every one of these cards points at the same docs section: there is
        // one page about approving hosts, and inventing per-directive anchors
        // that do not exist would open the docs at the top instead (AGL-1918).
        anchor: '#approved-image-hosts',
      })}
      contentGutterX
      contentGutterY
    >
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {description}
      </Typography>
      <Stack spacing={2}>
        {approved.length === 0 ? (
          <Alert severity="info">{emptyHint}</Alert>
        ) : (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {approved.map((entry) => (
              <Chip
                key={entry}
                label={entry}
                onDelete={busy ? undefined : () => remove(entry)}
                disabled={busy}
              />
            ))}
          </Box>
        )}
        <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
          <TextField
            size="small"
            fullWidth
            label="Add a host"
            placeholder={placeholder}
            value={draft}
            error={Boolean(draftError)}
            helperText={
              draftError ??
              'Use *.example.com to allow every subdomain of a host.'
            }
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void add()
              }
            }}
            disabled={busy}
          />
          <Button
            variant="contained"
            onClick={() => void add()}
            disabled={busy || !draft.trim() || Boolean(draftError)}
            sx={{ mt: 0.5 }}
          >
            {'Add'}
          </Button>
        </Stack>
        <Typography variant="caption" color="text.secondary">
          {privacyNote}
        </Typography>
      </Stack>
    </CardDisplay>
  )
}

export default ApprovedImageHostsCard
