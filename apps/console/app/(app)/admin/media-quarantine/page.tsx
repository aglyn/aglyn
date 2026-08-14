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

/**
 * DISABLED FILES — the staff form for asset quarantine (AGL-1687).
 *
 * AGL-1512 shipped the enforcement, AGL-1613 the ingestion gate and AGL-1612
 * the red `Disabled` badge in the DAM. Setting and lifting one stayed a curl
 * against `/api/admin/media-quarantine` with a bearer token, which is a fine
 * runbook and a bad incident tool: the operator has to transcribe a digest
 * and a scope segment, choose between two digest fields correctly (AGL-1631
 * exists because the runbook named the wrong one), and then believe the
 * result.
 *
 * So this page never asks for a key. It asks for **the file** — a workspace
 * or site id and a media id, both readable off the CDN URL in the report
 * that started the incident — and the route derives every key from the
 * document. See `by: "media"` in `/api/admin/media-quarantine` for the three
 * transcription failures that removes.
 *
 * ## What the page refuses to do
 *
 * **Claim a state it has not read back.** Every action re-reads the deny
 * list and renders the server's answer, and a write that returns while the
 * state disagrees is reported as NOT CONFIRMED rather than as success — the
 * AGL-1571 discipline the Lockdown page states at length, for the same
 * reason: the dangerous half is a *lift* you believe happened.
 *
 * **Hide the reach of the key it is about to write.** A digest key covers
 * every copy of those bytes in every workspace; a per-asset key covers one
 * document. Which one is being written is on screen before the button is
 * pressed, because "I disabled one customer's file" and "I disabled that
 * stock photo everywhere" are different actions with the same button.
 *
 * **Pretend the cap is not there.** `MEDIA_QUARANTINE_MAX_ENTRIES` is a hard
 * refusal at 2000, and the failure mode of a full list is "a takedown
 * silently did not land". The count rides on every answer.
 */

import {
  MEDIA_QUARANTINE_MESSAGE_MAX,
  MEDIA_QUARANTINE_NOTE_MAX,
  MEDIA_QUARANTINE_REASON_LABELS,
  MEDIA_QUARANTINE_REASONS,
} from '@aglyn/aglyn'
import { ICON_VARIANT_SYMBOL_SECURE } from '@aglyn/shared-data-enums'
import { CardDisplay, Container } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Button,
  Chip,
  FormControlLabel,
  LinearProgress,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useState } from 'react'
import DashboardLayout from '../../../../components/layouts/dashboard.layout'
import StaffOnly from '../../../../components/staff-only.component'
import { docsHelp } from '../../../../constants/docs-links'
import { buildRoute, Route } from '../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../constants/shared'
import { useStaffRole } from '../../../../hooks/use-is-staff'

/** One key that could refuse the looked-up asset, and whether it is set. */
interface AssetKey {
  key: string
  kind: 'sha256' | 'legacy' | 'asset'
  set?: boolean
  state?: {
    reason: string
    message?: string
    atMs?: number
    untilMs?: number
    actorUid?: string
  } | null
  /** Staff-only rationale. This page is staff-gated; the DAM never sees it. */
  note?: string | null
}

interface AssetLookup {
  asset: {
    scopeSegment: string
    mediaId: string
    fileName: string | null
    hasStrongDigest: boolean
    hasLegacyDigest: boolean
    deleted: boolean
  }
  keys: AssetKey[]
  quarantined: boolean
  count: number
  maxEntries: number
  readAtMs: number
}

/** What a key of each kind actually reaches, in the operator's words. */
const KEY_REACH: Record<AssetKey['kind'], string> = {
  sha256:
    'the full sha256 of the bytes — covers EVERY copy of this file, in every workspace',
  legacy:
    'the legacy 64-bit digest — same reach, weaker key, and the only one some files have',
  asset: 'this one document in this one workspace',
}

function AdminMediaQuarantine() {
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const staffRole = useStaffRole()
  const canWrite = staffRole === 'super'

  const [scopeKind, setScopeKind] = useState<'org' | 'host'>('org')
  const [scopeId, setScopeId] = useState('')
  const [mediaId, setMediaId] = useState('')
  const [reason, setReason] = useState<string>('malware')
  const [message, setMessage] = useState('')
  const [note, setNote] = useState('')
  const [until, setUntil] = useState('')
  const [narrow, setNarrow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [lookup, setLookup] = useState<AssetLookup | null>(null)
  const [log, setLog] = useState<
    { atMs: number; text: string; confirmed: boolean }[]
  >([])

  const idToken = useCallback(
    async () => (await (user as any)?.getIdToken?.()) as string | undefined,
    [user],
  )

  /**
   * Read the asset and the keys, without writing anything. Open to every
   * staff role, deliberately: during an incident the person asking "is this
   * already disabled?" is usually support.
   */
  const look = useCallback(async () => {
    const token = await idToken()
    if (!token || !scopeId.trim() || !mediaId.trim()) return
    const params = new URLSearchParams({ mediaId: mediaId.trim() })
    params.set(scopeKind === 'org' ? 'orgId' : 'hostId', scopeId.trim())
    setBusy(true)
    try {
      const response = await fetch(
        `/api/admin/media-quarantine?${params.toString()}`,
        { headers: { Authorization: `Bearer ${token}` } },
      )
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload.error ?? `Failed (${response.status})`)
      }
      setLookup(payload as AssetLookup)
    } catch (error: any) {
      console.error(error)
      // Clear rather than keep. A panel about the PREVIOUS file, sitting
      // beside a new id, is the stale-verdict bug wearing a new face.
      setLookup(null)
      enqueueSnackbar(error?.message ?? 'Looking up that file failed', {
        variant: 'error',
        allowDuplicate: true,
      })
    } finally {
      setBusy(false)
    }
  }, [idToken, scopeKind, scopeId, mediaId, enqueueSnackbar])

  const act = useCallback(
    async (action: 'quarantine' | 'release') => {
      const token = await idToken()
      if (!token || !scopeId.trim() || !mediaId.trim()) return
      const untilMs = until ? new Date(until).getTime() : null
      setBusy(true)
      try {
        const response = await fetch('/api/admin/media-quarantine', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            action,
            by: 'media',
            [scopeKind === 'org' ? 'orgId' : 'hostId']: scopeId.trim(),
            mediaId: mediaId.trim(),
            prefer: narrow ? 'asset' : 'hash',
            ...(action === 'quarantine'
              ? {
                  reason,
                  message: message.trim() || undefined,
                  note: note.trim() || undefined,
                  untilMs:
                    untilMs && Number.isFinite(untilMs) ? untilMs : undefined,
                }
              : {}),
          }),
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) {
          throw new Error(payload.error ?? `Failed (${response.status})`)
        }
        // A 200 says the request was accepted. Only `confirmed` says the
        // state changed, and on a release it means NO key can still refuse
        // the file — the two are not the same claim.
        const confirmed = payload.confirmed !== false
        const what = `${action === 'quarantine' ? 'Disabled' : 'Released'} ${mediaId.trim()} (${(
          payload.keys ?? [payload.key]
        ).length} key${(payload.keys ?? [payload.key]).length === 1 ? '' : 's'})`
        setLog((entries) =>
          [{ atMs: Date.now(), text: what, confirmed }, ...entries].slice(0, 25),
        )
        enqueueSnackbar(
          confirmed
            ? `${what} — verified on the server (audited)`
            : `${what} was accepted, but re-reading the deny list shows the OPPOSITE state. Do not walk away.`,
          { variant: confirmed ? 'success' : 'error', allowDuplicate: true },
        )
        await look()
      } catch (error: any) {
        console.error(error)
        enqueueSnackbar(error?.message ?? 'The quarantine action failed', {
          variant: 'error',
          allowDuplicate: true,
        })
      } finally {
        setBusy(false)
      }
    },
    [
      idToken,
      scopeKind,
      scopeId,
      mediaId,
      narrow,
      reason,
      message,
      note,
      until,
      enqueueSnackbar,
      look,
    ],
  )

  // The key a quarantine would be written under, right now. The route makes
  // the same choice from the same document; showing it here means the reach
  // is on screen BEFORE the button, not explained after it.
  const pendingKey = lookup
    ? narrow
      ? lookup.keys.find((entry) => entry.kind === 'asset')
      : lookup.keys[0]
    : undefined
  const full = lookup ? lookup.count >= lookup.maxEntries : false

  return (
    <DashboardLayout
      breadcrumbItems={[
        { children: 'Staff', href: buildRoute(Route.ADMIN_OVERVIEW) },
        {
          children: 'Disabled files',
          href: buildRoute(Route.ADMIN_MEDIA_QUARANTINE),
        },
      ]}
      help="lockdown"
      header={{
        children: 'Disabled files',
        icon: { path: ICON_VARIANT_SYMBOL_SECURE.path },
      }}
    >
      <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
        <StaffOnly>
          <Stack spacing={2}>
            <Alert severity="info">
              {
                'Quarantine takes ONE uploaded file off the CDN worldwide while the workspace keeps serving. It is reversible and it does not delete anything — the file still exists and still counts toward the customer’s storage. Setting and lifting requires the super staff role; every action is audited.'
              }
            </Alert>

            {busy ? <LinearProgress /> : null}

            <CardDisplay
              header={'The file'}
              help={docsHelp('lockdown', { anchor: '#which-digest' })}
              contentGutterX
              contentGutterY
            >
              <Stack spacing={2}>
                <Typography variant="body2" color="text.secondary">
                  {
                    'Name the file, not a digest. Both halves are in its CDN URL: the scope segment (org:{orgId} or the site id) and the media id after /media/. The server reads the document and derives the keys, so it always picks the strongest digest the file has and always produces the scope segment the CDN actually looks up.'
                  }
                </Typography>
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{ flexWrap: 'wrap', rowGap: 1 }}
                >
                  <TextField
                    select
                    size="small"
                    label="Library"
                    value={scopeKind}
                    onChange={(event) =>
                      setScopeKind(event.target.value as 'org' | 'host')
                    }
                    sx={{ minWidth: 180 }}
                  >
                    <MenuItem value="org">{'Workspace (org)'}</MenuItem>
                    <MenuItem value="host">{'Site (host)'}</MenuItem>
                  </TextField>
                  <TextField
                    size="small"
                    label={scopeKind === 'org' ? 'Workspace id' : 'Site id'}
                    value={scopeId}
                    onChange={(event) => setScopeId(event.target.value)}
                    sx={{ minWidth: 220 }}
                  />
                  <TextField
                    size="small"
                    label="Media id"
                    value={mediaId}
                    onChange={(event) => setMediaId(event.target.value)}
                    sx={{ minWidth: 220 }}
                  />
                  <Button
                    variant="outlined"
                    disabled={busy || !scopeId.trim() || !mediaId.trim()}
                    onClick={() => void look()}
                  >
                    {'Look it up'}
                  </Button>
                </Stack>
              </Stack>
            </CardDisplay>

            {lookup ? (
              <CardDisplay
                header={'What is set right now'}
                help={docsHelp('lockdown', { anchor: '#quarantine-keys' })}
                contentGutterX
                contentGutterY
              >
                <Stack spacing={2}>
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}
                  >
                    <Chip
                      size="small"
                      color={lookup.quarantined ? 'error' : 'success'}
                      label={lookup.quarantined ? 'DISABLED' : 'NOT DISABLED'}
                    />
                    <Typography variant="body2">
                      {`${lookup.asset.fileName ?? lookup.asset.mediaId} — ${lookup.asset.scopeSegment}`}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {`read ${new Date(lookup.readAtMs).toLocaleString()}`}
                    </Typography>
                  </Stack>

                  {lookup.asset.deleted ? (
                    <Alert severity="info">
                      {
                        'This file is in the trash. Quarantining it is still worth doing — a restore would bring the bytes straight back, and a takedown notice does not stop applying because the customer tidied up.'
                      }
                    </Alert>
                  ) : null}

                  {!lookup.asset.hasStrongDigest ? (
                    <Alert severity="warning">
                      {lookup.asset.hasLegacyDigest
                        ? 'This file carries only the legacy 64-bit digest — it predates the strong one, or it came in through the signed-upload route. A takedown on it still bites, but it is the weaker key and it does not match the same bytes re-uploaded through a different route.'
                        : 'This file carries NO digest at all (a composite object, or a pre-digest upload). Only the per-asset key can cover it, and only at delivery: with nothing to compare, the upload gate cannot refuse a fresh copy of these bytes.'}
                    </Alert>
                  ) : null}

                  <Stack spacing={1}>
                    {lookup.keys.map((entry) => (
                      <Stack
                        key={entry.key}
                        direction="row"
                        spacing={1}
                        sx={{ alignItems: 'baseline', flexWrap: 'wrap' }}
                      >
                        <Chip
                          size="small"
                          color={entry.state ? 'error' : 'default'}
                          label={entry.state ? 'set' : 'not set'}
                        />
                        <Typography
                          variant="caption"
                          sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}
                        >
                          {entry.key}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {KEY_REACH[entry.kind]}
                        </Typography>
                        {entry.state ? (
                          <Typography variant="caption">
                            {`${entry.state.reason}${
                              entry.state.untilMs
                                ? ` — until ${new Date(entry.state.untilMs).toLocaleString()}`
                                : ''
                            }${entry.note ? ` — note: ${entry.note}` : ''}`}
                          </Typography>
                        ) : null}
                      </Stack>
                    ))}
                  </Stack>

                  <Typography
                    variant="caption"
                    color={full ? 'error' : 'text.secondary'}
                  >
                    {full
                      ? `The deny list is FULL (${lookup.count} of ${lookup.maxEntries}). The next new takedown will be refused with a 409 — release stale entries first.`
                      : `Deny list: ${lookup.count} of ${lookup.maxEntries} entries in use.`}
                  </Typography>
                </Stack>
              </CardDisplay>
            ) : null}

            {lookup ? (
              <CardDisplay
                header={'Disable or release'}
                help={docsHelp('lockdown', {
                  anchor: '#asset-quarantine--one-file-not-the-site-that-serves-it',
                })}
                contentGutterX
                contentGutterY
              >
                <Stack spacing={2}>
                  {!canWrite ? (
                    <Alert severity="warning">
                      {
                        'Setting and lifting a quarantine requires the super staff role. Reading this page does not — and the route refuses the write regardless of what this page renders.'
                      }
                    </Alert>
                  ) : null}

                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{ flexWrap: 'wrap', rowGap: 1 }}
                  >
                    <TextField
                      select
                      size="small"
                      label="Reason"
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      sx={{ minWidth: 240 }}
                    >
                      {MEDIA_QUARANTINE_REASONS.map((code) => (
                        <MenuItem key={code} value={code}>
                          {MEDIA_QUARANTINE_REASON_LABELS[code]}
                        </MenuItem>
                      ))}
                    </TextField>
                    <TextField
                      size="small"
                      type="datetime-local"
                      label="Until (optional)"
                      value={until}
                      onChange={(event) => setUntil(event.target.value)}
                      slotProps={{ inputLabel: { shrink: true } }}
                    />
                  </Stack>

                  <TextField
                    size="small"
                    label="Customer-facing message (optional)"
                    helperText={`Replaces the notice body the workspace sees in its media library. Write it for the customer. Max ${MEDIA_QUARANTINE_MESSAGE_MAX} characters.`}
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    slotProps={{ htmlInput: { maxLength: MEDIA_QUARANTINE_MESSAGE_MAX } }}
                    fullWidth
                  />
                  <TextField
                    size="small"
                    label="Internal note (optional)"
                    helperText={`Staff only — the notice number, the complainant, the assessment. Never rendered to the customer. Max ${MEDIA_QUARANTINE_NOTE_MAX} characters.`}
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    slotProps={{ htmlInput: { maxLength: MEDIA_QUARANTINE_NOTE_MAX } }}
                    fullWidth
                  />

                  <FormControlLabel
                    control={
                      <Switch
                        checked={narrow}
                        onChange={(event) => setNarrow(event.target.checked)}
                      />
                    }
                    label="Disable only this copy (per-asset key)"
                  />
                  <Typography variant="caption" color="text.secondary">
                    {
                      'Reach for this when the same bytes are legitimate elsewhere and only this workspace’s copy is the subject of the report. Otherwise leave it off: the digest key is stronger and it survives a re-upload.'
                    }
                  </Typography>

                  {pendingKey ? (
                    <Alert severity={narrow ? 'info' : 'warning'}>
                      {`This will be written under `}
                      <Typography
                        component="span"
                        variant="caption"
                        sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}
                      >
                        {pendingKey.key}
                      </Typography>
                      {` — ${KEY_REACH[pendingKey.kind]}.`}
                    </Alert>
                  ) : null}

                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{ flexWrap: 'wrap', rowGap: 1 }}
                  >
                    <Button
                      variant="contained"
                      color="error"
                      disabled={busy || !canWrite || (full && !lookup.quarantined)}
                      onClick={() => void act('quarantine')}
                    >
                      {'Disable this file'}
                    </Button>
                    <Button
                      variant="contained"
                      color="success"
                      disabled={busy || !canWrite}
                      onClick={() => void act('release')}
                    >
                      {'Release'}
                    </Button>
                  </Stack>
                  <Typography variant="caption" color="text.secondary">
                    {
                      'Release clears EVERY key currently refusing this file, not just the preferred one — an asset can be covered by two at once, and a half-lift leaves the Disabled badge up and reads exactly like a lift that failed.'
                    }
                  </Typography>
                </Stack>
              </CardDisplay>
            ) : null}

            <CardDisplay
              header={'Actions taken in this session'}
              help={docsHelp('lockdown', {
                anchor: '#never-take-a-lock-or-a-lift-on-trust',
              })}
              contentGutterX
              contentGutterY
            >
              {log.length ? (
                <Stack spacing={0.5}>
                  {log.map((entry) => (
                    <Typography
                      key={`${entry.atMs}-${entry.text}`}
                      variant="body2"
                      color={entry.confirmed ? 'text.primary' : 'error.main'}
                    >
                      {`${new Date(entry.atMs).toLocaleTimeString()} — ${entry.text}${
                        entry.confirmed ? '' : ' — NOT CONFIRMED'
                      }`}
                    </Typography>
                  ))}
                </Stack>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  {
                    'Nothing yet. If you pressed a button and no line appeared here, the click did not reach the server — look the file up again and press it again.'
                  }
                </Typography>
              )}
            </CardDisplay>
          </Stack>
        </StaffOnly>
      </Container>
    </DashboardLayout>
  )
}
AdminMediaQuarantine.displayName = 'Page:AdminMediaQuarantine'

export default AdminMediaQuarantine
