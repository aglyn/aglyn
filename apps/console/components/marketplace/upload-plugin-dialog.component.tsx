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

import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useRef, useState } from 'react'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  missingAttestationSubjects,
  PUBLISHER_ATTESTATION,
  requiredAttestationIds,
} from '@aglyn/aglyn/app-utils/publisher-attestation'

// Mirrors the server taxonomy; the server re-validates (see other marketplace
// dialogs for why the console can't import the community plugin's model).
const LISTING_CATEGORIES = [
  'analytics',
  'automation',
  'commerce',
  'communication',
  'content',
  'design',
  'forms',
  'integrations',
  'marketing',
  'productivity',
  'seo',
  'security',
] as const

// Mirrors `validateListingContent`'s URL rule, which is what the publish
// route enforces — this only saves a round trip (AGL-1076).
const isHttpsUrl = (value: string) =>
  /^https:\/\/[^\s]+$/.test(value.trim()) && value.trim().length <= 500

/** Base64-encode file bytes without a data: prefix. */
async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  let binary = ''
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < bytes.length; i += 1)
    binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

export interface UploadPluginDialogProps {
  orgId: string
  open: boolean
  onClose: () => void
}

/**
 * Self-service plugin upload (AGL-868). The seller uploads one self-contained
 * JS bundle plus its manifest; the listing publishes as a **sandboxed**
 * community plugin (the loader runs it isolated, no direct site-data access)
 * and is realm-signed only later, during staff review. This is the safe
 * default: nothing a seller uploads runs trusted until a human vouches for it.
 *
 * The bundle bytes and manifest go to `/api/community/publish-plugin`, which
 * statically verifies the bundle (entry exports, self-containment, forbidden
 * APIs, size), content-addresses it with sha256, and records the version.
 *
 * Visibility (AGL-968/992) chooses the AUDIENCE, never the trust level: a
 * private plugin runs on the same infrastructure and reaches the same host
 * ABI, so it takes the identical review path and is simply never listed —
 * only the owning org's hosts can install it, enforced in `install-plugin`.
 */
export function UploadPluginDialog(props: UploadPluginDialogProps) {
  const { orgId, open, onClose } = props
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const [busy, setBusy] = useState(false)
  const [problems, setProblems] = useState<string[]>([])

  const bundleRef = useRef<HTMLInputElement>(null)
  const manifestRef = useRef<HTMLInputElement>(null)
  const [bundleFile, setBundleFile] = useState<File | null>(null)
  const [manifestFile, setManifestFile] = useState<File | null>(null)
  const [manifestText, setManifestText] = useState('')

  const [displayName, setDisplayName] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [changelog, setChangelog] = useState('')
  const [priceUsd, setPriceUsd] = useState('0')
  const [readme, setReadme] = useState('')
  const [license, setLicense] = useState('')
  // The subject of the `repository` attestation (AGL-1076) — ticking that
  // item used to be a claim about a field this form never asked for.
  const [repositoryUrl, setRepositoryUrl] = useState('')
  // Private plugins (AGL-968/992): only settable on FIRST publish — the
  // server ignores it on a version bump, and changing it later is the
  // deliberate flip in Marketplace › Listings.
  const [visibility, setVisibility] = useState<'public' | 'private'>('public')
  // Pre-submission attestation (AGL-969). The server is the gate — it
  // decides which items are required from whether a listing already exists,
  // and refuses the publish with 428 — so this state only drives the UI.
  const [attested, setAttested] = useState<string[]>([])
  const [missingAttestations, setMissingAttestations] = useState<string[]>([])
  // The org has not accepted the current publisher agreement (AGL-1077).
  const [agreementProblem, setAgreementProblem] = useState('')

  const reset = () => {
    setBundleFile(null)
    setManifestFile(null)
    setManifestText('')
    setDisplayName('')
    setDescription('')
    setCategory('')
    setChangelog('')
    setPriceUsd('0')
    setReadme('')
    setLicense('')
    setRepositoryUrl('')
    setVisibility('public')
    setAttested([])
    setMissingAttestations([])
    setAgreementProblem('')
    setProblems([])
  }

  const toggleAttestation = (id: string) =>
    setAttested((current) =>
      current.includes(id)
        ? current.filter((entry) => entry !== id)
        : [...current, id],
    )

  /**
   * What this dialog blocks on locally.
   *
   * The changelog item is `updateOnly`, and this dialog genuinely cannot
   * know whether the manifest id already has a listing — the server answers
   * that. So we gate on the items that always apply, and let the server's
   * 428 name the rest, which the alert below renders. Guessing here and
   * demanding a changelog attestation from a first-time publisher would be
   * the worse failure: an item that does not apply teaches people to tick
   * without reading.
   */
  const unattested = requiredAttestationIds(false).filter(
    (id) => !attested.includes(id),
  )

  /**
   * Attestations with nothing to be about (AGL-1076).
   *
   * The server refuses these with the same 428, but a publisher should not
   * have to submit to find out that the box they ticked refers to a field
   * they left empty. Same helper as the route, so the two cannot drift.
   */
  const unfilledSubjects = missingAttestationSubjects(
    { repositoryUrl },
    false,
  )

  const close = () => {
    if (busy) return
    reset()
    onClose()
  }

  const readManifest = async (): Promise<Record<string, unknown> | null> => {
    // A pasted manifest wins; otherwise read the chosen file.
    const raw = manifestText.trim()
      ? manifestText
      : manifestFile
        ? await manifestFile.text()
        : ''
    if (!raw) return null
    try {
      const parsed = JSON.parse(raw)
      return parsed && typeof parsed === 'object' ? parsed : null
    } catch {
      return null
    }
  }

  const submit = async () => {
    setProblems([])
    setMissingAttestations([])
    setAgreementProblem('')
    if (!bundleFile) {
      return void enqueueSnackbar('Choose a plugin bundle (.js) to upload', {
        variant: 'warning',
      })
    }
    const manifest = await readManifest()
    if (!manifest) {
      return void enqueueSnackbar(
        'Add a valid manifest (JSON) — id, name, version, and entry',
        { variant: 'warning' },
      )
    }
    setBusy(true)
    try {
      const bundle = await fileToBase64(bundleFile)
      const idToken = await (
        user as { getIdToken?: () => Promise<string> }
      )?.getIdToken?.()
      const response = await fetch('/api/community/publish-plugin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({
          orgId,
          bundle,
          manifest,
          displayName:
            displayName.trim() || String((manifest as any).name ?? '').trim(),
          description: description.trim(),
          category: category || undefined,
          changelog: changelog.trim(),
          // A private plugin has no buyers — its only audience already owns
          // it — so it publishes free regardless of what the field held
          // before the publisher switched visibility.
          priceUsd:
            visibility === 'private'
              ? 0
              : Math.max(0, Math.round(Number(priceUsd) || 0)),
          // Audience, not trust level (AGL-968): a private plugin takes the
          // same review path — it just never reaches the marketplace, and
          // only this org's sites can install it. Honoured on first publish
          // only; re-publishing an existing listing leaves it alone.
          visibility,
          // What the publisher stated about these bytes (AGL-969). Recorded
          // on the version doc, pinned to its sha256, and shown to the
          // reviewer beside their own checklist.
          attestation: attested,
          // Listing docs (AGL-927): the publish API already validates and
          // stores these (validateListingContent); without them every
          // bundle-published listing hit review flagged "README: MISSING ·
          // No license" and rendered a bare detail page.
          ...(readme.trim() ? { readme: readme.trim() } : {}),
          ...(license.trim() ? { license: license.trim() } : {}),
          // The subject of the repository attestation (AGL-1076) — stored on
          // the listing AND on this version, so a reviewer opens the repo as
          // it was declared for these bytes.
          ...(repositoryUrl.trim()
            ? { repositoryUrl: repositoryUrl.trim() }
            : {}),
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        if (Array.isArray(payload?.problems)) setProblems(payload.problems)
        // 428 (AGL-969): an item this dialog could not know was required —
        // in practice the update-only changelog attestation. Highlight it
        // rather than only shouting the error in a snackbar.
        if (Array.isArray(payload?.missingAttestations)) {
          setMissingAttestations(payload.missingAttestations)
        }
        // 412 with an `agreement` (AGL-1077): a precondition on the ORG, not
        // on this bundle. Held as an alert rather than a snackbar because the
        // fix is on another page and a toast will be gone before they read it.
        if (payload?.agreement) setAgreementProblem(String(payload.error ?? ''))
        return void enqueueSnackbar(payload?.error ?? 'Upload failed', {
          variant: response.status === 501 ? 'info' : 'error',
          allowDuplicate: true,
        })
      }
      enqueueSnackbar(`Plugin published (v${payload?.version ?? '1'})`, {
        variant: 'success',
      })
      close()
    } catch (error) {
      console.error(error)
      enqueueSnackbar('An error has occurred', {
        variant: 'error',
        allowDuplicate: true,
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onClose={close} maxWidth="sm" fullWidth>
      <DialogTitle>{'Upload a plugin'}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Alert severity="info">
            {'Plugins publish sandboxed — they run isolated and can’t touch ' +
              'site data directly. A reviewer verifies and signs yours before ' +
              'it can run trusted.'}
          </Alert>

          {/* Private plugins (AGL-968/992): build for your own sites without
              publishing to anyone. Deliberately worded as an AUDIENCE choice
              — private is not a faster lane, and the caption below says so,
              because "skip the queue" is the reading it would otherwise
              invite. */}
          <TextField
            select
            label="Who can install this"
            value={visibility}
            onChange={(event) =>
              setVisibility(event.target.value as 'public' | 'private')
            }
            size="small"
            helperText={
              visibility === 'private'
                ? 'Private plugins take the same review path — same queue, ' +
                  'same checklist, same verifier, same signature for realm ' +
                  'trust. They are never listed in the marketplace, and only ' +
                  'your sites can install them.'
                : 'Listed in the marketplace for every workspace once a ' +
                  'reviewer approves it.'
            }
          >
            <MenuItem value="public">
              {'Anyone — publish to the marketplace'}
            </MenuItem>
            <MenuItem value="private">
              {'Only this organization — private plugin'}
            </MenuItem>
          </TextField>

          <Stack spacing={0.5}>
            <Typography variant="subtitle2">{'Bundle (.js)'}</Typography>
            <input
              ref={bundleRef}
              type="file"
              accept=".js,text/javascript,application/javascript"
              hidden
              onChange={(event) =>
                setBundleFile(event.target.files?.[0] ?? null)
              }
            />
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Button size="small" onClick={() => bundleRef.current?.click()}>
                {'Choose bundle'}
              </Button>
              <Typography variant="body2" color="text.secondary" noWrap>
                {bundleFile?.name ?? 'No file chosen'}
              </Typography>
            </Stack>
            <Typography variant="caption" color="text.secondary">
              {'One self-contained bundle. It’s statically checked for ' +
                'forbidden APIs and size before publishing.'}
            </Typography>
          </Stack>

          <Stack spacing={0.5}>
            <Typography variant="subtitle2">
              {'Manifest (JSON: id, name, version, entry)'}
            </Typography>
            <input
              ref={manifestRef}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={(event) =>
                setManifestFile(event.target.files?.[0] ?? null)
              }
            />
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Button size="small" onClick={() => manifestRef.current?.click()}>
                {'Choose manifest.json'}
              </Button>
              <Typography variant="body2" color="text.secondary" noWrap>
                {manifestFile?.name ?? 'or paste below'}
              </Typography>
            </Stack>
            <TextField
              placeholder='{ "id": "acme.widget", "name": "Widget", "version": "1.0.0", "entry": "index.js" }'
              value={manifestText}
              onChange={(event) => setManifestText(event.target.value)}
              size="small"
              multiline
              minRows={3}
              fullWidth
            />
          </Stack>

          <TextField
            label="Listing name"
            helperText="Defaults to the manifest name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            size="small"
          />
          <TextField
            label="Description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            size="small"
            multiline
            minRows={2}
          />
          <Stack direction="row" spacing={1}>
            <TextField
              label="Changelog"
              value={changelog}
              onChange={(event) => setChangelog(event.target.value)}
              size="small"
              sx={{ flex: 1 }}
            />
            <TextField
              select
              label="Category"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              size="small"
              sx={{ flex: 1 }}
            >
              <MenuItem value="">{'None'}</MenuItem>
              {LISTING_CATEGORIES.map((entry) => (
                <MenuItem key={entry} value={entry}>
                  {entry}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
          <TextField
            label="README (markdown)"
            helperText={
              'Shown on your listing page — what it does, how to configure ' +
              'it. Reviewers and cautious buyers read this first.'
            }
            value={readme}
            onChange={(event) => setReadme(event.target.value)}
            size="small"
            multiline
            minRows={4}
          />
          {/* Repository (AGL-1076). Sits with the listing content rather
              than inside the checklist below: it is a field, and the item
              that confirms it is a statement — but it is required exactly
              because that item is, so the helper text says which. */}
          <TextField
            label="Repository URL"
            placeholder="https://github.com/acme/widget"
            required
            error={Boolean(repositoryUrl.trim()) && !isHttpsUrl(repositoryUrl)}
            helperText={
              Boolean(repositoryUrl.trim()) && !isHttpsUrl(repositoryUrl)
                ? 'Must be an https URL.'
                : 'The source for this bundle. A reviewer opens it first — ' +
                  'it is what the repository confirmation below is about.'
            }
            value={repositoryUrl}
            onChange={(event) => setRepositoryUrl(event.target.value)}
            size="small"
          />
          <Stack direction="row" spacing={1}>
            <TextField
              label="License"
              placeholder="MIT"
              helperText="Short label, e.g. MIT or Apache-2.0"
              value={license}
              onChange={(event) => setLicense(event.target.value)}
              size="small"
              sx={{ flex: 1 }}
            />
            <TextField
              label="Price (USD)"
              // A private plugin has no buyers, and a price on one would only
              // send the publisher through Stripe onboarding to sell to
              // themselves.
              disabled={visibility === 'private'}
              helperText={
                visibility === 'private'
                  ? 'Private plugins are free — nobody else can install them.'
                  : '0 for free. Paid listings need payouts set up.'
              }
              type="number"
              value={visibility === 'private' ? '0' : priceUsd}
              onChange={(event) => setPriceUsd(event.target.value)}
              size="small"
              sx={{ flex: 1 }}
            />
          </Stack>

          {/* Pre-submission checklist (AGL-969). Sits directly above the
              publish button because it is the last thing a publisher should
              read, and because most review round-trips are one of these six
              questions going unanswered. Every item is a statement only the
              publisher can make — the staff checklist asks different things,
              and self-attesting to "the publisher is contactable" would mean
              nothing. */}
          <Stack spacing={1}>
            <Typography variant="subtitle2">
              {'Before you publish'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {'Recorded against this exact bundle, with your name and the ' +
                'date, and shown to the reviewer. Republishing the same ' +
                'version number asks again — the bytes changed.'}
            </Typography>
            {missingAttestations.length ? (
              <Alert severity="warning">
                {'This plugin already has a published version, so the ' +
                  'highlighted item applies too.'}
              </Alert>
            ) : null}
            {PUBLISHER_ATTESTATION.map((item) => {
              const flagged = missingAttestations.includes(item.id)
              return (
                <Stack key={item.id} spacing={0.25}>
                  <FormControlLabel
                    control={
                      <Checkbox
                        size="small"
                        checked={attested.includes(item.id)}
                        disabled={busy}
                        onChange={() => toggleAttestation(item.id)}
                      />
                    }
                    label={
                      <Stack
                        direction="row"
                        spacing={1}
                        sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                      >
                        <Typography
                          variant="body2"
                          color={flagged ? 'warning.main' : undefined}
                        >
                          {item.label}
                        </Typography>
                        {item.updateOnly ? (
                          <Chip
                            size="small"
                            variant="outlined"
                            label="Updates only"
                          />
                        ) : null}
                      </Stack>
                    }
                  />
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ pl: 4 }}
                  >
                    {item.detail}
                  </Typography>
                </Stack>
              )
            })}
          </Stack>

          {agreementProblem ? (
            <Alert severity="warning">
              <Typography variant="subtitle2">
                {'Publisher agreement'}
              </Typography>
              <Typography variant="caption">{agreementProblem}</Typography>
            </Alert>
          ) : null}

          {problems.length ? (
            <Alert severity="error">
              <Typography variant="subtitle2">
                {'Bundle failed verification'}
              </Typography>
              <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                {problems.map((problem) => (
                  <li key={problem}>
                    <Typography variant="caption">{problem}</Typography>
                  </li>
                ))}
              </ul>
            </Alert>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={close} disabled={busy}>
          {'Cancel'}
        </Button>
        <Button
          variant="contained"
          color="secondary"
          onClick={() => void submit()}
          disabled={
            busy ||
            !bundleFile ||
            unattested.length > 0 ||
            unfilledSubjects.length > 0 ||
            !isHttpsUrl(repositoryUrl)
          }
        >
          {busy
            ? 'Publishing…'
            : unattested.length
              ? `Confirm ${unattested.length} more`
            : unfilledSubjects.length || !isHttpsUrl(repositoryUrl)
              ? 'Add a repository URL'
            : visibility === 'private'
              ? 'Publish privately'
              : 'Publish plugin'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

UploadPluginDialog.displayName = 'UploadPluginDialog'

export default UploadPluginDialog
