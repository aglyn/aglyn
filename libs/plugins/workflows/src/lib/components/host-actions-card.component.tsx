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
  ACTION_MAX_STEPS,
  type AglynOrgBilling,
  checkEntitlement,
  createResourceUid,
  CRM_ACTION_RECIPES,
  type CrmActionRecipe,
  type CrmActionRecipeId,
  ELEMENT_SCOPED_SITE_EVENTS,
  HOST_ACTION_STEP_LABELS,
  HOST_EVENT_TYPES,
  type HostAction,
  hostActionDocument,
  hostActionRecipeId,
  type HostActionStepType,
  hostEventLabel,
  hostEventPayloadHint,
  isSiteEventType,
  pluginDocsHelp,
  SITE_EVENT_TYPES,
  type TriggerCombinator,
  validateHostAction,
} from '@aglyn/aglyn'
import {
  automationPlaceholders,
  describeAutomationPlaceholder,
} from '@aglyn/aglyn/app-utils/automation-placeholders'
import { useConsoleWidgetSlot } from '@aglyn/aglyn/app-utils/console-widget-slot-context'
import type { ConsoleAutomationTarget } from '@aglyn/aglyn/plugin-manager/feature-plugins'
import { CardDisplay, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import { TABLE_PAGE_SIZE_DEFAULT } from '@aglyn/shared-ui-jsx/const/table-pagination'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { Timestamp } from '@aglyn/shared-util-timestamp'
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import {
  collection,
  doc,
  setDoc,
  updateDoc,
} from 'firebase/firestore'
import { useCallback, useMemo, useRef, useState } from 'react'
import {
  ceilingedWindow,
  collectionCeiling,
  useFirestore,
  useFirestoreCollection,
  useHostResourceApi,
  useUser,
  writeGuardedBySeed,
} from '@aglyn/tenant-feature-instance'
import { ACTION_TEST_RUN_API_ROUTE } from '../model/action-test-run'
import {
  AutomationStepFields,
  type AutomationStepKind,
  defaultStep,
} from './automation-step-fields.component'
import {
  conditionRowsFromTrigger,
  conditionsFromRows,
  type ConditionRowDraft,
  EMPTY_CONDITION_ROW,
  TriggerConditionRows,
} from './automation-trigger-conditions.component'
import HostRunHistoryCard from './host-run-history-card.component'
import {
  EDITOR_OPTION_CEILING,
  useAutomationStepPickers,
} from './use-automation-step-pickers'

const CUSTOM_EVENT_VALUE = '__custom__'

/**
 * How many action documents the card reads.
 *
 * A CEILING, not a page size — see the query, which explains why this one
 * collection cannot be sliced by the server without making the count beneath
 * the list a per-page number.
 *
 * `ACTIONS_MAX_PER_HOST` is 500, so the ceiling really can bite and the probe
 * beside it is what says when it has.
 */
const ACTION_CEILING = 100

interface ActionDraft extends HostAction {
  id: string | null
  /** Raw custom-event text when the trigger select is on "custom". */
  customEvent: string
  // Structured payload conditions (AGL-557), chainable with AND/OR
  // (AGL-565) — held as rows like the steps list; legacy
  // single-`condition` docs hydrate through normalizeTriggerConditions.
  conditionRows: ConditionRowDraft[]
  conditionCombinator: TriggerCombinator
  /**
   * The recipe this draft started from (AGL-2626), so the editor can say
   * so, and what Save writes back as the action's stamp (AGL-2639): null
   * for an action begun blank, and `undefined` for a stored action from
   * before the stamp existed — which Save leaves as it found it, so an
   * edit never turns "unknown" into "no recipe".
   */
  recipe: CrmActionRecipeId | null | undefined
}


/** Every Actions step, as the builder's "Do" picker offers it. */
const ACTION_STEP_KINDS: AutomationStepKind[] = Object.entries(
  HOST_ACTION_STEP_LABELS,
).map(([value, label]) => ({ value, label }))


/**
 * A stored action — or one a recipe just built — as the editor holds it.
 *
 * One conversion for both doors, because they must agree: an action that
 * round-trips through Edit and one a recipe hands over are the same shape
 * to the editor, and a field the Edit path hydrated that the recipe path
 * forgot would be a recipe whose conditions vanished on open. Site events
 * are first-class (AGL-256/266): their selector/threshold/path config is
 * kept through an edit. Structured conditions (AGL-557; chained AGL-565)
 * become rows; a legacy single-condition doc normalizes to one row.
 */
function draftFromAction(
  action: Record<string, any>,
  id: string | null,
): ActionDraft {
  const builtIn =
    HOST_EVENT_TYPES.includes(action.trigger?.event) ||
    isSiteEventType(String(action.trigger?.event ?? ''))
  return {
    id,
    name: action.name ?? '',
    trigger: {
      event: builtIn ? action.trigger.event : CUSTOM_EVENT_VALUE,
      filter: action.trigger?.filter ?? '',
      selector: action.trigger?.selector ?? '',
      threshold: action.trigger?.threshold,
      pathPattern: action.trigger?.pathPattern ?? '',
      oncePerVisitor: action.trigger?.oncePerVisitor === true,
      oncePerSession: action.trigger?.oncePerSession === true,
      everyTime: action.trigger?.everyTime === true,
      ...(Number(action.trigger?.cooldownMinutes) >= 1
        ? { cooldownMinutes: Number(action.trigger?.cooldownMinutes) }
        : {}),
    },
    steps: action.steps ?? [],
    enabled: action.enabled !== false,
    customEvent: builtIn ? '' : (action.trigger?.event ?? ''),
    conditionRows: conditionRowsFromTrigger(action.trigger),
    conditionCombinator: action.trigger?.combinator === 'or' ? 'or' : 'and',
    // A recipe stamps what it builds, and a stored action carries what it
    // was saved with — one reader for both doors, unknown kept unknown.
    recipe: hostActionRecipeId(action),
  }
}

/** A trigger bound to one element, which makes the row an interaction. */
const LEAF_SELECTOR = /^\[data-aglyn="leaf:.+"\]$/

/**
 * Actions builder (AGL-148): HubSpot-style enrollment — trigger event →
 * optional filter → ordered steps (run workflow, site alert, custom
 * event, dataset append). Runs server-side via runEventActions; paid
 * feature (`actions` flag, Pro+, `actionRunsPerMonth` metered).
 */
export function HostActionsCard(props: {
  hostId: string
  org?: Partial<AglynOrgBilling>
}) {
  const { hostId, org } = props
  // Org-shared data root (AGL-237). Null until the org lookup settles
  // (AGL-1061), and for a host with no owning org — the pre-migration host
  // path is gone (AGL-1050), so the dataset and list pickers stay empty
  // instead of offering rows from a path nothing else reads.
  const firestore = useFirestore()
  // Action creation is server-owned since AGL-2266 (the cap); every other
  // action write on this surface stays client-direct.
  const createResource = useHostResourceApi()
  // The caller's token, for the test run's console door.
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  /**
   * The shell's zone renderer, for what other plugins add to automations
   * (AGL-2919); `null` outside the console shell, where there is no workspace
   * to gate on.
   */
  const ExtensionZone = useConsoleWidgetSlot()

  const {
    data: actionDocs,
    status: actionsStatus,
    /**
     * The action rows this card's editor is seeded from are unconfirmed by
     * the server (AGL-1358). Editing an action copies the whole stored row
     * into `draft` — name, trigger and every step — and writes all of it
     * back, so `merge: true` protects nothing and a cached seed reverts a
     * colleague's newer version of the steps nobody here touched.
     *
     * The same shape the interaction builder guards (AGL-1066); this is its
     * card twin, and it was the one that never got the guard.
     */
    fromCache: actionsFromCache,
  } = useFirestoreCollection<any>(
    /*
     * ORDERED AND CEILINGED, deliberately not paged by the query (AGL-2501) —
     * the same decision as the workflows card beside it.
     *
     * `limit(100)` alone is answered in DOCUMENT-ID order, so the window was a
     * pseudo-random hundred that the `localeCompare` below arranged
     * alphabetically, and nothing said the list was bounded.
     *
     * `collectionCeiling` does not change WHICH hundred — document-id order is
     * what the bare cap already returned. What it changes is that the order is
     * NAMED, so the obvious next edit is caught: ordering on `name` would HIDE
     * every action written without one rather than mis-sorting the list, and
     * `/api/hosts/resources` validates no field for presence while
     * `IMPORTABLE_FIELDS.actions` copies one only if the export carried it.
     *
     * The QUERY is not paged because this collection holds TWO audiences. A
     * row whose trigger names a leaf selector is an element interaction, which
     * belongs to its document and is reported below as a count rather than
     * listed; the rest are the site's actions. Both partitions are derived
     * from the rows in hand, so a server page would make "3 interactions are
     * set up on their own elements" mean "3 on this page" — a count that is a
     * window length, which is the defect this sweep keeps finding rather than
     * a shape it should add.
     */
    () =>
      collectionCeiling(
        collection(firestore, 'hosts', hostId, 'actions'),
        ACTION_CEILING,
      ),
    [firestore, hostId],
    { idField: '$id' },
  )
  const { rows: readActions, truncated: actionsTruncated } =
    ceilingedWindow<any>(actionDocs, ACTION_CEILING)
  const [draft, setDraft] = useState<ActionDraft | null>(null)
  /**
   * The editor has been opened at least once in this session.
   *
   * A LATCH rather than `draft` itself, because the pickers below key their
   * listeners on it. Tracking the dialog would tear those subscriptions down
   * on Cancel and pay for them again on the next Edit, so a merchant working
   * through ten actions would buy the same six windows ten times — worse than
   * the mount-time read this replaces. Latched, a reader who never edits pays
   * nothing and a reader who edits pays once.
   */
  const [editorOpened, setEditorOpened] = useState(false)
  if (draft && !editorOpened) setEditorOpened(true)
  /*
   * The step editor's six option lists, read on the same latch as the
   * Workflows builder's — one hook, because the two editors offer one set of
   * steps and a second copy would be a second read cost to keep in agreement.
   */
  const { pickers: stepPickers, truncated: truncatedPickers } =
    useAutomationStepPickers(hostId, editorOpened)
  const liveActions = readActions.filter((action: any) => !action.deletedAt)
  /*
   * Opens a listed action in the editor, for a widget in the `hostAutomations`
   * zone — one that drafted an action and offers to open it. Read through a
   * ref so the callback keeps one identity while the list changes beneath it,
   * and answers `false` for an id the list has not read yet.
   */
  const listedRef = useRef<any[]>(liveActions)
  listedRef.current = liveActions
  const openAction = useCallback((actionId: string) => {
    const action = listedRef.current.find((row: any) => row.$id === actionId)
    if (!action) return false
    setDraft(draftFromAction(action, action.$id))
    return true
  }, [])
  /**
   * Element interactions are not listed here.
   *
   * An ACTION is something the SITE does — an order was placed, a form was
   * submitted. An INTERACTION is something an ELEMENT does, and it belongs to
   * the document that holds the element: it publishes and rolls back with it,
   * travels with it, and is deleted with it. This page is the site's
   * automation list, and a nav menu's hover timing sitting in it beside "when
   * an order is placed" was the tell that the two had been conflated.
   *
   * These rows are the ones written BEFORE the move, still bound by selector.
   * They keep running and stay editable — on their element, in the besigner,
   * which is now the only place they appear. Counted rather than hidden
   * outright, so the page can say where they went instead of appearing to
   * have lost them.
   */
  const elementScoped = liveActions.filter((action: any) =>
    LEAF_SELECTOR.test(String(action?.trigger?.selector ?? '')),
  )
  // Sorting is safe here in a way it is not on a paged list: these rows are
  // the whole collection below the ceiling, not a slice of one.
  const actions = liveActions
    .filter((action: any) => !elementScoped.includes(action))
    .sort((a: any, b: any) =>
      String(a.name ?? '').localeCompare(String(b.name ?? '')),
    )
  // The page is a SLICE: the rows are already in hand, and both the element
  // interaction count and the alphabetical order need all of them.
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(TABLE_PAGE_SIZE_DEFAULT)
  const visibleActions = useMemo(
    () => actions.slice(page * pageSize, page * pageSize + pageSize),
    [actions, page, pageSize],
  )

  const patch = useCallback(
    (updater: (previous: ActionDraft) => ActionDraft) =>
      setDraft((previous) => (previous ? updater(previous) : previous)),
    [],
  )

  /** The saved action the editor has open, as the `automationEditor` zone names it. */
  const draftId = draft?.id ?? null
  const draftName = draft?.name ?? ''
  const editorTarget = useMemo<ConsoleAutomationTarget | null>(
    () => (draftId ? { type: 'action', id: draftId, name: draftName } : null),
    // The name the editor opened with: the zone reads the automation as it is
    // stored, so a rename being typed does not make it a different one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draftId],
  )

  /**
   * Whether this workspace may open the editor at all. One gate for the
   * blank action and the recipes: a recipe is an action, so the plan that
   * carries one carries the other, and the refusal reads the same.
   */
  const actionsEntitled = useCallback(() => {
    if (checkEntitlement(org, 'actions')) return true
    enqueueSnackbar(
      'The actions builder requires a Pro plan — see Billing to upgrade',
      { variant: 'warning', persist: false },
    )
    return false
  }, [org, enqueueSnackbar])

  const handleAdd = useCallback(() => {
    if (!actionsEntitled()) return
    setDraft({
      id: null,
      name: '',
      trigger: { event: 'formSubmission', filter: '' },
      steps: [defaultStep('siteAlert')],
      enabled: true,
      customEvent: '',
      conditionRows: [EMPTY_CONDITION_ROW],
      conditionCombinator: 'and',
      recipe: null,
    })
  }, [actionsEntitled])

  /*
   * THE RECIPES (AGL-2626).
   *
   * A recipe opens the editor prefilled and writes nothing: the draft it
   * builds is the one Save would persist, and until then it is state in
   * this card and nowhere else. Three recipes open at once; "Tag by form"
   * needs a form first, and the form is this site's — `hosts/{hostId}/forms`
   * — so the picker is the one host-scoped piece of the feature, held here
   * rather than in the catalog.
   */
  const [recipesAnchor, setRecipesAnchor] = useState<HTMLElement | null>(null)
  const [formPickFor, setFormPickFor] = useState<CrmActionRecipe | null>(null)
  const [pickedFormId, setPickedFormId] = useState('')
  /**
   * The form picker has been opened at least once — the `editorOpened`
   * latch's twin, and for the same reason: the forms window is read for
   * this picker only, and a reader who never opens it pays nothing.
   */
  const [formPickerOpened, setFormPickerOpened] = useState(false)
  if (formPickFor && !formPickerOpened) setFormPickerOpened(true)
  const { data: formRead } = useFirestoreCollection<any>(
    () =>
      formPickerOpened
        ? collectionCeiling(
            collection(firestore, 'hosts', hostId, 'forms'),
            EDITOR_OPTION_CEILING,
          )
        : null,
    [firestore, hostId, formPickerOpened],
    { idField: '$id' },
  )
  const { rows: formDocs, truncated: formsTruncated } = ceilingedWindow<any>(
    formRead,
    EDITOR_OPTION_CEILING,
  )
  // An archived form collects nothing, so a recipe keyed on it would never
  // fire; the name falls back to the id the way every form list's does.
  const formOptions = (formDocs ?? [])
    .filter((form: any) => !form.archivedAt)
    .map((form: any) => ({
      id: form.$id as string,
      name: (String(form.displayName ?? '').trim() || form.$id) as string,
    }))
    .sort((a: { name: string }, b: { name: string }) =>
      a.name.localeCompare(b.name),
    )

  const handleRecipe = useCallback(
    (recipe: CrmActionRecipe) => {
      setRecipesAnchor(null)
      if (!actionsEntitled()) return
      if (recipe.needs === 'form') {
        setPickedFormId('')
        setFormPickFor(recipe)
        return
      }
      setDraft(draftFromAction(recipe.build(), null))
    },
    [actionsEntitled],
  )

  const handleFormPicked = useCallback(() => {
    const recipe = formPickFor
    const form = formOptions.find((option) => option.id === pickedFormId)
    if (!recipe || !form) return
    setFormPickFor(null)
    setDraft(draftFromAction(recipe.build({ form }), null))
  }, [formPickFor, formOptions, pickedFormId])

  // Run log + test runs (AGL-266).
  const [runsFor, setRunsFor] = useState<any | null>(null)
  const handleTestRun = useCallback(
    async (action: any) => {
      try {
        /*
         * The console's own door, signed: a page's `events/dispatch` is a
         * tenant route this origin does not serve. The route reads the
         * trigger off the stored action and marks the run as a test, so the
         * body names only which action on which site.
         */
        const response = await authorizedFetch(
          user,
          `/api/${ACTION_TEST_RUN_API_ROUTE}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ hostId, actionId: action.$id }),
          },
        )
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) {
          return void enqueueSnackbar(payload?.error ?? 'Test run failed', {
            variant: 'warning',
            persist: false,
          })
        }
        const alerts = Array.isArray(payload?.alerts) ? payload.alerts : []
        enqueueSnackbar(
          alerts.length
            ? `Test ran — first alert: ${alerts[0].message}`
            : 'Test ran — server steps executed (see Runs)',
          { variant: 'success', persist: false },
        )
      } catch (error) {
        console.error(error)
        enqueueSnackbar('Test run failed', { variant: 'error' })
      }
    },
    [hostId, user, enqueueSnackbar],
  )

  const handleSave = useCallback(async () => {
    if (!draft) return
    const isCustom = draft.trigger.event === CUSTOM_EVENT_VALUE
    const candidate: HostAction = {
      name: draft.name.trim().slice(0, 60),
      trigger: {
        event: isCustom ? draft.customEvent.trim() : draft.trigger.event,
        ...(draft.trigger.filter?.trim()
          ? { filter: draft.trigger.filter.trim() }
          : {}),
        // Site-event config (AGL-256).
        ...(draft.trigger.selector?.trim()
          ? { selector: draft.trigger.selector.trim() }
          : {}),
        ...(Number(draft.trigger.threshold) > 0
          ? { threshold: Number(draft.trigger.threshold) }
          : {}),
        ...(draft.trigger.pathPattern?.trim()
          ? { pathPattern: draft.trigger.pathPattern.trim() }
          : {}),
        // Frequency caps (AGL-274).
        ...(draft.trigger.oncePerVisitor === true
          ? { oncePerVisitor: true }
          : {}),
        ...(draft.trigger.oncePerSession === true
          ? { oncePerSession: true }
          : {}),
        ...(Number(draft.trigger.cooldownMinutes) >= 1
          ? { cooldownMinutes: Number(draft.trigger.cooldownMinutes) }
          : {}),
        ...(draft.trigger.everyTime === true ? { everyTime: true } : {}),
        // Structured payload conditions (AGL-557; chained AGL-565):
        // rows keep their blank fields so validateHostAction surfaces
        // the miss. Saves always write the list shape — the legacy
        // single `condition` is only ever read, never written back.
        ...conditionsFromRows(draft.conditionRows, draft.conditionCombinator),
      },
      steps: draft.steps,
      enabled: draft.enabled !== false,
      // The stamp travels only when the draft knows one way or the other;
      // an older action's silence is kept (see hostActionRecipeId).
      ...(draft.recipe !== undefined ? { recipe: draft.recipe } : {}),
    }
    const problem = validateHostAction(candidate)
    if (problem) {
      return void enqueueSnackbar(problem, {
        variant: 'warning',
        persist: false,
      })
    }
    try {
      const id = draft.id ?? createResourceUid()
      /**
       * Refuse an EDIT whose seed the server never confirmed (AGL-1358).
       *
       * The payload is the whole action. `merge: true` is here so the
       * frequency caps and conditions can be nulled explicitly, not to
       * protect untouched fields — there are none, they are all in the
       * payload. So a cached seed does not lose one edit, it reverts the
       * trigger and every step to whatever the cache last held, on an
       * automation that is running on a live site.
       *
       * Only the edit path. A NEW action is built from `EMPTY_*` defaults at
       * a fresh uid and can overwrite nothing; the first snapshot of any
       * listener is `fromCache: true`, so guarding a create would refuse a
       * save that was never unsafe.
       *
       * The guard WRAPS the write — the interaction builder's early return
       * is the shape you can keep while losing the protection.
       */
      /**
       * The action DOCUMENT is created by the server (AGL-2266).
       *
       * `hosts/{hostId}/actions` was in none of the host catch-all's exclusion
       * lists, so any editor could create one client-direct on any plan and
       * nothing counted them. /api/hosts/resources now owns the create and
       * holds `ACTIONS_MAX_PER_HOST` from a server read.
       *
       * Only the create moves, and it writes a SHELL. The merge-set below is
       * untouched and still carries the whole candidate — trigger, steps,
       * conditions, the explicit nulls AGL-274/557 depend on — so no field can
       * be lost to the route's allow-list, and for an existing action this
       * path does not run at all.
       */
      if (!draft.id) {
        try {
          await createResource({
            hostId,
            resource: 'action',
            id,
            data: { name: candidate.name ?? draft.name ?? 'Untitled action' },
          })
        } catch (error: any) {
          return void enqueueSnackbar(
            error?.message ?? 'Could not create the interaction',
            { variant: 'error' },
          )
        }
      }
      const verdict = await writeGuardedBySeed(
        {
          subject: 'action',
          unreadable: Boolean(draft.id) && actionsStatus === 'error',
          fromCache: Boolean(draft.id) && actionsFromCache,
        },
        async () => {
          await setDoc(
            doc(firestore, 'hosts', hostId, 'actions', id),
            {
              // The stored shape (AGL-2639), shared with the recipe-install
              // route: frequency caps overwrite explicitly (AGL-274) because
              // a merge-set keeps omitted keys, so switching one off must
              // write it out; conditions follow suit (AGL-557/565) — the
              // list + combinator write null when cleared, and the legacy
              // single `condition` is always nulled.
              ...hostActionDocument(candidate),
              updatedAt: Timestamp.now(),
              ...(draft.id ? {} : { createdAt: Timestamp.now() }),
            },
            { merge: true },
          )
        },
      )
      // A refusal keeps the editor open with everything that was typed.
      if (!verdict.ok) {
        return void enqueueSnackbar(verdict.message, {
          variant: 'warning',
          persist: false,
        })
      }
      setDraft(null)
      enqueueSnackbar('Action saved', { variant: 'success', persist: false })
    } catch (error) {
      console.error(error)
      enqueueSnackbar('An error has occurred', {
        variant: 'error',
        allowDuplicate: true,
      })
    }
  }, [
    draft,
    firestore,
    createResource,
    hostId,
    enqueueSnackbar,
    actionsFromCache,
    actionsStatus,
  ])

  const handleDelete = useCallback(
    (action: any) => async () => {
      const confirmed = await confirm({
        title: 'Delete this action?',
        description: `"${action.name}" stops running on its trigger.`,
        confirmationText: 'Delete',
        confirmationButtonProps: { color: 'error' },
      })
        .then(() => true)
        .catch(() => false)
      if (!confirmed) return
      await updateDoc(doc(firestore, 'hosts', hostId, 'actions', action.$id), {
        deletedAt: Timestamp.now(),
      })
    },
    [confirm, firestore, hostId],
  )

  const handleToggle = useCallback(
    (action: any) => async (event: { target: { checked: boolean } }) => {
      const enabled = event.target.checked
      /*
       * A placeholder is a value nobody has supplied yet. Switched on, the
       * step holding it fails every run and a condition holding one never
       * matches, so turning such an automation on is confirmed, naming what
       * is still missing.
       */
      const missing = enabled ? automationPlaceholders(action) : []
      if (missing.length) {
        const confirmed = await confirm({
          title: 'Switch on with placeholders?',
          description:
            `"${action.name}" still has ${missing.length === 1 ? 'a placeholder' : `${missing.length} placeholders`} ` +
            `to fill in: ${missing.slice(0, 3).map(describeAutomationPlaceholder).join('; ')}` +
            `${missing.length > 3 ? '; …' : ''}. Open it with Edit to fill ` +
            `${missing.length === 1 ? 'it' : 'them'} in first.`,
          confirmationText: 'Switch on anyway',
        })
          .then(() => true)
          .catch(() => false)
        if (!confirmed) return
      }
      await updateDoc(doc(firestore, 'hosts', hostId, 'actions', action.$id), {
        enabled,
      })
    },
    [confirm, firestore, hostId],
  )

  return (
    <CardDisplay
      header={'Actions'}
      help={pluginDocsHelp('actionsBuilder', { anchor: '#create-an-action' })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={1}>
        <Typography variant="body2" color="text.secondary">
          {'When a site event fires, run automations in order — trigger a ' +
            'workflow, show the visitor an alert, chain a custom event, or ' +
            'write to a dataset. Pro plans and up.'}
        </Typography>
        {visibleActions.map((action: any) => {
          const missing = automationPlaceholders(action).length
          return (
          <Stack
            key={action.$id}
            direction="row"
            spacing={1}
            sx={{ alignItems: 'center' }}
          >
            <Switch
              size="small"
              checked={action.enabled !== false}
              onChange={handleToggle(action)}
            />
            <Stack sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2" noWrap>
                {action.name}
              </Typography>
              <Typography variant="caption" color="text.secondary" noWrap>
                {`on ${hostEventLabel(action.trigger?.event)}` +
                  ` · ${(action.steps ?? [])
                    .map(
                      (step: any) =>
                        HOST_ACTION_STEP_LABELS[
                          step.type as HostActionStepType
                        ] ?? step.type,
                    )
                    .join(' → ')}`}
              </Typography>
              {missing ? (
                <Typography variant="caption" color="warning.main" noWrap>
                  {missing === 1
                    ? '1 placeholder to fill in'
                    : `${missing} placeholders to fill in`}
                </Typography>
              ) : null}
            </Stack>
            <Button
              size="small"
              onClick={() => setDraft(draftFromAction(action, action.$id))}
            >
              {'Edit'}
            </Button>
            {isSiteEventType(String(action.trigger?.event ?? '')) ? (
              // Test run (AGL-266): the server steps only, run now as a real
              // run through the console's test-run door.
              <Button size="small" onClick={() => void handleTestRun(action)}>
                {'Test'}
              </Button>
            ) : null}
            <Button size="small" onClick={() => setRunsFor(action)}>
              {'Runs'}
            </Button>
            <Button size="small" color="error" onClick={handleDelete(action)}>
              {'Delete'}
            </Button>
          </Stack>
          )
        })}
        {actions.length === 0 ? null : (
          <ListPagination
            page={page}
            pageSize={pageSize}
            rowCount={visibleActions.length}
            // The actions the card HOLDS, which is what the reader is paging
            // through — not the collection, whose other half is the element
            // interactions counted below.
            count={actions.length}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        )}
        {actionsTruncated ? (
          <Alert severity="info">
            {`Showing the first ${ACTION_CEILING} rows of this site’s ` +
              'automations, ordered by id. There are more — both the list ' +
              'above and the interaction count below describe only what was ' +
              'read.'}
          </Alert>
        ) : null}
        <Stack direction="row" spacing={1} sx={{ alignSelf: 'flex-start' }}>
          <Button size="small" color="primary" onClick={handleAdd}>
            {'Add action'}
          </Button>
          <Button
            size="small"
            color="primary"
            aria-haspopup="menu"
            aria-controls={recipesAnchor ? 'host-action-recipes' : undefined}
            aria-expanded={recipesAnchor ? true : undefined}
            onClick={(event) => setRecipesAnchor(event.currentTarget)}
          >
            {'Recipes'}
          </Button>
          {/*
            Other ways to start an automation, from plugins (AGL-2919): the
            `hostAutomations` zone, drawn through the shell's own gated slot. A
            plugin page cannot mount that slot itself, so the shell hands it
            down, and a widget here passes the gates a console page's would.
          */}
          {ExtensionZone ? (
            <ExtensionZone
              slot="hostAutomations"
              hostId={hostId}
              orgId={org?.$id}
              openAction={openAction}
            />
          ) : null}
        </Stack>
        <Menu
          id="host-action-recipes"
          anchorEl={recipesAnchor}
          open={Boolean(recipesAnchor)}
          onClose={() => setRecipesAnchor(null)}
        >
          {CRM_ACTION_RECIPES.map((recipe) => (
            <MenuItem key={recipe.id} onClick={() => handleRecipe(recipe)}>
              <ListItemText
                primary={recipe.title}
                secondary={recipe.description}
                slotProps={{ secondary: { sx: { whiteSpace: 'normal', maxWidth: 360 } } }}
              />
            </MenuItem>
          ))}
        </Menu>
        {/* Says where they went. A list that silently drops rows
            a reader saw last week is a list they stop trusting; this is the
            one sentence that makes the absence deliberate. */}
        {elementScoped.length ? (
          <Typography variant="caption" color="text.secondary">
            {elementScoped.length === 1
              ? '1 interaction is set up on its own element — '
              : `${elementScoped.length} interactions are set up on their own elements — `}
            {'open the element in the besigner to edit it. Interactions ' +
              'belong to the page they are on, so they publish and roll back ' +
              'with it.'}
          </Typography>
        ) : null}
      </Stack>

      <Dialog
        open={Boolean(draft)}
        onClose={() => setDraft(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{draft?.id ? 'Edit action' : 'Add action'}</DialogTitle>
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: 1 }}
        >
          {ExtensionZone && editorTarget ? (
            <ExtensionZone
              slot="automationEditor"
              hostId={hostId}
              orgId={org?.$id}
              target={editorTarget}
            />
          ) : null}
          {draft?.recipe ? (
            <Typography variant="body2" color="text.secondary">
              {`Started from the “${
                CRM_ACTION_RECIPES.find((recipe) => recipe.id === draft.recipe)
                  ?.title ?? 'recipe'
              }” recipe — change anything, then save.`}
            </Typography>
          ) : null}
          {/*
            A short picker is worse than an empty one, because it looks
            complete: the target an author cannot find reads as deleted, and
            the step gets pointed somewhere else.
           */}
          {truncatedPickers.length > 0 ? (
            <Alert severity="info" sx={{ mt: 1 }}>
              {`Offering the first ${EDITOR_OPTION_CEILING} rows, ordered by ` +
                `id, for: ${truncatedPickers.join(', ')}. This site has ` +
                'more, so a step target may not be listed below.'}
            </Alert>
          ) : null}
          <TextField
            label="Name"
            value={draft?.name ?? ''}
            onChange={(event) =>
              patch((previous) => ({ ...previous, name: event.target.value }))
            }
            size="small"
            autoFocus
            sx={{ mt: 1 }}
          />
          <Stack direction="row" spacing={1}>
            <TextField
              select
              label="Trigger event"
              value={draft?.trigger.event ?? ''}
              onChange={(event) =>
                patch((previous) => ({
                  ...previous,
                  trigger: { ...previous.trigger, event: event.target.value },
                }))
              }
              size="small"
              sx={{ minWidth: 180 }}
            >
              {HOST_EVENT_TYPES.map((eventType) => (
                <MenuItem key={eventType} value={eventType}>
                  {hostEventLabel(eventType)}
                </MenuItem>
              ))}
              {SITE_EVENT_TYPES.map((eventType) => (
                <MenuItem key={eventType} value={eventType}>
                  {`${eventType} (on page)`}
                </MenuItem>
              ))}
              <MenuItem value={CUSTOM_EVENT_VALUE}>{'Custom event…'}</MenuItem>
            </TextField>
            {draft?.trigger.event === CUSTOM_EVENT_VALUE ? (
              <TextField
                label="Custom event name"
                value={draft?.customEvent ?? ''}
                onChange={(event) =>
                  patch((previous) => ({
                    ...previous,
                    customEvent: event.target.value,
                  }))
                }
                size="small"
                sx={{ flex: 1 }}
              />
            ) : (
              <TextField
                label="Filter (optional)"
                placeholder={'path == "/pricing"'}
                // What the expression — and the conditions below — can name
                // for this event; nothing for an event whose payload is not
                // written down, rather than a guess.
                helperText={hostEventPayloadHint(draft?.trigger.event) ?? undefined}
                value={draft?.trigger.filter ?? ''}
                onChange={(event) =>
                  patch((previous) => ({
                    ...previous,
                    trigger: {
                      ...previous.trigger,
                      filter: event.target.value,
                    },
                  }))
                }
                size="small"
                sx={{ flex: 1 }}
              />
            )}
          </Stack>
          {/* Structured payload conditions (AGL-557): the no-code sibling
              of the filter — e.g. only when `subscribe` is not empty.
              Chainable with AND/OR (AGL-565), rows styled like steps. */}
          <TriggerConditionRows
            rows={draft?.conditionRows ?? []}
            combinator={draft?.conditionCombinator ?? 'and'}
            onRowsChange={(update) =>
              patch((previous) => ({
                ...previous,
                conditionRows: update(previous.conditionRows),
              }))
            }
            onCombinatorChange={(combinator) =>
              patch((previous) => ({
                ...previous,
                conditionCombinator: combinator,
              }))
            }
          />
          {isSiteEventType(draft?.trigger.event ?? '') ? (
            // Site-event config (AGL-256): what/where the trigger watches.
            <Stack direction="row" spacing={1}>
              {(ELEMENT_SCOPED_SITE_EVENTS as readonly string[]).includes(
                draft?.trigger.event ?? '',
              ) ? (
                <TextField
                  label="CSS selector"
                  placeholder="#pricing-table"
                  value={draft?.trigger.selector ?? ''}
                  onChange={(event) =>
                    patch((previous) => ({
                      ...previous,
                      trigger: {
                        ...previous.trigger,
                        selector: event.target.value,
                      },
                    }))
                  }
                  size="small"
                  sx={{ flex: 1 }}
                />
              ) : null}
              {['scrollDepth', 'timeOnPage'].includes(
                draft?.trigger.event ?? '',
              ) ? (
                <TextField
                  type="number"
                  label={
                    draft?.trigger.event === 'scrollDepth'
                      ? 'Scroll %'
                      : 'Seconds'
                  }
                  value={draft?.trigger.threshold ?? ''}
                  onChange={(event) =>
                    patch((previous) => ({
                      ...previous,
                      trigger: {
                        ...previous.trigger,
                        threshold: Number(event.target.value),
                      },
                    }))
                  }
                  size="small"
                  sx={{ width: 120 }}
                />
              ) : null}
              <TextField
                label="Only on pages (optional)"
                placeholder="/pricing or /blog/*"
                value={draft?.trigger.pathPattern ?? ''}
                onChange={(event) =>
                  patch((previous) => ({
                    ...previous,
                    trigger: {
                      ...previous.trigger,
                      pathPattern: event.target.value,
                    },
                  }))
                }
                size="small"
                sx={{ flex: 1 }}
              />
              {/* Frequency caps (AGL-274). */}
              <TextField
                select
                label="Frequency"
                size="small"
                sx={{ minWidth: 170 }}
                value={
                  draft?.trigger.oncePerVisitor
                    ? 'visitor'
                    : draft?.trigger.oncePerSession
                      ? 'session'
                      : Number(draft?.trigger.cooldownMinutes) >= 1
                        ? 'cooldown'
                        : draft?.trigger.everyTime
                          ? 'every'
                          : ''
                }
                onChange={(event) => {
                  const mode = event.target.value
                  patch((previous) => ({
                    ...previous,
                    trigger: {
                      ...previous.trigger,
                      // Every occurrence (AGL-562): repeatable UI
                      // choreography (menu/drawer toggles).
                      everyTime: mode === 'every',
                      oncePerVisitor: mode === 'visitor',
                      oncePerSession: mode === 'session',
                      cooldownMinutes:
                        mode === 'cooldown'
                          ? Number(previous.trigger.cooldownMinutes) >= 1
                            ? Number(previous.trigger.cooldownMinutes)
                            : 60
                          : undefined,
                    },
                  }))
                }}
              >
                <MenuItem value="">{'Every matching pageview'}</MenuItem>
                <MenuItem value="every">
                  {'Every occurrence (repeatable)'}
                </MenuItem>
                <MenuItem value="session">{'Once per session'}</MenuItem>
                <MenuItem value="visitor">{'Once per visitor'}</MenuItem>
                <MenuItem value="cooldown">{'With a cooldown'}</MenuItem>
              </TextField>
              {Number(draft?.trigger.cooldownMinutes) >= 1 &&
              !draft?.trigger.oncePerVisitor &&
              !draft?.trigger.oncePerSession ? (
                <TextField
                  type="number"
                  label="Cooldown (minutes)"
                  size="small"
                  sx={{ width: 150 }}
                  value={draft?.trigger.cooldownMinutes ?? 60}
                  onChange={(event) =>
                    patch((previous) => ({
                      ...previous,
                      trigger: {
                        ...previous.trigger,
                        cooldownMinutes: Number(event.target.value),
                      },
                    }))
                  }
                />
              ) : null}
            </Stack>
          ) : null}
          <Typography variant="overline" color="text.secondary">
            {'Steps (run in order)'}
          </Typography>
          {(draft?.steps ?? []).map((step, index) => (
            <AutomationStepFields
              key={index}
              step={step}
              index={index}
              kind={step.type}
              kinds={ACTION_STEP_KINDS}
              stepForKind={(value) => defaultStep(value as HostActionStepType)}
              pickers={stepPickers}
              onSteps={(update) =>
                patch((previous) => ({
                  ...previous,
                  steps: update(previous.steps),
                }))
              }
            />
          ))}
          <Button
            size="small"
            sx={{ alignSelf: 'flex-start' }}
            disabled={(draft?.steps.length ?? 0) >= ACTION_MAX_STEPS}
            onClick={() =>
              patch((previous) => ({
                ...previous,
                steps: [...previous.steps, defaultStep('siteAlert')],
              }))
            }
          >
            {'Add step'}
          </Button>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDraft(null)}>{'Cancel'}</Button>
          <Button
            variant="contained"
            color="primary"
            disabled={!draft?.name.trim()}
            onClick={handleSave}
          >
            {'Save action'}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={Boolean(formPickFor)}
        onClose={() => setFormPickFor(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{formPickFor?.title ?? ''}</DialogTitle>
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: 1 }}
        >
          <Typography variant="body2" color="text.secondary">
            {'Pick the form whose new contacts get the tag. The action opens ' +
              'ready to edit; nothing is saved until you save it.'}
          </Typography>
          {formsTruncated ? (
            <Alert severity="info">
              {`Offering the first ${EDITOR_OPTION_CEILING} forms, ordered by ` +
                'id. This site has more, so the form you want may not be listed.'}
            </Alert>
          ) : null}
          {formOptions.length ? (
            <TextField
              select
              label="Form"
              value={pickedFormId}
              onChange={(event) => setPickedFormId(event.target.value)}
              size="small"
              sx={{ mt: 1 }}
            >
              {formOptions.map((option) => (
                <MenuItem key={option.id} value={option.id}>
                  {option.name}
                </MenuItem>
              ))}
            </TextField>
          ) : (
            <Typography variant="body2" color="text.secondary">
              {'This site has no forms yet. Add one in the besigner, then come back.'}
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button color="inherit" onClick={() => setFormPickFor(null)}>
            {'Cancel'}
          </Button>
          <Button
            variant="contained"
            disabled={!pickedFormId}
            onClick={handleFormPicked}
          >
            {'Use recipe'}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={Boolean(runsFor)}
        onClose={() => setRunsFor(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{`Runs — ${runsFor?.name ?? ''}`}</DialogTitle>
        <DialogContent>
          {runsFor ? (
            <HostRunHistoryCard
              hostId={hostId}
              orgId={org?.$id}
              targetId={runsFor.$id}
              targetType="action"
              targetName={runsFor.name ?? ''}
              header="Recent runs"
            />
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button color="inherit" onClick={() => setRunsFor(null)}>
            {'Close'}
          </Button>
        </DialogActions>
      </Dialog>
    </CardDisplay>
  )
}
HostActionsCard.displayName = 'HostActionsCard'

export default HostActionsCard
