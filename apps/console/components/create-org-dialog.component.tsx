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

import { trackEventBeforeNavigation } from '@aglyn/aglyn/app-utils/analytics-events'
import {
  generateOrgSlug,
  ORG_OVERRIDE_NOTE_MAX,
  ORG_OVERRIDE_REASON_CODES,
  ORG_OVERRIDE_REASON_LABELS,
  PLAN_LABELS,
  SELF_SERVE_PLANS,
  type OrgOverrideReasonCode,
  type OrgPlan,
} from '@aglyn/aglyn'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useUser } from '@aglyn/tenant-feature-instance'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { firstTouchField } from '../utils/account-acquisition'
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  InputAdornment,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { buildRoute, Route } from '../constants/route-links'
import { useIsStaff } from '../hooks/use-is-staff'

const WORKSPACE_DOMAIN = process.env.NEXT_PUBLIC_WORKSPACE_DOMAIN ?? 'aglyn.com'

/**
 * Every plan a birth comp may grant (AGL-3952): the self-serve plans but
 * Free, which grants nothing. Enterprise is not offered here — a custom
 * contract is not something a booth build comps.
 */
const CLIENT_COMP_PLANS: OrgPlan[] = SELF_SERVE_PLANS.filter((plan) => plan !== 'free')

/** What a prospect's workspace starts on unless staff say otherwise. */
const DEFAULT_CLIENT_COMP_PLAN: OrgPlan = 'starter'

/** The reason a build for a prospect carries unless staff say otherwise. */
const DEFAULT_CLIENT_COMP_REASON: OrgOverrideReasonCode = 'trial'

export interface CreateOrgDialogProps {
  open: boolean
  onClose: () => void
  /**
   * Seed the name field on first open (AGL-1523): the workspace picker
   * re-offers the org name a failed signup-time provisioning collected, so
   * the person doesn't have to type it a second time. Editable as ever.
   */
  initialName?: string
  /**
   * Where to land once the workspace exists, given its reserved slug.
   * Defaults to the new workspace's sites.
   *
   * The org jump page passes a builder that carries the marketing plan intent
   * (AGL-1117), so a workspace created while `?plan=` is on the URL opens on
   * billing with that plan rather than on an empty site list. The dialog does
   * not read the intent itself: the page that owns the intent owns the
   * destination, and the org switcher — which has no intent — keeps the
   * default.
   */
  destination?: (orgSlug: string) => string
}

/**
 * Create-an-organization dialog (AGL-621), shared by the org switcher and
 * the org jump page. Posts to /api/orgs/create, then lands in the new
 * workspace by URL — `/[orgSlug]/hosts` on the apex, or the org's own
 * subdomain when workspace subdomains are live.
 */
export function CreateOrgDialog(props: CreateOrgDialogProps) {
  const { open, onClose, initialName, destination } = props
  const { data: user } = useUser()
  const router = useRouter()
  const { enqueueSnackbar } = useSnackbar()
  // `null` while the claim resolves reads as "not staff": the section
  // appears once the claim is known rather than flashing for everyone.
  const isStaff = useIsStaff() === true
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  // "Build for a client" (AGL-3952): staff comp the workspace as they create
  // it. Held whether or not the person is staff — the switch is simply never
  // rendered, and never sent, for anyone else.
  const [forClient, setForClient] = useState(false)
  const [compPlan, setCompPlan] = useState<OrgPlan>(DEFAULT_CLIENT_COMP_PLAN)
  const [compReason, setCompReason] = useState<OrgOverrideReasonCode>(
    DEFAULT_CLIENT_COMP_REASON,
  )
  const [compNote, setCompNote] = useState('')
  const compActive = isStaff && forClient
  // The note is required on a birth comp: it is how a booth build is traced
  // to its event and owner later, and the server refuses it without one.
  const compIncomplete = compActive && !compNote.trim()

  // Seed once, on the first open that has a name to offer — never over what
  // the person has already typed (AGL-1523).
  const seededRef = useRef(false)
  useEffect(() => {
    if (!open || seededRef.current || !initialName) return
    seededRef.current = true
    setName((current) => current || initialName)
    setSlug((current) => current || generateOrgSlug(initialName))
  }, [open, initialName])

  const reset = () => {
    setName('')
    setSlug('')
    setSlugTouched(false)
    setForClient(false)
    setCompPlan(DEFAULT_CLIENT_COMP_PLAN)
    setCompReason(DEFAULT_CLIENT_COMP_REASON)
    setCompNote('')
  }

  const handleCreate = async () => {
    if (!name.trim() || busy || compIncomplete) return
    setBusy(true)
    try {
      const response = await authorizedFetch(user, '/api/orgs/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // The first touch, for the server's acquisition backstop: a sign-up
        // whose own page never recorded one creates its first workspace here.
        body: JSON.stringify({
          name: name.trim(),
          slug: slug.trim(),
          ...firstTouchField(),
          // Only with the switch on (AGL-3952); the server reads it off the
          // staff claim and refuses it from anyone else.
          ...(compActive
            ? {
                clientComp: {
                  plan: compPlan,
                  reason: compReason,
                  note: compNote.trim(),
                },
              }
            : {}),
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || !payload?.orgId) {
        enqueueSnackbar(payload?.error ?? 'Creating the organization failed', {
          variant: response.status === 409 ? 'warning' : 'error',
        })
        return
      }
      // Activation (AGL-1561). After the `payload.orgId` guard above, so a
      // 409 slug collision — where no org was created — is never counted.
      // The org name is deliberately NOT a param: it is customer identity.
      //
      // Navigation-safe, like the signup door (AGL-2587): the `router.push`
      // below is soft on the apex, but lands on the workspace's OWN
      // SUBDOMAIN once workspace subdomains are live, and that is a full
      // document navigation which tears down an async transport's pending
      // hit. Costs an already-settled transport nothing.
      await trackEventBeforeNavigation('org_created', {})
      enqueueSnackbar(`Created "${name.trim()}"`, { variant: 'success' })
      reset()
      onClose()
      // The server returns the reserved slug — land in the new workspace.
      const createdSlug = payload.slug ?? slug.trim()
      // A build for a client goes on to its one-screen build (AGL-3958):
      // the details, the domain, the owner's photos, the site, the preview.
      router.push(
        compActive
          ? buildRoute(Route.ORG_CLIENT_BUILD, { orgSlug: createdSlug })
          : (destination?.(createdSlug) ??
              buildRoute(Route.HOST_LIST, { orgSlug: createdSlug })),
      )
    } catch (error) {
      console.error(error)
      enqueueSnackbar('Creating the organization failed', { variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={() => (busy ? null : onClose())}
      maxWidth="xs"
      fullWidth
    >
      <DialogTitle>{'Create an organization'}</DialogTitle>
      <DialogContent
        sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
      >
        <Typography variant="body2" color="text.secondary">
          {'Organizations own sites and share media, data, plugins and ' +
            'billing across them. You become the owner.'}
        </Typography>
        <TextField
          label="Organization name"
          value={name}
          onChange={(event) => {
            setName(event.target.value)
            if (!slugTouched) setSlug(generateOrgSlug(event.target.value))
          }}
          autoFocus
        />
        <TextField
          label="Workspace URL"
          value={slug}
          onChange={(event) => {
            setSlug(event.target.value.toLowerCase())
            setSlugTouched(true)
          }}
          slotProps={{
            input: {
              endAdornment: (
                <InputAdornment position="end">{`.${WORKSPACE_DOMAIN}`}</InputAdornment>
              ),
            },
          }}
        />
        {isStaff ? (
          <Box
            sx={{
              bgcolor: 'action.hover',
              borderRadius: 1,
              p: 1.5,
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
            }}
          >
            <FormControlLabel
              sx={{ m: 0, justifyContent: 'space-between' }}
              labelPlacement="start"
              control={
                <Switch
                  checked={forClient}
                  onChange={(event) => setForClient(event.target.checked)}
                  disabled={busy}
                />
              }
              label={
                <Stack spacing={0.25}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    <Typography variant="subtitle2">{'Build for a client'}</Typography>
                    <Chip label="Staff" size="small" color="primary" variant="outlined" />
                  </Stack>
                  <Typography variant="caption" color="text.secondary">
                    {'Comp a plan, then build their site on one screen and hand it off. You take no seat.'}
                  </Typography>
                </Stack>
              }
            />
            {forClient ? (
              <>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                  <TextField
                    select
                    fullWidth
                    size="small"
                    label="Comp plan"
                    value={compPlan}
                    onChange={(event) => setCompPlan(event.target.value as OrgPlan)}
                  >
                    {CLIENT_COMP_PLANS.map((plan) => (
                      <MenuItem key={plan} value={plan}>
                        {PLAN_LABELS[plan]}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    select
                    fullWidth
                    size="small"
                    label="Reason"
                    value={compReason}
                    onChange={(event) =>
                      setCompReason(event.target.value as OrgOverrideReasonCode)
                    }
                  >
                    {ORG_OVERRIDE_REASON_CODES.map((code) => (
                      <MenuItem key={code} value={code}>
                        {ORG_OVERRIDE_REASON_LABELS[code]}
                      </MenuItem>
                    ))}
                  </TextField>
                </Stack>
                <TextField
                  required
                  size="small"
                  label="Note (staff only)"
                  placeholder="The event, the owner, the deal"
                  value={compNote}
                  error={compIncomplete && compNote.length > 0}
                  slotProps={{ htmlInput: { maxLength: ORG_OVERRIDE_NOTE_MAX } }}
                  onChange={(event) => setCompNote(event.target.value)}
                />
                <Typography variant="caption" color="text.secondary">
                  {`Capped at ${PLAN_LABELS[compPlan]}'s limits. The comp ends on its ` +
                    'own when the client subscribes, and the Audit Log records it ' +
                    'like any comp.'}
                </Typography>
              </>
            ) : null}
          </Box>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button disabled={busy} onClick={onClose}>
          {'Cancel'}
        </Button>
        <Button
          variant="contained"
          disabled={busy || !name.trim() || compIncomplete}
          onClick={() => void handleCreate()}
        >
          {busy ? 'Creating…' : compActive ? 'Create for the client' : 'Create'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
CreateOrgDialog.displayName = 'CreateOrgDialog'

export default CreateOrgDialog
