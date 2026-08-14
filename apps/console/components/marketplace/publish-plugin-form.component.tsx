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
import {
  MarkdownField,
  type MarkdownFieldHandle,
} from '@aglyn/aglyn-markdown-editor'
import MediaPickerDialog from '../media/media-picker-dialog.component'
import { docsHelp } from '../../constants/docs-links'
import { mediaNodeSrc } from '@aglyn/aglyn/app-utils/media-ref'
import mediaSrc from '../../utils/media-src'
import { buildRoute, Route } from '../../constants/route-links'

// Mirrors the server taxonomy; the server re-validates (the console cannot
// import the marketplace plugin's model — scope:app may not reach aglyn:addons).
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

/**
 * One verifier finding as the publish API returns it (AGL-1091). Declared
 * locally rather than imported: the shared type lives in the server barrel,
 * which carries the parser this form must never ship to a browser.
 */
interface PublishProblem {
  level?: string
  message: string
  /** Which check produced it (AGL-1087) — absent on older responses. */
  check?: string
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

// Scoped per listing (AGL-1008): an update draft and a new-listing draft
// are different submissions, and sharing one key would let a half-written
// update reappear on top of a first publish.
const draftKey = (orgId: string, listingId?: string) =>
  `aglyn.publish-plugin.draft.${orgId}${listingId ? `.${listingId}` : ''}`

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
function readDraft(orgId: string, listingId?: string): PublishDraft {
  if (typeof window === 'undefined' || !orgId) return EMPTY_DRAFT
  try {
    const stored = window.localStorage.getItem(draftKey(orgId, listingId))
    if (!stored) return EMPTY_DRAFT
    return { ...EMPTY_DRAFT, ...(JSON.parse(stored) as Partial<PublishDraft>) }
  } catch {
    // A corrupt draft is not worth failing the page over.
    return EMPTY_DRAFT
  }
}

/**
 * Fill an update's form from the listing it is bound to (AGL-1008).
 *
 * A saved draft wins over the listing on every field: the listing is where
 * you START from, and overwriting an edit someone made and reloaded away
 * from would be the same data loss the draft exists to prevent.
 *
 * `changelog` is deliberately never seeded. It is the one field that
 * describes THIS version, and carrying the previous version's text forward
 * is how a changelog ends up describing a release it has nothing to do
 * with — which the AGL-969 attestation then asks the publisher to confirm.
 */
function seedDraft(
  draft: PublishDraft,
  listing: UpdateTargetListing | null | undefined,
): PublishDraft {
  if (!listing?.$id) return draft
  const seeded = { ...draft }
  const carry = <K extends keyof PublishDraft>(
    key: K,
    value: string | undefined,
  ) => {
    if (seeded[key] === EMPTY_DRAFT[key] && value) {
      seeded[key] = value as PublishDraft[K]
    }
  }
  carry('displayName', listing.displayName)
  carry('description', listing.description)
  carry('category', listing.categories?.[0] ?? listing.category)
  carry('readme', listing.readme)
  carry('license', listing.license)
  carry('repositoryUrl', listing.repositoryUrl)
  if (seeded.priceUsd === EMPTY_DRAFT.priceUsd && listing.priceUsd) {
    seeded.priceUsd = String(listing.priceUsd)
  }
  // Visibility is set on FIRST publish only — the server ignores it on a
  // version bump — so reflect what the listing actually is rather than
  // offering a choice that would be silently discarded.
  if (listing.visibility === 'private') seeded.visibility = 'private'
  return seeded
}

/**
 * Whether a stored draft is worth telling anyone about.
 *
 * The persist effect runs on mount, so an untouched form writes its
 * starting state straight back — and without this the NEXT first visit
 * would announce "picked up where you left off" over a form nobody had
 * typed in. A restore notice that fires when nothing was restored is how a
 * publisher learns to ignore it, which is expensive on the one visit it
 * matters.
 *
 * Compared against the BASELINE rather than the empty draft: on an update
 * the baseline is the listing's own content (AGL-1008), so an untouched
 * update form is not a resumed one.
 */
function draftDiffersFrom(
  draft: Partial<PublishDraft>,
  baseline: PublishDraft,
): boolean {
  return (Object.keys(EMPTY_DRAFT) as Array<keyof PublishDraft>).some((key) => {
    const value = draft[key]
    if (value === undefined) return false
    if (Array.isArray(value)) {
      const other = baseline[key]
      return (
        !Array.isArray(other) ||
        value.length !== other.length ||
        value.some((entry, index) => entry !== other[index])
      )
    }
    return value !== baseline[key]
  })
}

/** The listing an update is bound to (AGL-1008), as the console reads it. */
export interface UpdateTargetListing {
  $id: string
  displayName?: string
  pluginId?: string
  latestVersion?: string | number
  latestApprovedVersion?: string | number
  description?: string
  category?: string
  categories?: string[]
  readme?: string
  license?: string
  repositoryUrl?: string
  priceUsd?: number
  visibility?: string
}

export interface PublishPluginFormProps {
  orgId: string
  orgSlug: string
  /**
   * Set when publishing a NEW VERSION of an existing listing (AGL-1008).
   * The server still decides whether a submission is an update, from
   * `profileId` + the manifest id — this only pre-binds the form so the
   * publisher is not retyping a listing they already own, and so the page
   * can say what is about to happen.
   */
  listing?: UpdateTargetListing | null
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
 * `/api/marketplace/publish-plugin`. What changed is the container, and what
 * the container makes possible — sections, a draft that survives a reload,
 * server problems shown against the field that caused them, and somewhere
 * to go afterwards.
 */
export function PublishPluginForm(props: PublishPluginFormProps) {
  const { orgId, orgSlug, listing } = props
  const isUpdate = Boolean(listing?.$id)
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
  // What an untouched form looks like: empty for a first publish, the
  // listing's own content for an update (AGL-1008).
  const baseline = seedDraft(EMPTY_DRAFT, listing)
  const [draft, setDraft] = useState<PublishDraft>(() =>
    seedDraft(readDraft(orgId, listing?.$id), listing),
  )
  const [draftRestored, setDraftRestored] = useState(() =>
    draftDiffersFrom(
      seedDraft(readDraft(orgId, listing?.$id), listing),
      seedDraft(EMPTY_DRAFT, listing),
    ),
  )

  // Server-side problems, held against the field that caused them (AGL-1078)
  // instead of thrown at a snackbar that is gone before it is read. Cleared
  // on every submit so a fixed problem stops being shown as one.
  //
  // Objects, not strings (AGL-1091): the verifier has always answered with
  // `{level, message, check}` and this held `string[]`, so rendering a
  // rejection threw "objects are not valid as a React child" and the error
  // boundary ate the very card that was supposed to explain the rejection.
  // Normalized on arrival so a plain string from anywhere else still reads.
  const [problems, setProblems] = useState<PublishProblem[]>([])
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
      window.localStorage.setItem(
        draftKey(orgId, listing?.$id),
        JSON.stringify(draft),
      )
    } catch {
      // Storage full or blocked — the form still works, it just won't survive.
    }
  }, [orgId, listing?.$id, draft])

  const clearDraft = useCallback(() => {
    try {
      window.localStorage.removeItem(draftKey(orgId, listing?.$id))
    } catch {
      // Nothing to do; the next publish overwrites it anyway.
    }
  }, [orgId, listing?.$id])

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
   * On a first publish the changelog item is `updateOnly` and this form
   * genuinely cannot know whether the manifest id already has a listing —
   * the server answers that and names it in a 428. Demanding a changelog
   * attestation from a first-time publisher would be the worse failure: an
   * item that does not apply teaches people to tick without reading.
   *
   * Bound to a listing (AGL-1008) we DO know, so the update-only item is
   * asked here rather than arriving as a refusal after the upload.
   */
  const unattested = requiredAttestationIds(isUpdate).filter(
    (id) => !draft.attested.includes(id),
  )
  const unfilledSubjects = missingAttestationSubjects(
    { repositoryUrl: draft.repositoryUrl },
    isUpdate,
  )
  const repositoryInvalid =
    Boolean(draft.repositoryUrl.trim()) && !isHttpsUrl(draft.repositoryUrl)

  /**
   * The manifest id typed or pasted so far, if it parses.
   *
   * Only used to catch the one way a pre-bound update silently isn't one:
   * the server decides update-vs-new from `profileId` + the manifest id, so
   * a bundle whose id does not match this listing creates a SECOND listing
   * while the page says "new version". Cheap to notice here; impossible to
   * undo afterwards, because a published version is immutable.
   */
  const typedManifestId = (() => {
    const raw = draft.manifestText.trim()
    if (!raw) return ''
    try {
      const parsed = JSON.parse(raw) as { id?: unknown }
      return typeof parsed?.id === 'string' ? parsed.id : ''
    } catch {
      return ''
    }
  })()
  const manifestIdMismatch = Boolean(
    isUpdate && typedManifestId && listing?.pluginId &&
      typedManifestId !== listing.pluginId,
  )

  const liveVersion = String(
    listing?.latestApprovedVersion ?? listing?.latestVersion ?? '',
  )

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
      const response = await fetch('/api/marketplace/publish-plugin', {
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
        if (Array.isArray(payload?.problems)) {
          setProblems(
            payload.problems.map((problem: unknown) =>
              typeof problem === 'string'
                ? { message: problem }
                : {
                    level: String(
                      (problem as PublishProblem)?.level ?? 'error',
                    ),
                    message: String((problem as PublishProblem)?.message ?? ''),
                    check: (problem as PublishProblem)?.check
                      ? String((problem as PublishProblem).check)
                      : undefined,
                  },
            ),
          )
        }
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
    repositoryInvalid ||
    manifestIdMismatch

  return (
    <Stack spacing={2}>
      {isUpdate ? (
        /* AGL-1008. The mechanism was always right — same profileId plus
           manifest id bumps the listing, the new version enters review as
           pending, and the approved one keeps installing (AGL-966). The UI
           never told that story, so updating read like creating a second
           listing. */
        <Alert severity="info">
          <Typography variant="subtitle2">
            {`New version of ${listing?.displayName ?? 'your plugin'}`}
          </Typography>
          <Typography variant="caption" component="div">
            {liveVersion
              ? `v${liveVersion} is what installs today. It keeps installing ` +
                'until a reviewer approves this one — nobody is upgraded ' +
                'onto unreviewed code, and nothing you publish here can ' +
                'change a version already installed.'
              : 'This version enters review. Nothing installs until a ' +
                'reviewer approves it.'}
          </Typography>
        </Alert>
      ) : (
        <Alert severity="info">
          {'Plugins publish sandboxed — they run isolated and can’t touch ' +
            'site data directly. A reviewer verifies and signs yours before ' +
            'it can run trusted.'}
        </Alert>
      )}

      {manifestIdMismatch ? (
        <Alert severity="warning">
          {`This manifest says "${typedManifestId}", but ${
            listing?.displayName ?? 'this listing'
          } publishes "${listing?.pluginId}". Publishing it would create a ` +
            'separate new listing rather than a new version of this one.'}
        </Alert>
      ) : null}

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
        header={isUpdate ? 'The new bundle and manifest' : 'Bundle and manifest'}
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
                'One self-contained bundle. It’s parsed and checked before ' +
                  'publishing — forbidden APIs, size, and every network ' +
                  'call against the origins your manifest declares.'}
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
            <Alert
              severity={
                problems.some((problem) => problem.level !== 'warning')
                  ? 'error'
                  : 'warning'
              }
            >
              <Typography variant="subtitle2">
                {problems.some((problem) => problem.level !== 'warning')
                  ? 'Bundle failed verification'
                  : 'Bundle verified, with things to check'}
              </Typography>
              <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                {problems.map((problem, index) => (
                  <li key={`${problem.check ?? 'problem'}-${index}`}>
                    <Typography variant="caption">
                      {problem.check ? `${problem.check}: ` : ''}
                      {problem.message}
                    </Typography>
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
              isUpdate
                ? 'The field that matters most on an update. Two audiences: ' +
                  'the reviewer, comparing these bytes against ' +
                  (liveVersion ? `v${liveVersion}` : 'the last approved ' +
                    'version') +
                  ', and every installer deciding whether to move off the ' +
                  'version they are running.'
                : 'Two audiences: the reviewer, comparing this version ' +
                  'against the last approved one, and every installer who ' +
                  'reads it on your listing’s changelog tab before ' +
                  'updating. On a first version there is nothing to compare ' +
                  'against — say what the plugin does instead, or leave it.'
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
            // Set on FIRST publish only — the server ignores it on a version
            // bump (AGL-968), so offering the choice here would be a control
            // that silently does nothing. Change it from the listing.
            disabled={isUpdate}
            onChange={(event) =>
              set('visibility')(event.target.value as 'public' | 'private')
            }
            size="small"
            helperText={
              isUpdate
                ? 'Set when the listing was created. Change it from the ' +
                  'listing — a new version never changes who can install it.'
                :
              draft.visibility === 'private'
                  ? 'Private plugins take the same review path — same ' +
                    'queue, same checklist, same verifier, same signature ' +
                    'for realm trust. They are never listed in the ' +
                    'marketplace, and only your sites can install them.'
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
          color="primary"
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
            : isUpdate
              ? 'Publish new version'
            : draft.visibility === 'private'
              ? 'Publish privately'
              : 'Publish plugin'}
        </Button>
        <Button
          disabled={busy}
          onClick={() => {
            clearDraft()
            setDraft(baseline)
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
          // A reference, not the origin-absolute CDN URL (AGL-1705) — the
          // same switch the listing detail editor's README body makes, and
          // for the reason established there: this markdown renders only in
          // the console, through the one `marketplaceListing` slot, so
          // nothing was relying on the baked-in origin. `?? mediaSrc` keeps
          // the free-tier fallback, where no `cdnPath` is minted.
          const src = mediaNodeSrc(media ?? {}) ?? mediaSrc(media ?? {})
          if (src) readmeEditorRef.current?.insertImage('', src)
        }}
      />
    </Stack>
  )
}

PublishPluginForm.displayName = 'PublishPluginForm'

export default PublishPluginForm
