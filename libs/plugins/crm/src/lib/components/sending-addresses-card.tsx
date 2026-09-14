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

import { pluginDocsHelp } from '@aglyn/aglyn'
import {
  MEMBER_EMAIL_ALIAS_CONFIRM_PARAM,
  MEMBER_EMAIL_ALIASES_MAX,
} from '@aglyn/aglyn/app-utils/member-email-aliases'
import { CardDisplay, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Box,
  Button,
  Chip,
  List,
  ListItem,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useEffect, useRef, useState } from 'react'
import { useMemberEmailAliases } from './use-member-email-aliases'

export interface SendingAddressesCardProps {
  /** The workspace the list is kept in, or `null` until the scope resolves. */
  orgId: string | null
  /** Whether the scope is known, so the list may be asked for. */
  ready: boolean
}

/** The one sentence that says what the list is for. */
export const SENDING_ADDRESSES_EXPLANATION =
  'Emails you send from these addresses and BCC to your capture address are filed under the person you wrote to.'

/** The state of an address whose confirmation email has gone out. */
export const VERIFICATION_SENT_LABEL = 'Verification email sent'

/** The state of an address the member has confirmed. */
export const VERIFIED_LABEL = 'Verified'

/**
 * "Your sending addresses" — the signed-in member's own addresses in this
 * workspace (AGL-2975), beside the Email capture card they are for.
 *
 * A member who sends outreach from an address they do not sign in with — a
 * Gmail send-as alias on an outbound domain — adds it here. It is sent a
 * verification email, and once the member opens that link while signed in
 * the address is theirs: a message from it copied to the capture address is
 * filed under the person it was written to, not under the alias. Until
 * then the address does nothing, which is why its state is printed on the
 * row rather than implied.
 *
 * The list is each member's own, so every member sees and edits only theirs,
 * under a site or at the organization level alike. The verification link
 * lands back on this page, and this card is what redeems it.
 */
export function SendingAddressesCard(props: SendingAddressesCardProps) {
  const { orgId, ready } = props
  const enabled = ready && Boolean(orgId)
  const aliases = useMemberEmailAliases(orgId, { enabled })
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const [draft, setDraft] = useState('')

  // The verification link, redeemed once. The token leaves the address bar
  // at once, so a copied or bookmarked URL does not carry it around.
  const redeemed = useRef(false)
  const confirmAddress = aliases.confirm
  useEffect(() => {
    if (!enabled || redeemed.current || typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const token = params.get(MEMBER_EMAIL_ALIAS_CONFIRM_PARAM)
    if (!token) return
    redeemed.current = true
    params.delete(MEMBER_EMAIL_ALIAS_CONFIRM_PARAM)
    const query = params.toString()
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`,
    )
    void confirmAddress(token).then((result) => {
      if (result.ok === false) {
        enqueueSnackbar(result.error, { variant: 'error', allowDuplicate: true })
        return
      }
      enqueueSnackbar(`${String(result.payload['address'] ?? 'Address')} verified`, {
        variant: 'success',
      })
    })
  }, [enabled, confirmAddress, enqueueSnackbar])

  const handleAdd = async () => {
    const address = draft.trim()
    if (!address) return
    const result = await aliases.add(address)
    if (result.ok === false) {
      enqueueSnackbar(result.error, { variant: 'error', allowDuplicate: true })
      return
    }
    setDraft('')
    enqueueSnackbar(VERIFICATION_SENT_LABEL, { variant: 'success' })
  }

  const handleResend = async (address: string) => {
    const result = await aliases.resend(address)
    if (result.ok === false) {
      enqueueSnackbar(result.error, { variant: 'error', allowDuplicate: true })
      return
    }
    enqueueSnackbar(VERIFICATION_SENT_LABEL, { variant: 'success' })
  }

  const handleRemove = async (address: string, verified: boolean) => {
    if (verified) {
      const confirmed = await confirm({
        title: `Remove ${address}?`,
        description:
          'Email you send from it stops being filed as yours. Adding it again ' +
          'sends a new verification email.',
        confirmationText: 'Remove',
        confirmationButtonProps: { color: 'error' },
      })
        .then(() => true)
        .catch(() => false)
      if (!confirmed) return
    }
    const result = await aliases.remove(address)
    if (result.ok === false) {
      enqueueSnackbar(result.error, { variant: 'error', allowDuplicate: true })
      return
    }
    enqueueSnackbar('Address removed', { variant: 'success', persist: false })
  }

  const atCap = aliases.aliases.length >= MEMBER_EMAIL_ALIASES_MAX
  const canEdit = enabled && aliases.status === 'ready' && !aliases.busy
  return (
    <CardDisplay
      header={'Your sending addresses'}
      help={pluginDocsHelp('crmSettings', { anchor: '#your-sending-addresses' })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={1.5} sx={{ maxWidth: 560 }}>
        <Typography variant="body2" color="text.secondary">
          {SENDING_ADDRESSES_EXPLANATION}
        </Typography>
        {aliases.signInEmail ? (
          <Typography variant="caption" color="text.secondary">
            {`You sign in as ${aliases.signInEmail}, which already counts as yours.`}
          </Typography>
        ) : null}
        {aliases.status === 'error' ? (
          <Typography variant="body2" color="error">
            {aliases.error}
          </Typography>
        ) : null}
        {aliases.aliases.length > 0 ? (
          <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
            <List dense disablePadding aria-label="Your sending addresses">
              {aliases.aliases.map((row) => (
                <ListItem
                  key={row.address}
                  divider
                  secondaryAction={
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                      {!row.verified ? (
                        <Button
                          size="small"
                          disabled={!canEdit}
                          aria-label={`Resend the verification email to ${row.address}`}
                          onClick={() => void handleResend(row.address)}
                        >
                          {'Resend'}
                        </Button>
                      ) : null}
                      <Button
                        size="small"
                        color="error"
                        disabled={!canEdit}
                        aria-label={`Remove ${row.address}`}
                        onClick={() => void handleRemove(row.address, row.verified)}
                      >
                        {'Remove'}
                      </Button>
                    </Stack>
                  }
                >
                  <ListItemText
                    primary={row.address}
                    secondary={
                      <Chip
                        size="small"
                        variant="outlined"
                        color={row.verified ? 'success' : 'warning'}
                        label={row.verified ? VERIFIED_LABEL : VERIFICATION_SENT_LABEL}
                        sx={{ mt: 0.5 }}
                      />
                    }
                    slotProps={{ secondary: { component: 'div' } }}
                  />
                </ListItem>
              ))}
            </List>
          </Box>
        ) : null}
        <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
          <TextField
            size="small"
            fullWidth
            type="email"
            label="Add an address you send from"
            value={draft}
            disabled={!canEdit || atCap}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void handleAdd()
            }}
            helperText={
              atCap
                ? `You can keep up to ${MEMBER_EMAIL_ALIASES_MAX} addresses.`
                : 'We email it a link. It counts once you open that link while signed in.'
            }
          />
          <Button
            variant="outlined"
            disabled={!canEdit || atCap || !draft.trim()}
            onClick={() => void handleAdd()}
            sx={{ mt: 0.25 }}
          >
            {'Add'}
          </Button>
        </Stack>
      </Stack>
    </CardDisplay>
  )
}
SendingAddressesCard.displayName = 'SendingAddressesCard'

export default SendingAddressesCard
