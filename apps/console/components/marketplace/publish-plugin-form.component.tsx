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
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Button,
  Checkbox,
  Chip,
  FormControlLabel,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  missingAttestationSubjects,
  PUBLISHER_ATTESTATION,
  requiredAttestationIds,
} from '@aglyn/aglyn/app-utils/publisher-attestation'
import MarkdownField, {
  type MarkdownFieldHandle,
} from '../markdown-field.component'
import MediaPickerDialog from '../media/media-picker-dialog.component'
import { docsHelp } from '../../constants/docs-links'
import mediaSrc from '../../utils/media-src'
import { buildRoute, Route } from '../../constants/route-links'

// Mirrors the server taxonomy; the server re-validates (the console cannot
// import the community plugin's model — scope:app may not reach aglyn:addons).
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

/**
 * Everything the draft can hold.
 *
 * The bundle File is deliberately absent. A File cannot be serialized, and
 * a draft that silently restores every field except the one that decides
 * what actually ships is worse than no draft — the publisher would believe
 * they were republishing the bytes they left with. It is re-chosen, and the
 * page says so rather than pretending otherwise.
 */
interface PublishDraft {
  manifestText: string
  displayName: string
  description: string
  category: string
  changelog: string
  priceUsd: string
  readme: string
  license: string
  repositoryUrl: string
  visibility: 'public' | 'private'
  attested: string[]
}

const EMPTY_DRAFT: PublishDraft = {
  manifestText: '',
  displayName: '',
  description: '',
  category: '',
  changelog: '',
  priceUsd: '0',
  readme: '',
  license: '',
  repositoryUrl: '',
  visibility: 'public',
  attested: [],
}

const draftKey = (orgId: string) => `aglyn.publish-plugin.draft.${orgId}`

/**
 * Whether a stored draft is worth telling anyone about.
 *
 * The persist effect runs on mount, so an untouched form writes an empty
 * draft — and without this the NEXT first visit would announce "picked up
 * where you left off" over a form nobody had typed in. A restore notice
 * that fires when nothing was restored is how a publisher learns to ignore
 * it, which is expensive on the one visit it matters.
 */
/**
 * Read the stored draft, during render.
 *
 * Deliberately NOT an effect. Restoring in one effect while a second effect
 * persists on every change is a race that Strict Mode wins: React
 * double-invokes effects in development, so the persist pass writes the
 * still-empty state back over storage BEFORE the restore's `setDraft` has
 * applied, and the re-run then restores the emptiness it just wrote. The
 * draft looked correct in jsdom (no Strict Mode) and silently vanished in
 * the browser. A read during initialization has no ordering to lose.
 */
function readDraft(orgId: string): PublishDraft {
  if (typeof window === 'undefined' || !orgId) return EMPTY_DRAFT
  try {
    const stored = window.localStorage.getItem(draftKey(orgId))
    if (!stored) return EMPTY_DRAFT
    return { ...EMPTY_DRAFT, ...(JSON.parse(stored) as Partial<PublishDraft>) }
  } catch {
    // A corrupt draft is not worth failing the page over.
    return EMPTY_DRAFT
  }
}

function draftHasContent(draft: Partial<PublishDraft>): boolean {
  return (Object.keys(EMPTY_DRAFT) as Array<keyof PublishDraft>).some((key) => {
    const value = draft[key]
    if (Array.isArray(value)) return value.length > 0
    return value !== undefined && value !== EMPTY_DRAFT[key]
  })
}

export interface PublishPluginFormProps {
  orgId: string
  orgSlug: string
}

/**
 * The plugin publish form (AGL-1078), as a page.
 *
 * It was a modal. A publish is the most consequential thing a publisher
 * does — it puts executable code in front of every workspace that installs
 * it — and it had no URL to link or resume, no draft, and no room, which is
 * why the AGL-969 checklist ended up below the publish button where it had
 * to be scrolled past to be read.
 *
 * Same server contract: this posts the identical body to
 * `/api/community/publish-plugin`. What changed is the container, and what
 * the container makes possible — sections, a draft that survives a reload,
 * server problems shown against the field that caused them, and somewhere
 * to go afterwards.
 */
export function PublishPluginForm(props: PublishPluginFormProps) {
  const { orgId, orgSlug } = props
  const { data: user } = useUser()
  const router = useRouter()
  const { enqueueSnackbar } = useSnackbar()
  const [busy, setBusy] = useState(false)

  const bundleRef = useRef<HTMLInputElement>(null)
  const manifestRef = useRef<HTMLInputElement>(null)
  const [bundleFile, setBundleFile] = useState<File | null>(null)
  const [manifestFile, setManifestFile] = useState<File | null>(null)
  // Inline README images come from the shared DAM, like everywhere else.
  const readmeEditorRef = useRef<MarkdownFieldHandle | null>(null)
  const [pickingReadmeImage, setPickingReadmeImage] = useState(false)
  const [draft, setDraft] = useState<PublishDraft>(() => readDraft(orgId))
  const [draftRestored, setDraftRestored] = useState(() =>
    draftHasContent(readDraft(orgId)),
  )

  // Server-side problems, held against the field that caused them (AGL-1078)
  // instead of thrown at a snackbar that is gone before it is read. Cleared
  // on every submit so a fixed problem stops being shown as one.
  const [problems, setProblems] = useState<string[]>([])
  const [missingAttestations, setMissingAttestations] = useState<string[]>([])
  const [agreementProblem, setAgreementProblem] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const set = <K extends keyof PublishDraft>(key: K) =>
    (value: PublishDraft[K]) =>
      setDraft((current) => ({ ...current, [key]: value }))

  // Written back on every change — one small JSON blob, and the only thing
  // that makes a reload safe. Safe to run on the first pass now that the
  // restore happens during initialization: the value it writes IS the
  // restored one, so there is nothing left to clobber.
  useEffect(() => {
    if (!orgId) return
    try {
      window.localStorage.setItem(draftKey(orgId), JSON.stringify(draft))
    } catch {
      // Storage full or blocked — the form still works, it just won't survive.
    }
  }, [orgId, draft])

  const clearDraft = useCallback(() => {
    try {
      window.localStorage.removeItem(draftKey(orgId))
    } catch {
      // Nothing to do; the next publish overwrites it anyway.
    }
  }, [orgId])

  const toggleAttestation = (id: string) =>
    setDraft((current) => ({
      ...current,
      attested: current.attested.includes(id)
        ? current.attested.filter((entry) => entry !== id)
        : [...current.attested, id],
    }))

  /**
   * What this page blocks on locally.
   *
   * The changelog item is `updateOnly` and this form genuinely cannot know
   * whether the manifest id already has a listing — the server answers that
   * and names it in a 428. Demanding a changelog attestation from a
   * first-time publisher would be the worse failure: an item that does not
   * apply teaches people to tick without reading.
   */
  const unattested = requiredAttestationIds(false).filter(
    (id) => !draft.attested.includes(id),
  )
  const unfilledSubjects = missingAttestationSubjects(
    { repositoryUrl: draft.repositoryUrl },
    false,
  )
  const repositoryInvalid =
    Boolean(draft.repositoryUrl.trim()) && !isHttpsUrl(draft.repositoryUrl)

  const readManifest = async (): Promise<Record<string, unknown> | null> => {
    // A pasted manifest wins; otherwise read the chosen file.
    const raw = draft.manifestText.trim()
      ? draft.manifestText
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
    setFieldErrors({})
    if (!bundleFile) {
      setFieldErrors({ bundle: 'Choose a plugin bundle (.js) to upload.' })
      return
    }
    const manifest = await readManifest()
    if (!manifest) {
      setFieldErrors({
        manifest: 'Add a valid manifest (JSON) — id, name, version and entry.',
      })
      return
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
            draft.displayName.trim() ||
            String((manifest as { name?: unknown }).name ?? '').trim(),
          description: draft.description.trim(),
          category: draft.category || undefined,
          changelog: draft.changelog.trim(),
          // A private plugin has no buyers — its only audience already owns
          // it — so it publishes free regardless of what the field held
          // before the publisher switched visibility.
          priceUsd:
            draft.visibility === 'private'
              ? 0
              : Math.max(0, Math.round(Number(draft.priceUsd) || 0)),
          visibility: draft.visibility,
          attestation: draft.attested,
          ...(draft.readme.trim() ? { readme: draft.readme.trim() } : {}),
          ...(draft.license.trim() ? { license: draft.license.trim() } : {}),
          ...(draft.repositoryUrl.trim()
            ? { repositoryUrl: draft.repositoryUrl.trim() }
            : {}),
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        if (Array.isArray(payload?.problems)) setProblems(payload.problems)
        if (Array.isArray(payload?.missingAttestations)) {
          setMissingAttestations(payload.missingAttestations)
        }
        // A 412 with an `agreement` is a precondition on the ORG (AGL-1077),
        // fixed on another page — held as an alert, not a toast.
        if (payload?.agreement) {
          setAgreementProblem(String(payload.error ?? ''))
        }
        // A rejected subject names its field (AGL-1076), so put the message
        // where the value is rather than in a banner about a form.
        if (Array.isArray(payload?.missingAttestationSubjects)) {
          setFieldErrors(
            Object.fromEntries(
              payload.missingAttestationSubjects.map((field: string) => [
                field,
                String(payload.error ?? 'Required'),
              ]),
            ),
          )
        }
        return void enqueueSnackbar(payload?.error ?? 'Publish failed', {
          variant: response.status === 501 ? 'info' : 'error',
          allowDuplicate: true,
        })
      }
      // Somewhere to go (AGL-1078). The dialog closed onto the panel it
      // opened from, which said nothing about what had just happened; the
      // listing shows the version now queued for review.
      clearDraft()
      enqueueSnackbar(
        `Published v${payload?.version ?? '1'} — it is queued for review`,
        { variant: 'success' },
      )
      router.push(
        buildRoute(Route.ORG_MARKETPLACE_LISTING, {
          orgSlug,
          listingId: String(payload?.listingId ?? ''),
        }),
      )
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

  const blocked =
    busy ||
    !bundleFile ||
    unattested.length > 0 ||
    unfilledSubjects.length > 0 ||
    repositoryInvalid

  return (
    <Stack spacing={2}>
      <Alert severity="info">
        {'Plugins publish sandboxed — they run isolated and can’t touch site ' +
          'data directly. A reviewer verifies and signs yours before it can ' +
          'run trusted.'}
      </Alert>

      {draftRestored ? (
        <Alert severity="info" onClose={() => setDraftRestored(false)}>
          {'Picked up where you left off. Your bundle and manifest file are ' +
            'not saved — choose them again before publishing.'}
        </Alert>
      ) : null}

      {agreementProblem ? (
        <Alert severity="warning">{agreementProblem}</Alert>
      ) : null}

      <CardDisplay
        header={'Bundle and manifest'}
        help={docsHelp('publisherHandbook', {
          anchor: '#publishing-a-version',
          excerpt:
            'One self-contained bundle plus its manifest — verified before ' +
            'it is stored, and content-addressed once it is.',
        })}
        contentGutterX
        contentGutterY
      >
        <Stack spacing={2}>
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
            <Typography
              variant="caption"
              color={fieldErrors['bundle'] ? 'error.main' : 'text.secondary'}
            >
              {fieldErrors['bundle'] ??
                'One self-contained bundle. It’s statically checked for ' +
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
              placeholder='{ "id": "acme-widget", "name": "Widget", "version": "1.0.0", "entry": "index.js" }'
              value={draft.manifestText}
              onChange={(event) => set('manifestText')(event.target.value)}
              size="small"
              multiline
              minRows={4}
              fullWidth
              error={Boolean(fieldErrors['manifest'])}
              helperText={fieldErrors['manifest'] ?? ' '}
            />
          </Stack>

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
      </CardDisplay>

      <CardDisplay
        header={'Listing'}
        help={docsHelp('publisherHandbook', {
          anchor: '#authoring-your-listing',
          excerpt:
            'What a reviewer reads first and a buyer reads before running ' +
            'third-party code.',
        })}
        contentGutterX
        contentGutterY
      >
        <Stack spacing={2}>
          <TextField
            label="Listing name"
            helperText="Defaults to the manifest name"
            value={draft.displayName}
            onChange={(event) => set('displayName')(event.target.value)}
            size="small"
          />
          <TextField
            label="Description"
            helperText="The one-line summary on browse cards"
            value={draft.description}
            onChange={(event) => set('description')(event.target.value)}
            size="small"
            multiline
            minRows={2}
          />
          <TextField
            select
            label="Category"
            value={draft.category}
            onChange={(event) => set('category')(event.target.value)}
            size="small"
          >
            <MenuItem value="">{'None'}</MenuItem>
            {LISTING_CATEGORIES.map((entry) => (
              <MenuItem key={entry} value={entry}>
                {entry}
              </MenuItem>
            ))}
          </TextField>
          {/* The same editor the listing detail page uses (AGL-1080). The
              first time a publisher writes the document reviewers read
              first used to get the worst tool we have, and the second time
              the good one — for the same field. The AGL-969 attestation
              made that worse by asking them to confirm the README
              documents what data the plugin handles, in a box too small to
              see whether it does. */}
          <MarkdownField
            label="README"
            value={draft.readme}
            onChange={set('readme')}
            onPickImageFromMedia={() => setPickingReadmeImage(true)}
            editorRef={(handle) => {
              readmeEditorRef.current = handle
            }}
            helperText={
              'Shown on your listing page — what it does, how to configure ' +
              'it, and what it reads, stores or sends. Reviewers and ' +
              'cautious buyers read this first.'
            }
          />
          {/* The only field that exclusively concerns updates (AGL-1080).
              It was a single line labelled `Changelog` and nothing else,
              presented as an equal peer of Category — while AGL-969 attests
              to it and AGL-976 builds the listing's changelog tab out of
              it. The helper names both audiences, because "what changed"
              means something different to each. */}
          <TextField
            label="Changelog"
            placeholder="Fixed the timer drift on Safari; added a compact layout"
            helperText={
              'Two audiences: the reviewer, comparing this version against ' +
              'the last approved one, and every installer who reads it on ' +
              'your listing’s changelog tab before updating. On a first ' +
              'version there is nothing to compare against — say what the ' +
              'plugin does instead, or leave it.'
            }
            value={draft.changelog}
            onChange={(event) => set('changelog')(event.target.value)}
            size="small"
            multiline
            minRows={3}
          />
          {/* AGL-1076: the subject of the repository attestation below. */}
          <TextField
            label="Repository URL"
            placeholder="https://github.com/acme/widget"
            required
            error={repositoryInvalid || Boolean(fieldErrors['repositoryUrl'])}
            helperText={
              repositoryInvalid
                ? 'Must be an https URL.'
                : (fieldErrors['repositoryUrl'] ??
                  'The source for this bundle. A reviewer opens it first — ' +
                    'it is what the repository confirmation below is about.')
            }
            value={draft.repositoryUrl}
            onChange={(event) => set('repositoryUrl')(event.target.value)}
            size="small"
          />
          <TextField
            label="License"
            placeholder="MIT"
            helperText="Short label, e.g. MIT or Apache-2.0"
            value={draft.license}
            onChange={(event) => set('license')(event.target.value)}
            size="small"
          />
        </Stack>
      </CardDisplay>

      <CardDisplay
        header={'Who can install it, and for how much'}
        help={docsHelp('publisherHandbook', {
          anchor: '#private-plugins',
          excerpt:
            'Private is a choice about audience, not about trust — it takes ' +
            'the identical review path.',
        })}
        contentGutterX
        contentGutterY
      >
        <Stack spacing={2}>
          {/* Private plugins (AGL-968/992): deliberately worded as an
              AUDIENCE choice — private is not a faster lane, and the caption
              says so, because "skip the queue" is the reading it would
              otherwise invite. */}
          <TextField
            select
            label="Who can install this"
            value={draft.visibility}
            onChange={(event) =>
              set('visibility')(event.target.value as 'public' | 'private')
            }
            size="small"
            helperText={
              draft.visibility === 'private'
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
          <TextField
            label="Price (USD)"
            // A private plugin has no buyers, and a price on one would only
            // send the publisher through Stripe onboarding to sell to
            // themselves.
            disabled={draft.visibility === 'private'}
            helperText={
              draft.visibility === 'private'
                ? 'Private plugins are free — nobody else can install them.'
                : '0 for free. Paid listings need payouts set up.'
            }
            type="number"
            value={draft.visibility === 'private' ? '0' : draft.priceUsd}
            onChange={(event) => set('priceUsd')(event.target.value)}
            size="small"
          />
        </Stack>
      </CardDisplay>

      {/* The checklist last, in full view of the publish button (AGL-969 /
          AGL-1078). In the dialog it sat below the button and had to be
          scrolled past to be seen at all. Every item is a statement only the
          publisher can make. */}
      <CardDisplay
        header={'Before you publish'}
        help={docsHelp('publisherHandbook', {
          anchor: '#before-you-publish',
          excerpt:
            'Recorded against this exact bundle, with your name and the ' +
            'date, and shown to the reviewer.',
        })}
        contentGutterX
        contentGutterY
      >
        <Stack spacing={1}>
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
                      checked={draft.attested.includes(item.id)}
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
      </CardDisplay>

      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Button
          variant="contained"
          color="secondary"
          onClick={() => void submit()}
          disabled={blocked}
        >
          {busy
            ? 'Publishing…'
            : !bundleFile
              ? 'Choose a bundle'
            : unattested.length
              ? `Confirm ${unattested.length} more`
            : unfilledSubjects.length || repositoryInvalid
              ? 'Add a repository URL'
            : draft.visibility === 'private'
              ? 'Publish privately'
              : 'Publish plugin'}
        </Button>
        <Button
          disabled={busy}
          onClick={() => {
            clearDraft()
            setDraft(EMPTY_DRAFT)
            setBundleFile(null)
            setManifestFile(null)
            setDraftRestored(false)
          }}
        >
          {'Discard draft'}
        </Button>
      </Stack>

      <MediaPickerDialog
        orgId={orgId}
        open={pickingReadmeImage}
        onClose={() => setPickingReadmeImage(false)}
        onPick={(media) => {
          setPickingReadmeImage(false)
          const url = mediaSrc(media ?? {})
          if (url) readmeEditorRef.current?.insertImage('', url)
        }}
      />
    </Stack>
  )
}

PublishPluginForm.displayName = 'PublishPluginForm'

export default PublishPluginForm
