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

/**
 * Duplicating a site resource whole, as a draft (AGL-2936).
 *
 * One module for every kind that lives under a site — screens and email
 * designs, reusable components, layouts, templates, forms and workflows —
 * so the console route, the AI runtime's `duplicate_resource` tool and any
 * later door make the same copy: the same fields, the same uniqueness
 * rules, the same band arithmetic, the same activity rows. A caller that
 * has verified who is asking and that they may write the site hands over
 * the ids and gets back the copy's id, or a refusal it can answer with.
 *
 * WHAT MAKES THE COPY A DRAFT is different per kind, and each is the
 * omission of exactly one thing the create paths would otherwise do:
 *
 *   - a screen is reachable only through the host's routing map, so the
 *     copy gets no entry there — it has a slug of its own (`-copy`) but no
 *     address until somebody publishes it;
 *   - a collection's entry template renders only for the collection that
 *     points at it, and nothing points at the copy;
 *   - a layout, component or form is served only where a page places it,
 *     and nothing places the copy;
 *   - a workflow runs only when its trigger fires, and the copy's trigger
 *     is cleared;
 *   - a template is inert until it is used.
 *
 * COUNTED LIKE A CREATE. The copy is one more document in a collection the
 * plan bands, so it meets the same counter the create route meets — for a
 * screen that is not a page, the flat platform ceiling rather than a band —
 * and meets it INSIDE the transaction that writes the copy (AGL-2231): a count
 * taken before the write is a count N concurrent copies all pass. The
 * siblings are read once and answer three questions — the count, the name
 * the copy may take, and the slug — because three reads of one collection
 * is the reason a route and its readout come to disagree.
 *
 * THE VERSION TRAVELS WITH THE DOCUMENT. A besigner resource is opened by
 * its version, so the copy of a screen with no version is a screen nobody
 * can open. The source's most recently saved version is copied into the
 * copy's own `versions` as its first — no `versioning` entitlement is
 * owed for a first version — with its stored node bytes carried across
 * untouched: they are msgpack at rest, and re-encoding them is the
 * double-encode `encodeStoredNodes` exists to avoid.
 *
 * THE ONE TREE THAT IS REWRITTEN is a form's (AGL-3024). A form's design
 * names its own form inside itself, so carrying those bytes across hands the
 * copy a design that files every submission under the SOURCE — silently,
 * because the copy still renders and the row still lands. That binding is
 * moved onto the copy below. No other kind embeds its own id in its design,
 * so no other kind is decoded.
 */

import {
  billableScreenIds,
  checkEntitlement,
  checkQuota,
  claimAttempt,
  createResourceUid,
  decodeStoredNodes,
  encodeStoredNodes,
  nameSearchKey,
  NON_PAGE_SCREEN_MAX_PER_HOST,
  nonPageScreenIds,
  SCREEN_KIND_EMAIL,
  SCREEN_KIND_TEMPLATE,
  screenClaimsToBeAPage,
  type BillableScreenSource,
  type OrgEntitlements,
  type OrgFeatureFlags,
} from '@aglyn/aglyn/server'
import {
  DUPLICABLE_RESOURCE_NOUNS,
  DUPLICATE_BUSY_MESSAGE,
  duplicateDisplayName,
  duplicateVersionNote,
  uniqueDuplicateName,
  uniqueDuplicateSlug,
  type DuplicableHostResourceKind,
} from '@aglyn/aglyn/app-utils/duplicate-resource'
import { formDesignReboundTo } from '@aglyn/aglyn/app-utils/forms'
import { Timestamp } from 'firebase-admin/firestore'
import { logResourceDuplicated } from './duplicate-activity'
import firebaseAdmin from './firebase-admin'

/** How the copy of each kind is made. */
interface KindRecipe {
  collection: string
  /** The field the name lives in — `name` on a workflow, `displayName` elsewhere. */
  nameField: 'displayName' | 'name'
  /** The source fields carried onto the copy; everything else stays behind. */
  fields: readonly string[]
  /** The back-pointer a copied version carries, when the kind versions at all. */
  versionParentField?: 'screenId' | 'layoutId' | 'componentId' | 'formId'
  /** The plan counter the copy is charged to. */
  quotaKey?: keyof OrgEntitlements & string
  /** The feature the plan must include for the kind to exist at all. */
  entitlement?: keyof OrgFeatureFlags
  /** Whether a `slug` on the source becomes a unique `-copy` slug. */
  slug?: boolean
  /** What the copy carries beyond the source's fields. */
  stamps?: Record<string, unknown>
}

/**
 * Per kind, the same fields the create route's allow-list admits, less the
 * ones a copy must not inherit: a screen's `versionId` (the copy mints its
 * own), a template's `source` (stamped `authored` below — a copy of a
 * marketplace template is the customer's own), a workflow's `trigger`
 * (cleared, so the copy runs nothing until armed), and anything the server
 * stamps on every create.
 */
const RECIPES: Record<DuplicableHostResourceKind, KindRecipe> = {
  screen: {
    collection: 'screens',
    nameField: 'displayName',
    fields: [
      'description',
      'seo',
      'kind',
      'visibility',
      'locale',
      'protection',
      // The shared-layout binding. A version inherits it from its screen, so
      // a copy without it renders with no header or footer (AGL-3120).
      'layoutId',
    ],
    versionParentField: 'screenId',
    quotaKey: 'screensPerHost',
    slug: true,
  },
  // No `quotaKey`: an email design is not a page, so it meets the flat
  // platform ceiling on non-page screens below rather than the page band.
  emailDesign: {
    collection: 'screens',
    nameField: 'displayName',
    fields: ['description', 'kind'],
    versionParentField: 'screenId',
  },
  component: {
    collection: 'components',
    nameField: 'displayName',
    // `kind` keeps an email block an email block (AGL-3287): without it the
    // copy reads as a page component, leaves every email editor's palette,
    // and turns up in page editors where its email blocks cannot render.
    fields: ['description', 'icon', 'rootId', 'nodes', 'props', 'kind'],
    versionParentField: 'componentId',
    entitlement: 'reusableComponents',
  },
  layout: {
    collection: 'layouts',
    nameField: 'displayName',
    fields: ['description'],
    versionParentField: 'layoutId',
    quotaKey: 'sharedLayoutsPerHost',
  },
  template: {
    collection: 'templates',
    nameField: 'displayName',
    fields: [
      'kind',
      // A component template's own kind — email block or page component —
      // so Use template on a copy still makes the right one (AGL-3287).
      'componentKind',
      'description',
      'category',
      'placeholders',
      'nodes',
      'rootId',
      'props',
      'slug',
      'seo',
      'theme',
    ],
    quotaKey: 'templatesPerHost',
    stamps: { source: { type: 'authored' } },
  },
  form: {
    collection: 'forms',
    nameField: 'displayName',
    fields: [
      'fields',
      'consentFieldName',
      'routing',
      'legacyMatch',
      'rootId',
      'nodes',
    ],
    versionParentField: 'formId',
    quotaKey: 'formsPerHost',
    entitlement: 'reusableComponents',
    slug: true,
  },
  workflow: {
    collection: 'workflows',
    nameField: 'name',
    fields: ['steps', 'returnValue'],
    quotaKey: 'workflowsPerHost',
    entitlement: 'workflows',
    stamps: { trigger: null },
  },
}

export interface DuplicateResourceOptions {
  orgId: string
  hostId: string
  sourceId: string
  /** The name the copy takes; blank means `Copy of <source>`. */
  name?: string | null
  /** The verified person making the copy. */
  uid: string
  email?: string | null
  /**
   * The owning org's document, when the caller already holds it; read
   * here otherwise. The bands are resolved from it.
   */
  org?: Record<string, unknown> | null
  /**
   * A client-minted key for this attempt, so a double click makes one copy
   * and a retry of a finished attempt answers what the first did. A caller
   * with no client behind it — the AI runtime — sends none and is not
   * claimed.
   */
  attemptKey?: string | null
}

export type DuplicateResourceResult =
  | {
      ok: true
      id: string
      /** The copy's first version, for the kinds that version. */
      versionId: string | null
      name: string
    }
  | { ok: false; status: number; error: string }

/** What a sibling contributes to the three answers the siblings give. */
interface SiblingRow {
  id: string
  name: string
  slug: string
  kind: unknown
  deletedAt: unknown
  sourceType: unknown
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

/**
 * Makes the copy. The caller has authenticated `uid` and verified that they
 * may write content on `hostId`; this decides everything after that.
 */
export async function duplicateResource(
  kind: DuplicableHostResourceKind,
  options: DuplicateResourceOptions,
): Promise<DuplicateResourceResult> {
  const recipe = RECIPES[kind]
  const noun = DUPLICABLE_RESOURCE_NOUNS[kind]
  const sourceId = String(options.sourceId ?? '').trim().slice(0, 64)
  if (!sourceId) return { ok: false, status: 400, error: `Missing the ${noun} to copy` }
  const firestore = firebaseAdmin.app().firestore()

  const attemptKey = String(options.attemptKey ?? '').trim().slice(0, 200)
  const claimed = attemptKey
    ? await claimAttempt(firestore as never, {
        kind: `duplicate-${kind}`,
        scopeId: `${options.hostId}:${sourceId}`,
        orgId: options.orgId,
        key: attemptKey,
        busyMessage: DUPLICATE_BUSY_MESSAGE,
      })
    : null
  if (claimed && 'replay' in claimed) {
    return claimed.replay.body as DuplicateResourceResult
  }
  const claim = claimed && 'claim' in claimed ? claimed.claim : null

  try {
    const result = await copy(firestore, kind, recipe, { ...options, sourceId })
    if (result.ok) {
      await logResourceDuplicated(
        kind,
        { uid: options.uid, email: options.email ?? null },
        {
          orgId: options.orgId,
          hostId: options.hostId,
          source: { id: sourceId, name: result.sourceName },
          target: { id: result.id, name: result.name, versionId: result.versionId },
        },
      )
      const answer: DuplicateResourceResult = {
        ok: true,
        id: result.id,
        versionId: result.versionId,
        name: result.name,
      }
      await claim?.record(200, answer)
      return answer
    }
    // A refusal releases the key: the person fixes the cause — frees a slot,
    // picks another name — and presses the same button again.
    await claim?.release()
    return result
  } catch (error) {
    await claim?.release()
    throw error
  }
}

type CopyOutcome =
  | { ok: true; id: string; versionId: string | null; name: string; sourceName: string }
  | { ok: false; status: number; error: string }

async function copy(
  firestore: FirebaseFirestore.Firestore,
  kind: DuplicableHostResourceKind,
  recipe: KindRecipe,
  options: DuplicateResourceOptions & { sourceId: string },
): Promise<CopyOutcome> {
  const { hostId, sourceId, uid } = options
  const noun = DUPLICABLE_RESOURCE_NOUNS[kind]
  const hostRef = firestore.collection('hosts').doc(hostId)
  const collectionRef = hostRef.collection(recipe.collection)
  const sourceRef = collectionRef.doc(sourceId)
  const org =
    options.org ??
    (((await firestore.collection('orgs').doc(options.orgId).get()).data() ??
      null) as Record<string, unknown> | null)

  if (recipe.entitlement && !checkEntitlement(org as never, recipe.entitlement)) {
    return {
      ok: false,
      status: 403,
      error: 'This feature is not included in your plan — see Billing',
    }
  }

  const id = createResourceUid()
  const versionId = recipe.versionParentField ? createResourceUid() : null

  return firestore.runTransaction(async (tx): Promise<CopyOutcome> => {
    // ALL READS BEFORE ANY WRITE, which Firestore requires. The host is read
    // inside the transaction rather than passed in because its routing map
    // is an input to the screen count and is ordinary client-writable.
    const siblingFields = [
      recipe.nameField,
      'slug',
      'kind',
      'deletedAt',
      'source.type',
    ]
    const [hostSnapshot, source, siblingsSnapshot] = await Promise.all([
      tx.get(hostRef),
      tx.get(sourceRef),
      tx.get(collectionRef.select(...siblingFields)),
    ])
    if (!hostSnapshot.exists) return { ok: false, status: 404, error: 'Unknown site' }
    if (!source.exists || source.get('deletedAt') != null) {
      return { ok: false, status: 404, error: `Unknown ${noun}` }
    }
    const data = asRecord(source.data())

    // The two screen kinds share a collection and are told apart by `kind`:
    // an email design copied as a page would land on the Screens list, and
    // the other way round would put a page on the Emails page.
    //
    // Of the screens that are not pages, only a collection's entry template
    // may be copied as a screen (AGL-3102), and the copy stays a template:
    // `kind` rides across with the recipe's fields, so it composes nothing
    // until a collection points at it — which is how a second collection
    // starts from the first one's design. An error screen is refused:
    // `kind: 'error'` is the slot assignment's to stamp, because that write
    // is what bounds how many a site holds, and a copy would stamp one
    // outside it.
    const sourceKind = data['kind']
    const nonPageScreen =
      recipe.collection === 'screens' &&
      !screenClaimsToBeAPage({ kind: sourceKind as string })
    if (recipe.collection === 'screens') {
      if (kind === 'emailDesign' && sourceKind !== SCREEN_KIND_EMAIL) {
        return { ok: false, status: 400, error: 'That screen is not an email design' }
      }
      if (kind === 'screen' && nonPageScreen && sourceKind !== SCREEN_KIND_TEMPLATE) {
        return {
          ok: false,
          status: 400,
          error: 'Only a page or a collection entry template can be duplicated as a screen',
        }
      }
    }

    const siblings: SiblingRow[] = siblingsSnapshot.docs.map((row) => ({
      id: row.id,
      name: String(row.get(recipe.nameField) ?? ''),
      slug: String(row.get('slug') ?? ''),
      kind: row.get('kind'),
      deletedAt: row.get('deletedAt'),
      sourceType: row.get('source.type'),
    }))
    const live = siblings.filter((row) => row.deletedAt == null)

    // THE BAND, met inside the transaction (AGL-2231) with the create route's
    // own arithmetic: screens count what the routing map makes billable,
    // templates exclude the platform's starters, everything else counts its
    // live documents. A screen copy that is not a page — an email design or
    // an entry template — meets the flat platform ceiling on non-page screens
    // instead, the one an email design's create meets and a demoted template
    // fills, and never the page band: it spends none of it.
    const screenRows: BillableScreenSource[] = siblings.map((row) => ({
      id: row.id,
      kind: row.kind,
      deletedAt: row.deletedAt,
    }))
    const routingMap = hostSnapshot.get('screens') as never
    if (nonPageScreen) {
      if (nonPageScreenIds(screenRows, routingMap).size >= NON_PAGE_SCREEN_MAX_PER_HOST) {
        return {
          ok: false,
          status: 403,
          error:
            'This site is at its limit of ' +
            `${NON_PAGE_SCREEN_MAX_PER_HOST} email and template screens — ` +
            'delete some to make room',
        }
      }
    } else if (recipe.quotaKey) {
      const used =
        kind === 'screen'
          ? billableScreenIds(screenRows, routingMap).size
          : kind === 'template'
            ? live.filter((row) => row.sourceType !== 'starter').length
            : live.length
      const quota = checkQuota(org as never, recipe.quotaKey as never, used)
      if (!quota.allowed) {
        return {
          ok: false,
          status: 403,
          error:
            `Your plan includes ${quota.limit} ${noun}s — ` +
            'upgrade in Billing for more',
        }
      }
    }

    // THE NAME AND THE SLUG, unique among the live siblings. A deleted
    // sibling's name is free: a person who deleted "Home" and copies
    // "About" as "Home" is not confused by a tombstone.
    const sourceName = String(data[recipe.nameField] ?? '').trim()
    const requested = String(options.name ?? '').trim() || duplicateDisplayName(sourceName)
    const name = uniqueDuplicateName(
      requested,
      live.map((row) => row.name),
    )
    const slug = recipe.slug
      ? uniqueDuplicateSlug(
          data['slug'] as string | undefined,
          live.map((row) => row.slug),
        )
      : undefined

    // THE VERSION: the most recently saved one, else the one the document
    // points at. Read inside the transaction so the copy is of what was
    // saved when the count was taken.
    let versionData: Record<string, unknown> | null = null
    let sourceVersionNumber: number | null = null
    if (recipe.versionParentField) {
      const versionsRef = sourceRef.collection('versions')
      const [newest, all] = await Promise.all([
        tx.get(versionsRef.orderBy('updatedAt', 'desc').limit(1)),
        tx.get(versionsRef.select()),
      ])
      let found: FirebaseFirestore.DocumentSnapshot | null = newest.docs[0] ?? null
      const pointer = String(data['versionId'] ?? '')
      if (!found && pointer) {
        const pointed = await tx.get(versionsRef.doc(pointer))
        if (pointed.exists) found = pointed
      }
      if (found) {
        versionData = asRecord(found.data())
        sourceVersionNumber = all.size
      }
    }

    // THE DOCUMENT: the recipe's fields, the name, the slug, the stamps.
    const doc: Record<string, unknown> = {}
    for (const field of recipe.fields) {
      if (data[field] !== undefined) doc[field] = data[field]
    }
    doc[recipe.nameField] = name
    if (recipe.slug) {
      if (slug) doc['slug'] = slug
      else delete doc['slug']
    }
    /*
     * THE FORM'S BINDING, moved onto the copy (AGL-3024).
     *
     * A form's design names its own form in a prop, and that name is what
     * `/api/forms/submit` files a submission under. Copied verbatim it still
     * names the SOURCE, so the copy renders, collects, and files everything
     * it collects under the form it was copied from — while its own list
     * stays empty and nothing anywhere reports an error. `checkFormContract`
     * is what the console's form page banners it with; `formDesignReboundTo`
     * is the write side of the same fact.
     *
     * This is the one place a copied tree is not carried across untouched,
     * and the exception is narrow on purpose: no other kind here embeds its
     * own id in its design. `formDesignReboundTo` answers `null` when there
     * is nothing to move, so every other kind — and a form whose design is
     * already correct — pays nothing for this.
     */
    const rebound = (raw: unknown): unknown => {
      if (kind !== 'form') return raw
      return (
        formDesignReboundTo(decodeStoredNodes(raw), {
          formId: id,
          formName: name,
        }) ?? raw
      )
    }
    // The stored tree is msgpack at rest; `encodeStoredNodes` passes encoded
    // bytes through and packs a plain map, so a legacy plain source lands
    // compressed like every create does — and so does a rebound one, which
    // comes back decoded.
    const packed = encodeStoredNodes(rebound(doc['nodes']))
    if (packed) doc['nodes'] = Buffer.from(packed)
    tx.create(collectionRef.doc(id), {
      ...doc,
      ...(recipe.stamps ?? {}),
      ...(recipe.collection === 'screens' ? { nameLower: nameSearchKey(name) } : {}),
      ...(versionData && versionId ? { versionId } : {}),
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      createdBy: uid,
    })
    if (versionData && versionId && recipe.versionParentField) {
      const versionNodes = encodeStoredNodes(rebound(versionData['nodes']))
      tx.create(collectionRef.doc(id).collection('versions').doc(versionId), {
        ...versionData,
        ...(versionNodes ? { nodes: Buffer.from(versionNodes) } : {}),
        [recipe.versionParentField]: id,
        hostId,
        displayName: duplicateVersionNote(sourceName, sourceVersionNumber),
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        createdBy: uid,
      })
    }
    return {
      ok: true,
      id,
      versionId: versionData && versionId ? versionId : null,
      name,
      sourceName,
    }
  })
}
