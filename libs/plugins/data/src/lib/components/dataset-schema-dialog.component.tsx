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

import {
  getCustomFieldType,
  listCustomFieldTypes,
  describeSharing,
  narrowsScope,
  scopeSharingOf,
  sharingCovers,
  sharingFromChoice,
  storedScope,
  visibleToHost,
} from '@aglyn/aglyn'
import { useConfirmationContext } from '@aglyn/shared-ui-jsx'
import {
  SiteSharingField,
  type SiteSharingValue,
} from '@aglyn/shared-ui-jsx/components/site-sharing-field.component'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Button,
  Checkbox,
  Alert,
  Box,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { doc, updateDoc } from 'firebase/firestore'
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import {
  useFirestore,
  useOrgDataScope,
  useScopeTokens,
  useUser,
  writeGuardedBySeed,
  type ListenHandle,
} from '@aglyn/tenant-feature-instance'
import { DATASET_AUTHORABLE_FIELD_TYPES, DATASET_FIELD_TYPES, DATASET_FIELD_TYPE_LABELS, type DatasetFieldDefinition, type DatasetFieldType, type DatasetModel, effectiveDatasetModel } from '../model/dataset-models'
import { datasetDisplayName, datasetNameLower, defaultDatasetFieldId, validateDatasetFieldId } from '../model/datasets'
import { RECORD_PAGE_ADDRESS_FIELD_TYPE, isRecordAddressField } from '../record-pages/record-pages'
import { useOrgSites } from './use-org-sites'
import { type DatasetRailEntry, datasetPickerLabelsOf } from '../model/dataset-rail'

/** Types surfaced in the picker; the rest exist for compat, not authoring. */
const AUTHORABLE_TYPES = DATASET_AUTHORABLE_FIELD_TYPES

export interface DatasetSchemaDialogProps {
  /** Host context; resolves the owning org for the data scope. */
  hostId?: string
  /** Direct org scope (AGL-239): wins over `hostId` resolution when set. */
  orgId?: string
  dataset: {
    $id: string
    displayName?: string
    fields?: string[]
    model?: DatasetModel
    names?: { singular?: string; plural?: string }
  } | null
  /** All host collections, for reference-field target pickers (AGL-180). */
  datasets?: Array<{
    $id: string
    displayName?: string
    fields?: string[]
    model?: DatasetModel
  }>
  recordCount: number
  /**
   * The listener that produced `dataset` has NOT been confirmed by the
   * server (AGL-1358). Required rather than optional on purpose: the
   * listener lives in the parent card, so this dialog cannot compute the
   * verdict, and an optional prop a caller forgets is a guard that is off
   * while looking present — which is exactly how AGL-1356 stayed open.
   */
  seedFromCache: boolean
  /** That listener FAILED (`status === 'error'`). */
  seedUnreadable?: boolean
  /** That listener, so a save waits on that read alone (AGL-4135). */
  seedListen?: ListenHandle | null
  /**
   * Whether this member may change who the dataset is shared with: "Manage
   * data" with every site in reach. A site's verdict writes the dataset and never
   * moves it, so someone it admits reads the sharing instead (AGL-4047).
   */
  canChangeSharing?: boolean
  /**
   * Why this member may change who the dataset is shared with and nothing else
   * here, or absent where they may change it all (AGL-4047): a site that narrows
   * them takes the dataset's schema and records, and sharing is not among those.
   * The schema shows switched off, with this reason, and a save writes the
   * sharing alone.
   */
  sharingOnlyReason?: string
  onClose: () => void
}

/** The dialog's schema controls, switched off together where only the sharing is this member's. */
function SchemaControls(props: { locked: boolean; children: ReactNode }) {
  return props.locked ? (
    <Box component="fieldset" disabled sx={{ border: 0, m: 0, p: 0, minWidth: 0 }}>
      {props.children}
    </Box>
  ) : (
    <>{props.children}</>
  )
}

/**
 * How a dataset is shared, as the choice the sharing field edits, or null where
 * it stores no sharing (AGL-1484). The seed and the save both read it from here,
 * so a dialog nobody touched compares equal to its own document and writes none.
 */
function sharingChoiceOf(dataset: unknown): SiteSharingValue | null {
  const sharing = scopeSharingOf(dataset as Record<string, unknown> | null)
  if (sharing.mode === 'all') return { mode: 'all' }
  if (sharing.mode === 'selected') return { mode: 'selected', hostIds: sharing.hostIds }
  if (sharing.mode === 'allExcept') return { mode: 'allExcept', exceptHostIds: sharing.exceptHostIds }
  return null
}

/** Two choices compare by what they pick, in any order. */
function sharingChoiceKey(choice: SiteSharingValue | null): string {
  if (!choice) return 'unset'
  if (choice.mode === 'all') return 'all'
  const picked = choice.mode === 'selected' ? choice.hostIds : choice.exceptHostIds
  return `${choice.mode}:${[...picked].sort().join(',')}`
}

/**
 * Model builder (AGL-178): edits the AGL-177 typed model on a dataset —
 * singular/plural display names (dod.ts Schema.Name), add/edit/remove/
 * reorder fields, per-field type/required/default/description/validation.
 * Schema-change policies (documented per the issue): type changes never
 * rewrite documents — non-conforming values surface in the editor when it
 * validates (AGL-179); removed fields leave orphaned values that strip
 * lazily on next document save; fieldIds are stable keys — only display
 * names rename.
 */
export function DatasetSchemaDialog(props: DatasetSchemaDialogProps) {
  const {
    hostId,
    dataset,
    datasets,
    recordCount,
    seedFromCache,
    seedUnreadable,
    seedListen,
    canChangeSharing = true,
    sharingOnlyReason,
    onClose,
  } = props
  // Org-shared data root (AGL-237/239). Null until the async org lookup
  // settles (AGL-1061), and for a host with no owning org. Saving is held
  // on it rather than redirected: the host path this used to fall back to
  // is now denied by the rules outright (AGL-1050), so a save there would
  // fail loudly instead of quietly — but it should not be attempted at all.
  const { scope: dataScope, orgId } = useOrgDataScope({
    hostId,
    orgId: props.orgId,
  })
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()

  // Sharing scope (AGL-1044) — org datasets only; the legacy host path is
  // site-private by construction.
  // `orgWide` reads TRUE while the member doc loads (AGL-1047), which would
  // offer a scoped collaborator the sharing field for a beat before replacing
  // it with the read-only summary — and offering a control the AGL-1041
  // rules will reject is the thing the branch below exists to avoid. Hold
  // the whole block until `loaded` rather than flash the wrong one.
  const { orgWide: viewerOrgWide, loaded: scopeLoaded } = useScopeTokens(
    orgId ?? undefined,
  )
  // Sites in this org, for naming what a narrowing would cost: the Data
  // card's own query (`useOrgSites`), so the two share one listener.
  const { sites: orgHostList, ready: sitesReady, hostNames } = useOrgSites(orgId)
  const { data: user } = useUser()
  const sharingSites = useMemo(
    () => orgHostList.map((host) => ({ id: host.$id, name: host.name ?? host.subdomain ?? host.$id })),
    [orgHostList],
  )
  /**
   * Who this dataset is shared with, as edited here. Null while the dataset
   * stores NO scope (AGL-1484) — as opposed to storing `['org']`.
   *
   * The dialog used to render the two identically, which for a dataset is a
   * worse lie than it was for a media file: `orgs/{orgId}/datasets` is read
   * with `array-contains-any` in `resolve-dataset.ts` and in the console's
   * own `organizations.ts`, so an unstamped dataset is matched by no reader
   * in the product. It renders on no site and is missing from the reference
   * cards even for an org-wide member — while this control said "All sites".
   */
  const [sharing, setSharing] = useState<SiteSharingValue | null>(null)
  const scopeUnset = sharing === null
  /**
   * What the choice would write, or why it cannot be. The same answer the
   * `set-sharing` route gives from the workspace's sites, which it reads for
   * itself: the sites a choice leaves out stay known here even where this member
   * can't name them, so they aren't taken for sites that are gone.
   */
  const sharingDraft = useMemo(() => {
    if (!sharing) return null
    const leftOut = sharing.mode === 'allExcept' ? sharing.exceptHostIds : []
    return sharingFromChoice(sharing, [...orgHostList.map((host) => host.$id), ...leftOut])
  }, [sharing, orgHostList])
  // Nothing to say about leaving sites out until the sites have been read.
  const sharingProblem = sharing?.mode !== 'allExcept' || sitesReady ? (sharingDraft?.problem ?? null) : null
  /** The dataset as this choice would leave it, for what depends on where it is. */
  const sharingPreview = useMemo(() => sharingDraft?.fields ?? { visibleTo: [] as string[] }, [sharingDraft])

  const [model, setModel] = useState<DatasetModel>({ fields: {}, order: [] })
  const [names, setNames] = useState<{ singular: string; plural: string }>({
    singular: '',
    plural: '',
  })
  useEffect(() => {
    if (!dataset) return
    // The fourth copy of the AGL-1466 substitution (AGL-1484), and the seed
    // half of it. Persisting the default on open was the other option and
    // AGL-1466 ruled it out: opening a dialog would write, the AGL-1042
    // rules refuse that write from anyone who is not org-wide, and it
    // repairs only what somebody happens to look at — a repair mechanism
    // wearing a UI. `handleSave` reads the SAME helper; see the note there
    // for why the pair is the safety property. The sharing is seeded by the
    // effect below.
    const effective = effectiveDatasetModel(dataset)
    setModel({
      fields: JSON.parse(JSON.stringify(effective.fields)),
      order: [...effective.order],
    })
    setNames({
      singular: dataset.names?.singular ?? '',
      plural: dataset.names?.plural ?? datasetDisplayName(dataset),
    })
  }, [dataset])
  /*
   * The sharing, seeded for this dataset and again only when its STORED
   * sharing moves, not on every snapshot of it (AGL-4047). A save writes the
   * schema before the route answers for the sharing, so a refused sharing
   * change still brings a fresh dataset, and seeding from it put the choice
   * back on the stored one while the refusal was said: the choice being
   * refused is the one to keep.
   */
  const storedSharing = useMemo(() => (dataset ? sharingChoiceOf(dataset) : null), [dataset])
  const storedSharingKey = dataset ? `${dataset.$id}|${sharingChoiceKey(storedSharing)}` : null
  useEffect(() => {
    if (storedSharingKey === null) return
    setSharing(storedSharing)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `storedSharing` is read through its key
  }, [storedSharingKey])

  // Per-field editor (null fieldId = new field). `idDraft`/`idTouched` back
  // the editable Reference ID (AGL-578): for a new field the draft follows
  // the display name until the user edits it; existing fields keep the id
  // frozen (idTouched=true, input disabled).
  const [fieldEditor, setFieldEditor] = useState<{
    fieldId: string | null
    definition: DatasetFieldDefinition
    optionsText: string
    idDraft: string
    idTouched: boolean
  } | null>(null)

  const openFieldEditor = useCallback(
    (fieldId: string | null) => () => {
      const definition: DatasetFieldDefinition = fieldId
        ? JSON.parse(JSON.stringify(model.fields[fieldId]))
        : { name: '', type: 'text' }
      setFieldEditor({
        fieldId,
        definition,
        optionsText: (definition.validation?.options ?? []).join(', '),
        idDraft: fieldId ?? '',
        idTouched: fieldId != null,
      })
    },
    [model],
  )

  const handleFieldSave = useCallback(async () => {
    if (!fieldEditor) return
    const definition = { ...fieldEditor.definition }
    if (!definition.name.trim()) return
    definition.name = definition.name.trim()
    // Descriptions (AGL-560) surface as hints wherever the field appears;
    // blank ones are dropped so the model doesn't accrete empty strings.
    const description = definition.description?.trim()
    if (description) definition.description = description
    else delete definition.description
    const options = fieldEditor.optionsText
      .split(',')
      .map((option) => option.trim())
      .filter(Boolean)
    definition.validation = {
      ...(definition.validation ?? {}),
      ...(options.length ? { options } : {}),
    }
    if (!options.length) delete definition.validation.options
    if (!Object.keys(definition.validation).length) delete definition.validation

    let fieldId = fieldEditor.fieldId
    if (!fieldId) {
      // New field: the reference id comes from the (editable) draft, which
      // defaulted from the display name. Validate before it becomes a key.
      const id = fieldEditor.idDraft.trim()
      const idError = validateDatasetFieldId(
        id,
        new Set(model.order.map((existing) => existing.toLowerCase())),
      )
      if (idError) {
        return void enqueueSnackbar(idError, {
          variant: 'warning',
          persist: false,
        })
      }
      fieldId = id
    } else if (
      recordCount > 0 &&
      model.fields[fieldId] &&
      model.fields[fieldId].type !== definition.type
    ) {
      // Documented policy: changing a type never rewrites documents;
      // existing values that no longer conform get flagged when edited.
      const confirmed = await confirm({
        title: 'Change field type?',
        description:
          `${recordCount} document${recordCount === 1 ? '' : 's'} exist. ` +
          'Stored values are not rewritten — ones that no longer match ' +
          `"${DATASET_FIELD_TYPE_LABELS[definition.type]}" will be flagged ` +
          'when documents are next edited.',
        confirmationText: 'Change type',
      })
        .then(() => true)
        .catch(() => false)
      if (!confirmed) return
    }
    setModel((prev) => ({
      fields: { ...prev.fields, [fieldId as string]: definition },
      order: prev.order.includes(fieldId as string)
        ? prev.order
        : [...prev.order, fieldId as string],
    }))
    setFieldEditor(null)
  }, [fieldEditor, model, recordCount, confirm, enqueueSnackbar])

  const handleFieldRemove = useCallback(
    (fieldId: string) => async () => {
      const confirmed = await confirm({
        title: `Remove field "${model.fields[fieldId]?.name ?? fieldId}"?`,
        description:
          'Existing documents keep their stored value until they are next ' +
          'saved (it is stripped then). Bindings using this field stop ' +
          'resolving.',
        confirmationText: 'Remove',
        confirmationButtonProps: { color: 'error' },
      })
        .then(() => true)
        .catch(() => false)
      if (!confirmed) return
      setModel((prev) => {
        const fields = { ...prev.fields }
        delete fields[fieldId]
        return { fields, order: prev.order.filter((id) => id !== fieldId) }
      })
    },
    [model, confirm],
  )

  const moveField = useCallback(
    (fieldId: string, delta: number) => () =>
      setModel((prev) => {
        const index = prev.order.indexOf(fieldId)
        const target = index + delta
        if (index < 0 || target < 0 || target >= prev.order.length) return prev
        const order = [...prev.order]
        order.splice(index, 1)
        order.splice(target, 0, fieldId)
        return { ...prev, order }
      }),
    [],
  )

  const handleSave = useCallback(async () => {
    if (!dataset || !dataScope) return
    /**
     * What the document actually carries, nothing when it carries nothing
     * (AGL-1484) — matching the seed above, through the same helper.
     *
     * The pairing is the whole safety property, not tidiness. Both sides
     * used to substitute `[ORG_SCOPE_TOKEN]`, so an unset dataset compared
     * equal to itself and merely OPENING the dialog wrote nothing; the
     * damage was confined to the screen. Correcting the seed alone would
     * make `scopeChanged` true for every unset dataset the moment its
     * dialog opened, turning a lie on screen into a write nobody asked for
     * — one the AGL-1041 rules then reject for any member who is not
     * org-wide, failing the WHOLE schema save with it.
     *
     * Nothing is also the honest previous value in the other direction: a
     * deliberate save of exactly `['org']` on an unset dataset used to
     * compare equal to the default and be dropped, and that is the one save
     * an unstamped dataset most needs to land.
     */
    const scopeChanged = sharingChoiceKey(sharingChoiceOf(dataset)) !== sharingChoiceKey(sharing)
    /**
     * The sharing this save writes, or null when it writes none.
     *
     * Only an org-wide member may change it — the route and the AGL-1041 rules
     * refuse anyone else, and it is written through the route because a marker
     * is the server's alone (AGL-4047).
     *
     * A choice that cannot be stored — "Selected sites" with no site picked, or
     * more sites than one query can match, or nothing left out, or everything —
     * refuses the save rather than substituting a scope: the org token would
     * share the collection with every site, and anything narrower would drop
     * sites somebody picked.
     */
    const sharingWrite = orgId && viewerOrgWide && canChangeSharing && scopeChanged ? sharing : null
    if (sharingWrite && sharingDraft?.problem) {
      return void enqueueSnackbar(sharingDraft.problem, {
        variant: 'warning',
        persist: false,
      })
    }
    const previousScope: string[] = storedScope((dataset as { visibleTo?: string[] }).visibleTo) ?? []
    const nextScope: readonly string[] = sharingPreview.visibleTo
    if (scopeChanged && narrowsScope(previousScope, nextScope)) {
      // Narrowing takes a dataset away from sites whose pages may bind it,
      // and a repeatable bound to a dataset it can no longer see renders
      // nothing (AGL-1039). Name the cost before paying it.
      const losing = orgHostList
        .filter((host) => visibleToHost(previousScope, host.$id))
        .filter((host) => !visibleToHost(nextScope, host.$id))
        .map((host) => host.name ?? host.subdomain ?? host.$id)
      const proceed = await confirm({
        title: 'Limit which sites can use this collection?',
        description: losing.length
          ? `${losing.join(', ')} will stop seeing this collection. Pages ` +
            'that repeat over it will render nothing. No data is deleted.'
          : 'No site loses access, so nothing breaks today.',
        confirmationText: 'Limit access',
      })
        .then(() => true)
        .catch(() => false)
      if (!proceed) return
    }
    // Nothing of theirs to write when the sharing did not move.
    if (sharingOnlyReason && !sharingWrite) return void onClose()
    if (!model.order.length) {
      return void enqueueSnackbar('A collection needs at least one field', {
        variant: 'warning',
        persist: false,
      })
    }
    /**
     * Refuse the write when the seeding listener is unconfirmed (AGL-1358).
     *
     * Everything below is seeded from `dataset` and written back whole, so
     * `updateDoc` field-level merging protects nothing — the untouched
     * fields are all in the payload. Two of them make a stale seed worse
     * than an inconvenience:
     *
     * - `visibleTo` is the AGL-1041/1042 scoping PREDICATE. Rewriting it
     *   from a cached seed re-exposes a collection that was narrowed, or
     *   hides one that was widened, and the confirmation above is computed
     *   against `previousScope` read from that same stale seed — so it does
     *   not even warn about the sites it is really taking access from.
     * - `model` is the entire schema. A cached seed reinstates fields that
     *   were deleted and drops fields that were added.
     *
     * The schema goes first, because who may write it depends on where the
     * dataset sits as it stands, the question the rule asks of this one save.
     */
    let sharingRefusal: string | null = null
    await writeGuardedBySeed(
      {
        subject: 'collection schema',
        unreadable: seedUnreadable,
        fromCache: seedFromCache,
        listen: seedListen,
      },
      async () => {
        if (!sharingOnlyReason) {
          await updateDoc(
            doc(firestore, dataScope[0], dataScope[1], 'datasets', dataset.$id),
            {
              model,
              names: {
                singular: names.singular.trim(),
                plural: names.plural.trim(),
              },
              // The name's search key moves with it (AGL-4047).
              ...(names.plural.trim()
                ? {
                    displayName: names.plural.trim(),
                    nameLower: datasetNameLower(names.plural),
                  }
                : {}),
              // v1 compat: keep the flat column list mirroring the model order
              // so unmigrated consumers (AGL-103 bindings) keep working.
              fields: model.order,
            },
          )
        }
        if (sharingWrite) {
          const response = await authorizedFetch(user, '/api/orgs/datasets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              orgId,
              action: 'set-sharing',
              datasetId: dataset.$id,
              choice: sharingWrite,
            }),
          })
          if (!response.ok) {
            const payload = await response.json().catch(() => ({}))
            sharingRefusal = String(payload?.error ?? 'The sharing could not be changed.')
          }
        }
      },
    )
      .then((result) => {
        // A refusal leaves the dialog open with the edited schema intact.
        if (!result.ok) {
          return void enqueueSnackbar(result.message, {
            variant: 'warning',
            persist: false,
          })
        }
        if (sharingRefusal) {
          return void enqueueSnackbar(
            sharingOnlyReason ? sharingRefusal : `Schema saved. Its sharing didn’t change: ${sharingRefusal}`,
            { variant: 'warning', persist: false },
          )
        }
        enqueueSnackbar(sharingOnlyReason ? 'Sharing saved' : 'Schema saved', { variant: 'success', persist: false })
        onClose()
      })
      .catch(() =>
        enqueueSnackbar('An error has occurred', { variant: 'error' }),
      )
  }, [
    dataset,
    model,
    names,
    sharing,
    sharingDraft,
    sharingPreview,
    user,
    viewerOrgWide,
    canChangeSharing,
    sharingOnlyReason,
    orgHostList,
    confirm,
    firestore,
    dataScope,
    orgId,
    seedFromCache,
    seedUnreadable,
    seedListen,
    enqueueSnackbar,
    onClose,
  ])

  const editorDefinition = fieldEditor?.definition
  // Reference ID editing (AGL-578): the id is editable only while creating a
  // field; live-validate the draft so the input and Save button can react.
  const isNewField = fieldEditor != null && fieldEditor.fieldId == null
  const fieldIdError =
    fieldEditor && isNewField
      ? validateDatasetFieldId(
          fieldEditor.idDraft,
          new Set(model.order.map((id) => id.toLowerCase())),
        )
      : null

  return (
    <>
      <Dialog
        open={Boolean(dataset)}
        onClose={onClose}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{`Schema — ${datasetDisplayName(dataset)}`}</DialogTitle>
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
        >
          {sharingOnlyReason ? <Alert severity="info">{sharingOnlyReason}</Alert> : null}
          <SchemaControls locked={Boolean(sharingOnlyReason)}>
          <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
            <TextField
              size="small"
              label="Singular name"
              value={names.singular}
              onChange={(event) =>
                setNames((prev) => ({ ...prev, singular: event.target.value }))
              }
              helperText="e.g. Product"
            />
            <TextField
              size="small"
              label="Plural name"
              value={names.plural}
              onChange={(event) =>
                setNames((prev) => ({ ...prev, plural: event.target.value }))
              }
              helperText="e.g. Products (shown as the title)"
            />
          </Stack>
          </SchemaControls>
          {/* Sharing scope (AGL-1044). Org datasets only; the legacy host
              path is site-private already. Read-only for scoped members —
              the rules deny them the write and it would fail the whole
              document, so a control that always errors is worse than the
              value. */}
          {orgId ? (
            <Stack spacing={0.5}>
              <Typography variant="caption" color="text.secondary">
                {'Shared with'}
              </Typography>
              {!scopeLoaded ? (
                <Typography variant="body2" color="text.secondary">
                  {'Checking your access…'}
                </Typography>
              ) : viewerOrgWide && canChangeSharing ? (
                <>
                  {/*
                    The state this dialog used to hide (AGL-1484), in the
                    words the folder dialog and the media drawer already
                    use. It costs a sentence, and it is the difference
                    between reading "All sites" off a collection no site can
                    see and being told to choose. No choice shows as picked
                    until someone picks one.
                  */}
                  {scopeUnset ? (
                    <Alert severity="warning">
                      {'This collection has never been shared. Nothing is ' +
                        'stored, so it is hidden from every site and any ' +
                        'page repeating over it renders nothing. Choose who ' +
                        'it is shared with to fix that.'}
                    </Alert>
                  ) : null}
                  <SiteSharingField
                    value={sharing}
                    onChange={setSharing}
                    sites={sharingSites}
                    sitesReady={sitesReady}
                    problem={sharingProblem}
                  />
                  {/* Says what sharing does NOT do, which is the part
                      people get wrong (AGL-1046). It controls which sites
                      may use the data; it is not a permission on the rows
                      a published page already renders. */}
                  <Typography variant="caption" color="text.secondary">
                    {
                      'Sites you exclude cannot see or use this dataset — in the console or on their pages.'
                    }
                  </Typography>
                </>
              ) : (
                <Typography variant="body2">
                  {/*
                    A scoped collaborator cannot fix this — the AGL-1041
                    rules deny them the write — but they are the ones who
                    notice a repeatable rendering nothing on their site, so
                    they get the reason rather than `describeScope`'s "No
                    sites", which reads like a setting somebody chose
                    (AGL-1484).
                  */}
                  {scopeUnset
                    ? 'Never shared — hidden from every site'
                    : describeSharing(
                        dataset as Record<string, unknown> | null,
                        Object.fromEntries(
                          sharingSites.map((site) => [site.id, site.name]),
                        ),
                      )}
                </Typography>
              )}
            </Stack>
          ) : null}
          <SchemaControls locked={Boolean(sharingOnlyReason)}>
          <Stack spacing={0.5}>
            {model.order.map((fieldId, index) => {
              const field = model.fields[fieldId]
              if (!field) return null
              return (
                <Stack
                  key={fieldId}
                  direction="row"
                  spacing={1}
                  sx={{
                    alignItems: 'center',
                    px: 1,
                    py: 0.5,
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 1,
                  }}
                >
                  <Stack sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" noWrap>
                      {field.name}
                      <Typography
                        component="span"
                        variant="caption"
                        color="text.secondary"
                      >
                        {` · ${fieldId}`}
                      </Typography>
                    </Typography>
                    {field.description ? (
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        noWrap
                      >
                        {field.description}
                      </Typography>
                    ) : null}
                  </Stack>
                  <Chip
                    size="small"
                    label={DATASET_FIELD_TYPE_LABELS[field.type] ?? field.type}
                  />
                  {field.required || field.validation?.required ? (
                    <Chip size="small" color="primary" label="required" />
                  ) : null}
                  <IconButton
                    size="small"
                    disabled={index === 0}
                    onClick={moveField(fieldId, -1)}
                    aria-label="Move up"
                  >
                    {'▲'}
                  </IconButton>
                  <IconButton
                    size="small"
                    disabled={index === model.order.length - 1}
                    onClick={moveField(fieldId, 1)}
                    aria-label="Move down"
                  >
                    {'▼'}
                  </IconButton>
                  <Button size="small" onClick={openFieldEditor(fieldId)}>
                    {'Edit'}
                  </Button>
                  <Button
                    size="small"
                    color="error"
                    onClick={handleFieldRemove(fieldId)}
                  >
                    {'Remove'}
                  </Button>
                </Stack>
              )
            })}
          </Stack>
          <Button
            size="small"
            variant="outlined"
            color="primary"
            onClick={openFieldEditor(null)}
            sx={{ alignSelf: 'flex-start' }}
          >
            {'Add field'}
          </Button>
          </SchemaControls>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{'Cancel'}</Button>
          {/* Held until the data scope resolves (AGL-1061) — a save in that
              window writes the schema to the legacy host path. */}
          <Button
            variant="contained"
            color="primary"
            disabled={!dataScope}
            onClick={handleSave}
          >
            {sharingOnlyReason ? 'Save sharing' : 'Save schema'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={Boolean(fieldEditor)}
        onClose={() => setFieldEditor(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>
          {fieldEditor?.fieldId ? 'Edit field' : 'New field'}
        </DialogTitle>
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
        >
          <TextField
            size="small"
            label="Display name"
            value={editorDefinition?.name ?? ''}
            autoFocus
            onChange={(event) => {
              const name = event.target.value
              setFieldEditor((prev) => {
                if (!prev) return prev
                const next = {
                  ...prev,
                  definition: { ...prev.definition, name },
                }
                // The reference id follows the display name until the user
                // edits it (new fields only) — AGL-578.
                if (prev.fieldId == null && !prev.idTouched) {
                  next.idDraft = defaultDatasetFieldId(
                    name,
                    new Set(model.order.map((id) => id.toLowerCase())),
                  )
                }
                return next
              })
            }}
            sx={{ mt: 1 }}
            helperText="Shown to people editing records and wherever the field appears"
          />
          <TextField
            size="small"
            label="Reference ID"
            value={
              isNewField
                ? (fieldEditor?.idDraft ?? '')
                : (fieldEditor?.fieldId ?? '')
            }
            disabled={!isNewField}
            onChange={(event) =>
              setFieldEditor((prev) =>
                prev
                  ? { ...prev, idDraft: event.target.value, idTouched: true }
                  : prev,
              )
            }
            error={Boolean(fieldIdError)}
            helperText={
              isNewField
                ? (fieldIdError ??
                  'Stable key used in bindings ({{item.id}}), forms, and imports. Auto-filled from the display name — edit to override. Fixed once the field is created.')
                : 'Reference IDs are stable keys and cannot change after creation'
            }
          />
          <TextField
            size="small"
            label="Description"
            multiline
            minRows={2}
            value={editorDefinition?.description ?? ''}
            onChange={(event) =>
              setFieldEditor((prev) =>
                prev
                  ? {
                      ...prev,
                      definition: {
                        ...prev.definition,
                        description: event.target.value,
                      },
                    }
                  : prev,
              )
            }
            helperText="What this field is for — shown as a hint wherever the field appears"
          />
          <TextField
            select
            size="small"
            label="Type"
            value={
              editorDefinition?.customType
                ? `custom:${editorDefinition.customType}`
                : (editorDefinition?.type ?? 'text')
            }
            onChange={(event) =>
              setFieldEditor((prev) => {
                if (!prev) return prev
                const selected = event.target.value
                // Custom field types (AGL-434): ride a base storage type
                // and stamp customType so the record editor + validators
                // pick up the plugin behavior.
                if (selected.startsWith('custom:')) {
                  const fieldType = getCustomFieldType(selected.slice(7))
                  if (!fieldType) return prev
                  return {
                    ...prev,
                    definition: {
                      ...prev.definition,
                      type: fieldType.baseType as DatasetFieldType,
                      customType: fieldType.name,
                    },
                  }
                }
                const definition = {
                  ...prev.definition,
                  type: selected as DatasetFieldType,
                }
                delete definition.customType
                return { ...prev, definition }
              })
            }
          >
            {(fieldEditor?.fieldId &&
            editorDefinition &&
            !AUTHORABLE_TYPES.includes(editorDefinition.type)
              ? DATASET_FIELD_TYPES
              : AUTHORABLE_TYPES
            ).map((type) => (
              <MenuItem key={type} value={type}>
                {DATASET_FIELD_TYPE_LABELS[type]}
              </MenuItem>
            ))}
            {listCustomFieldTypes().map((fieldType) => (
              <MenuItem
                key={`custom:${fieldType.name}`}
                value={`custom:${fieldType.name}`}
              >
                {`${fieldType.label} (${fieldType.pluginId})`}
              </MenuItem>
            ))}
          </TextField>
          {editorDefinition?.customType === RECORD_PAGE_ADDRESS_FIELD_TYPE ? (
            <TextField
              select
              size="small"
              label="Fill in from"
              value={editorDefinition.slugFrom ?? ''}
              onChange={(event) =>
                setFieldEditor((prev) => {
                  if (!prev) return prev
                  const definition = { ...prev.definition }
                  if (event.target.value) definition.slugFrom = event.target.value
                  else delete definition.slugFrom
                  return { ...prev, definition }
                })
              }
              helperText="An empty address fills in from this field once, and stays put when the record is renamed"
            >
              <MenuItem value="">Nothing — type each address</MenuItem>
              {model.order
                .filter(
                  (fieldId) =>
                    fieldId !== fieldEditor?.fieldId &&
                    model.fields[fieldId]?.type === 'text' &&
                    !isRecordAddressField(model.fields[fieldId]),
                )
                .map((fieldId) => (
                  <MenuItem key={fieldId} value={fieldId}>
                    {model.fields[fieldId]?.name ?? fieldId}
                  </MenuItem>
                ))}
            </TextField>
          ) : null}
          {editorDefinition?.type === 'reference' ? (
            <>
              <TextField
                select
                size="small"
                label="Target collection"
                value={editorDefinition?.reference?.datasetId ?? ''}
                onChange={(event) =>
                  setFieldEditor((prev) =>
                    prev
                      ? {
                          ...prev,
                          definition: {
                            ...prev.definition,
                            reference: {
                              ...(prev.definition.reference ?? {
                                datasetId: '',
                              }),
                              datasetId: event.target.value,
                            },
                          },
                        }
                      : prev,
                  )
                }
              >
                {(() => {
                  const targets = (datasets ?? [])
                  .filter((target) => target.$id !== dataset?.$id)
                  // Only targets this dataset's sites can actually resolve
                  // (AGL-1044). A reference to a dataset a site cannot see
                  // renders blank with nothing to say why, so an
                  // unresolvable target is not offered. The currently
                  // selected one always stays listed — otherwise changing
                  // scope would silently blank an existing field.
                  .filter(
                    (target) =>
                      target.$id ===
                        editorDefinition?.reference?.datasetId ||
                      sharingCovers(target as Record<string, unknown>, sharingPreview as Record<string, unknown>),
                  )
                  // Who a target is shared with only where two share a name (AGL-4047).
                  const labels = datasetPickerLabelsOf(targets as DatasetRailEntry[], hostNames)
                  return targets.map((target) => (
                    <MenuItem key={target.$id} value={target.$id}>
                      {labels[target.$id] || datasetDisplayName(target) || target.$id}
                    </MenuItem>
                  ))
                })()}
              </TextField>
              {(() => {
                // Flag an EXISTING reference that this dataset's scope has
                // outgrown — the field was valid when created and quietly
                // is not any more.
                const targetId = editorDefinition?.reference?.datasetId
                const target = (datasets ?? []).find((d) => d.$id === targetId)
                if (
                  !target ||
                  sharingCovers(target as Record<string, unknown>, sharingPreview as Record<string, unknown>)
                ) {
                  return null
                }
                return (
                  <Alert severity="warning">
                    {`"${datasetDisplayName(target) || target.$id}" is not shared with ` +
                      'every site this collection is. Those sites will show ' +
                      'this field blank. Widen its sharing, or narrow this ' +
                      "collection's."}
                  </Alert>
                )
              })()}
              <TextField
                select
                size="small"
                label="Display field"
                value={editorDefinition?.reference?.displayFieldId ?? ''}
                onChange={(event) =>
                  setFieldEditor((prev) =>
                    prev?.definition.reference
                      ? {
                          ...prev,
                          definition: {
                            ...prev.definition,
                            reference: {
                              ...prev.definition.reference,
                              displayFieldId: event.target.value,
                            },
                          },
                        }
                      : prev,
                  )
                }
                helperText="Shown in pickers and grid cells"
              >
                {effectiveDatasetModel(
                  (datasets ?? []).find(
                    (target) =>
                      target.$id === editorDefinition?.reference?.datasetId,
                  ) ?? {},
                ).order.map((targetFieldId) => (
                  <MenuItem key={targetFieldId} value={targetFieldId}>
                    {targetFieldId}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                size="small"
                label="When a referenced document is deleted"
                value={editorDefinition?.reference?.onDelete ?? 'setNull'}
                onChange={(event) =>
                  setFieldEditor((prev) =>
                    prev?.definition.reference
                      ? {
                          ...prev,
                          definition: {
                            ...prev.definition,
                            reference: {
                              ...prev.definition.reference,
                              onDelete: event.target.value as
                                | 'restrict'
                                | 'setNull',
                            },
                          },
                        }
                      : prev,
                  )
                }
              >
                <MenuItem value="setNull">{'Clear the reference'}</MenuItem>
                <MenuItem value="restrict">{'Block the delete'}</MenuItem>
              </TextField>
              <FormControlLabel
                control={
                  <Checkbox
                    size="small"
                    checked={Boolean(editorDefinition?.reference?.multiple)}
                    onChange={(event) =>
                      setFieldEditor((prev) =>
                        prev?.definition.reference
                          ? {
                              ...prev,
                              definition: {
                                ...prev.definition,
                                reference: {
                                  ...prev.definition.reference,
                                  multiple: event.target.checked,
                                },
                              },
                            }
                          : prev,
                      )
                    }
                  />
                }
                label="Allow multiple (many-to-many)"
              />
            </>
          ) : null}
          <FormControlLabel
            control={
              <Checkbox
                size="small"
                checked={Boolean(editorDefinition?.required)}
                onChange={(event) =>
                  setFieldEditor((prev) =>
                    prev
                      ? {
                          ...prev,
                          definition: {
                            ...prev.definition,
                            required: event.target.checked,
                          },
                        }
                      : prev,
                  )
                }
              />
            }
            label="Required"
          />
          <TextField
            size="small"
            label="Default value"
            value={String(editorDefinition?.default ?? '')}
            onChange={(event) =>
              setFieldEditor((prev) =>
                prev
                  ? {
                      ...prev,
                      definition: {
                        ...prev.definition,
                        ...(event.target.value
                          ? { default: event.target.value }
                          : { default: undefined }),
                      },
                    }
                  : prev,
              )
            }
            helperText="Pre-filled when creating documents"
          />
          {editorDefinition?.type === 'text' ? (
            <>
              <TextField
                size="small"
                label="Pattern (regex)"
                value={editorDefinition?.validation?.regex ?? ''}
                onChange={(event) =>
                  setFieldEditor((prev) =>
                    prev
                      ? {
                          ...prev,
                          definition: {
                            ...prev.definition,
                            validation: {
                              ...(prev.definition.validation ?? {}),
                              ...(event.target.value
                                ? { regex: event.target.value }
                                : { regex: undefined }),
                            },
                          },
                        }
                      : prev,
                  )
                }
              />
              <TextField
                size="small"
                label="Options"
                value={fieldEditor?.optionsText ?? ''}
                onChange={(event) =>
                  setFieldEditor((prev) =>
                    prev ? { ...prev, optionsText: event.target.value } : prev,
                  )
                }
                helperText="Comma-separated enum, e.g. basic, plus"
              />
            </>
          ) : null}
          {editorDefinition &&
          ['int32', 'int64', 'float', 'timestamp', 'text'].includes(
            editorDefinition.type,
          ) ? (
            <Stack direction="row" spacing={1}>
              {(['min', 'max'] as const).map((bound) => (
                <TextField
                  key={bound}
                  size="small"
                  type="number"
                  label={
                    editorDefinition.type === 'text'
                      ? `${bound === 'min' ? 'Min' : 'Max'} length`
                      : bound === 'min'
                        ? 'Min'
                        : 'Max'
                  }
                  value={editorDefinition.validation?.[bound] ?? ''}
                  onChange={(event) =>
                    setFieldEditor((prev) =>
                      prev
                        ? {
                            ...prev,
                            definition: {
                              ...prev.definition,
                              validation: {
                                ...(prev.definition.validation ?? {}),
                                ...(event.target.value === ''
                                  ? { [bound]: undefined }
                                  : { [bound]: Number(event.target.value) }),
                              },
                            },
                          }
                        : prev,
                    )
                  }
                />
              ))}
            </Stack>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setFieldEditor(null)}>{'Cancel'}</Button>
          <Button
            variant="contained"
            color="primary"
            disabled={!editorDefinition?.name.trim() || Boolean(fieldIdError)}
            onClick={handleFieldSave}
          >
            {fieldEditor?.fieldId ? 'Save field' : 'Add field'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
DatasetSchemaDialog.displayName = 'DatasetSchemaDialog'

export default DatasetSchemaDialog
