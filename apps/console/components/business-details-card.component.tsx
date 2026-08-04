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

import { describeHostTokens } from '@aglyn/aglyn/app-utils/host-tokens'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useHost } from '@aglyn/tenant-feature-instance'
import {
  Box,
  Button,
  Chip,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { useEffect, useMemo, useState } from 'react'

interface SocialLink {
  label: string
  url: string
}

const MAX_LINKS = 8

/**
 * Business contact details, and what they fill in (AGL-1022).
 *
 * These three fields exist because `host.*` tokens need somewhere to read
 * from. A publisher's email template says "write to {{host.supportEmail}}"; if
 * nothing on the site can set that, the token resolves to its empty behaviour
 * forever and the feature teaches people it does not work.
 *
 * The card shows every registered token beside its resolved value rather than
 * listing field names, because the question an author actually has is "what
 * will this produce on MY site" — and a token showing "not set" here is a
 * to-do, not a mystery.
 */
export function BusinessDetailsCard(props: { hostId: string }) {
  const { hostId } = props
  const {
    doc: { data },
    setDoc,
  } = useHost({ hostId })
  const { enqueueSnackbar } = useSnackbar()
  const [saving, setSaving] = useState(false)

  const stored = (data as any)?.business
  const [supportEmail, setSupportEmail] = useState('')
  const [address, setAddress] = useState('')
  const [links, setLinks] = useState<SocialLink[]>([])

  /**
   * Seeded from the document once it arrives, and re-seeded whenever the
   * stored value actually changes.
   *
   * Compared by CONTENT: `useHost` hands back a new object on every snapshot,
   * so an identity check would wipe whatever is half-typed each time anything
   * else on the host document is written. This is the same shape the theme
   * editor needed in AGL-1021, for the same reason.
   */
  const storedKey = useMemo(() => JSON.stringify(stored ?? {}), [stored])
  useEffect(() => {
    const next = stored ?? {}
    setSupportEmail(String(next.supportEmail ?? ''))
    setAddress(String(next.address ?? ''))
    setLinks(
      (Array.isArray(next.socialLinks) ? next.socialLinks : []).map(
        (link: any) => ({
          label: String(link?.label ?? ''),
          url: String(link?.url ?? ''),
        }),
      ),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storedKey])

  const save = async () => {
    setSaving(true)
    try {
      await setDoc(
        {
          business: {
            supportEmail: supportEmail.trim(),
            address: address.trim(),
            // A link with no URL is not a link. Dropping them on save keeps
            // the stored shape clean rather than making every reader defend
            // against half-filled rows.
            socialLinks: links
              .filter((link) => link.url.trim())
              .map((link) => ({
                label: link.label.trim(),
                url: link.url.trim(),
              })),
          },
        },
        // `mergeFields` and not `merge: true`: Firestore deep-merges maps, so
        // merging would union the new social links with the old ones and make
        // removing one impossible through the button that says Save.
        { mergeFields: ['business'] },
      )
      enqueueSnackbar('Business details saved.', {
        variant: 'success',
        persist: false,
      })
    } catch (error) {
      console.error(error)
      enqueueSnackbar('Could not save business details', {
        variant: 'error',
        allowDuplicate: true,
      })
    } finally {
      setSaving(false)
    }
  }

  // Resolved against what is on screen, not what is saved, so the preview
  // answers "what would this produce" while you are still deciding.
  const preview = useMemo(
    () =>
      describeHostTokens({
        ...(data as any),
        business: {
          supportEmail: supportEmail.trim(),
          address: address.trim(),
          socialLinks: links.filter((link) => link.url.trim()),
        },
      }),
    [data, supportEmail, address, links],
  )

  return (
    <CardDisplay
      header={'Business details'}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          {'Used to fill in templates that reference this site — an installed ' +
            'email or page can say “write to us” without anyone typing your ' +
            'address into it.'}
        </Typography>

        <TextField
          size="small"
          label="Support email"
          type="email"
          value={supportEmail}
          onChange={(event) => setSupportEmail(event.target.value)}
          helperText="Where visitors should write for help."
        />
        <TextField
          size="small"
          label="Postal address"
          multiline
          minRows={2}
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          helperText="Shown as one block of text."
        />

        <Box>
          <Typography variant="subtitle2" gutterBottom>
            {'Social links'}
          </Typography>
          <Stack spacing={1}>
            {links.map((link, index) => (
              <Stack key={index} direction="row" spacing={1}>
                <TextField
                  size="small"
                  label="Label"
                  value={link.label}
                  sx={{ width: 160 }}
                  onChange={(event) =>
                    setLinks((current) =>
                      current.map((entry, position) =>
                        position === index
                          ? { ...entry, label: event.target.value }
                          : entry,
                      ),
                    )
                  }
                />
                <TextField
                  size="small"
                  label="URL"
                  fullWidth
                  value={link.url}
                  onChange={(event) =>
                    setLinks((current) =>
                      current.map((entry, position) =>
                        position === index
                          ? { ...entry, url: event.target.value }
                          : entry,
                      ),
                    )
                  }
                />
                <Tooltip title="Remove">
                  <IconButton
                    size="small"
                    onClick={() =>
                      setLinks((current) =>
                        current.filter((_, position) => position !== index),
                      )
                    }
                  >
                    {'×'}
                  </IconButton>
                </Tooltip>
              </Stack>
            ))}
            <Box>
              <Button
                size="small"
                disabled={links.length >= MAX_LINKS}
                onClick={() =>
                  setLinks((current) => [...current, { label: '', url: '' }])
                }
              >
                {'Add a link'}
              </Button>
            </Box>
          </Stack>
        </Box>

        <Box>
          <Typography variant="subtitle2" gutterBottom>
            {'What templates can reference'}
          </Typography>
          <Stack spacing={0.5}>
            {preview.map((token) => (
              <Stack
                key={token.key}
                direction="row"
                spacing={1}
                sx={{ alignItems: 'center', flexWrap: 'wrap' }}
              >
                <Chip
                  size="small"
                  variant="outlined"
                  label={token.token}
                  sx={{ fontFamily: 'monospace' }}
                />
                <Typography
                  variant="body2"
                  color={token.set ? 'text.primary' : 'text.secondary'}
                  sx={{ wordBreak: 'break-all' }}
                >
                  {token.set ? token.value : 'not set on this site'}
                </Typography>
              </Stack>
            ))}
          </Stack>
        </Box>

        <Box>
          <Button variant="contained" disabled={saving} onClick={() => void save()}>
            {'Save'}
          </Button>
        </Box>
      </Stack>
    </CardDisplay>
  )
}

export default BusinessDetailsCard
