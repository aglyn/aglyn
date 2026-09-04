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

import * as Aglyn from '@aglyn/aglyn/server'
import applyDuePublishSchedule from './apply-publish-schedule'
import getComponents from './get-components'
import getDatasets from './get-datasets'
import getForms from './get-forms'
import {
  getPublishedCollectionSource,
  type PublishedCollectionSource,
} from './get-collection-content'
import getPluginInstalls from './get-plugin-installs'
import getVariables, { getFunctions, getWorkflows } from './get-variables'
import getPublishedLayoutVersion from './get-layout-version'
import getScreenVersion from './get-screen-version'

/**
 * Content-collection context for a compose (AGL-551): the collection the
 * route resolved (list/entry template screens). `entries` rides along when
 * the route already fetched them (list pages); blocks bound to other
 * collections — or to this one when `entries` is absent — fetch on demand.
 */
export interface ComposeCollectionContext {
  slug: string
  entries?: Aglyn.CollectionEntryRecord[]
  /**
   * The entry being rendered (AGL-582, entry-template screens / entry
   * fallback) — the Related posts block resolves against it.
   */
  entry?: Aglyn.CollectionEntryRecord | null
  /**
   * The routed collection's category taxonomy (AGL-582): entry
   * `categoryId`s resolve to display names against it during expansion.
   */
  categories?: Aglyn.CollectionCategory[]
  /**
   * The list page the URL asked for (AGL-1321). Fills in an entries block
   * that declares `perPage` but no `page` — design time cannot know which
   * page a visitor is on.
   */
  page?: number
  /**
   * The category segment the URL filtered on (AGL-1321); marks the current
   * pill in a Category Pills block. `entries` arrives already filtered.
   */
  categorySlug?: string
  /**
   * Whether the read behind `entries` stopped at its `.limit()` (AGL-1516).
   * Travels with the entries because the search boxes downstream have to say
   * what they actually searched, and — with the liveness gate and the route's
   * category filter both in between — `entries.length` no longer tells them.
   */
  entriesReachedBound?: boolean
  /**
   * Whether {@link slug} is a cache KEY rather than an address (AGL-2524).
   *
   * The author page mixes collections, and the compose pipeline keys entry
   * sources by collection slug — so it hands over a synthetic one
   * (`AUTHOR_ENTRIES_SOURCE_SLUG`) with its entries already in hand. That is
   * harmless for the entries block, whose every row carries its OWN
   * `collectionSlug` and builds `entry.url` from it, and for the search box,
   * whose index is built the same way.
   *
   * It is NOT harmless for anything that builds a URL from the source's slug
   * itself. Set this and such a block resolves nothing rather than pointing
   * readers at `/{synthetic}/…`.
   */
  routeless?: boolean
}

interface CollectionBlockScan {
  slugs: Set<string>
  hasRelated: boolean
  hasCategories: boolean
  hasSearch: boolean
}

/**
 * Which collections does this tree ask for (AGL-1152)?
 *
 * Extracted so the PREFETCH below and the expansion that consumes it read the
 * tree through one function rather than two copies of the same predicate. A
 * divergence between them is not a type error — it is a slug prefetched and
 * never awaited, or (worse) a slug the prefetch missed that then pays the full
 * serial read anyway — so there is deliberately no second implementation to
 * drift.
 */
function scanCollectionBlocks(
  nodes: Record<string, any>,
  collection?: ComposeCollectionContext,
): CollectionBlockScan {
  const slugs = new Set<string>()
  let hasRelated = false
  let hasCategories = false
  let hasSearch = false
  for (const node of Object.values(nodes)) {
    if (node?.componentId === Aglyn.COLLECTION_ENTRIES_COMPONENT_ID) {
      const slug =
        String(node?.props?.collectionSlug ?? '').trim() || collection?.slug
      if (slug) slugs.add(slug)
    }
    // Category pills (AGL-1321) need only the taxonomy, but it rides on the
    // same source, so they count as a reason to resolve one.
    if (node?.componentId === Aglyn.COLLECTION_CATEGORIES_COMPONENT_ID) {
      const slug =
        String(node?.props?.collectionSlug ?? '').trim() || collection?.slug
      if (slug) {
        hasCategories = true
        slugs.add(slug)
      }
    }
    // The standalone toolbar search box (AGL-1516, Figma 494:1220) needs the
    // collection's entries to index, and rides the same source the listing
    // beside it was built from — one read, one answer.
    if (node?.componentId === Aglyn.COLLECTION_SEARCH_COMPONENT_ID) {
      const slug =
        String(node?.props?.collectionSlug ?? '').trim() || collection?.slug
      if (slug) {
        hasSearch = true
        slugs.add(slug)
      }
    }
    // Related posts (AGL-582) always resolve against the ROUTED collection
    // — they only mean something with a current entry in context.
    if (
      node?.componentId === Aglyn.COLLECTION_RELATED_COMPONENT_ID &&
      collection?.slug &&
      collection.entry
    ) {
      hasRelated = true
      slugs.add(collection.slug)
    }
  }
  return { slugs, hasRelated, hasCategories, hasSearch }
}

/**
 * Issue the collection reads AS SOON AS THE SCREEN NODES EXIST (AGL-1152).
 *
 * `getPublishedCollectionSource` is three SEQUENTIAL round trips —
 * `findContentCollection`, then `listLiveEntries`, then `attachEntryAuthors`
 * — and until this existed it ran after the chrome bundle had already been
 * awaited, so a page carrying a Collection entries block paid the whole thing
 * as a serial tail on the compose phase. Measured on the tenant: a page with
 * no collection block composes in ~20 ms, one with a block in ~572 ms, and the
 * tree work itself accounts for under 2 ms of that at 50 entries. The gap is
 * this read, waiting for reads it shares nothing with.
 *
 * Same shape as `screenDatasetsPromise` directly below, and the same caveat
 * applies: the SCREEN's own nodes are a fast path, NOT the correctness gate. A
 * collection block can arrive from a layout or a grafted reusable component,
 * neither of which exists yet at this point, so the real scan still runs
 * against the composed tree and still fetches anything this missed.
 *
 * The ROUTED collection is deliberately excluded when its entries are already
 * in hand: the expansion below answers that slug from `collection.entries`
 * without reading at all, so prefetching it would buy a read nobody awaits.
 */
function prefetchCollectionSources(
  hostId: string,
  screenNodes: Record<string, any>,
  collection?: ComposeCollectionContext,
): Record<string, Promise<PublishedCollectionSource>> {
  const prefetched: Record<
    string,
    Promise<PublishedCollectionSource>
  > = {}
  for (const slug of scanCollectionBlocks(screenNodes, collection).slugs) {
    if (slug === collection?.slug && collection.entries) continue
    const pending = getPublishedCollectionSource({
      hostId,
      collectionSlug: slug,
    })
    // Marked handled the moment it exists, for the reason `composed` is in
    // `composeScreenNodes`: a tree that turns out not to need this slug never
    // awaits it, and an unawaited rejection takes the process down rather than
    // failing this one read. The real await below still sees the rejection.
    void pending.catch(() => undefined)
    prefetched[slug] = pending
  }
  return prefetched
}

/**
 * Expands Collection entries blocks (AGL-551) against their collections'
 * published entries, and Related posts blocks (AGL-582) against the routed
 * entry. Fetches lazily — screens without the blocks cost nothing — and
 * fails open on lookup errors like every other compose stage.
 */
async function expandCollectionEntryBlocks(
  hostId: string,
  nodes: Record<string, any>,
  collection?: ComposeCollectionContext,
  prefetched?: Record<string, Promise<PublishedCollectionSource>>,
): Promise<Record<string, any>> {
  const { slugs, hasRelated, hasCategories, hasSearch } = scanCollectionBlocks(
    nodes,
    collection,
  )
  if (!slugs.size) return nodes
  const sources: Record<string, Aglyn.CollectionEntriesSource> = {}
  await Promise.all(
    [...slugs].map(async (slug) => {
      // The routed collection rides its already-fetched entries +
      // categories (AGL-582); other collections fetch both on demand.
      if (slug === collection?.slug && collection.entries) {
        sources[slug] = {
          slug,
          entries: collection.entries,
          categories: collection.categories,
          // Only the ROUTED collection carries the URL's page (AGL-1321) — a
          // block bound to another collection must not inherit it.
          ...(collection.page ? { page: collection.page } : {}),
          // ...nor its bound (AGL-1516): this is a fact about the read the
          // route already performed, and it describes only that collection.
          ...(collection.entriesReachedBound ? { reachedBound: true } : {}),
        }
        return
      }
      // The prefetch when this slug was visible on the screen's own nodes;
      // a live read when it only appeared after layout/component grafting.
      const fetched = await (prefetched?.[slug] ??
        getPublishedCollectionSource({ hostId, collectionSlug: slug }))
      sources[slug] = {
        slug,
        entries: fetched.entries,
        categories:
          slug === collection?.slug && collection.categories
            ? collection.categories
            : fetched.categories,
        ...(fetched.reachedBound ? { reachedBound: true } : {}),
      }
    }),
  )
  const expanded = Aglyn.expandCollectionEntries(
    nodes,
    sources,
    collection?.slug,
  )
  const withCategories = hasCategories
    ? Aglyn.expandCollectionCategories(
        expanded,
        sources,
        /*
          No DEFAULT collection for the pills on a routeless page (AGL-2524).

          Category pills are the one block that builds its links from the
          SOURCE's slug — `/{slug}/category/{x}` — because a category is a
          filter on one collection's own listing. On the author page that slug
          is synthetic, so an unbound pills block stamped links to a route that
          does not exist.

          Rendering nothing is the honest answer rather than a fallback. The
          page spans every collection, and there is no
          `/author/{slug}/category/{x}` for a pill to lead to; the only real
          destination would be some collection's listing, which drops the
          author the reader is looking at. A pills block that NAMES a
          collection is unaffected and still resolves that collection's own
          taxonomy — "browse the blog by category", which is a sensible thing
          to put beside an archive.
        */
        collection?.routeless ? undefined : collection?.slug,
        collection?.categorySlug,
      )
    : expanded
  const withSearch = hasSearch
    ? Aglyn.expandCollectionSearch(withCategories, sources, collection?.slug)
    : withCategories
  if (!hasRelated || !collection?.entry) return withSearch
  return Aglyn.expandCollectionRelated(
    withSearch,
    sources[collection.slug],
    collection.entry,
  )
}

/**
 * Shared post-version composition (AGL-551, extracted from
 * `composeScreenNodes`): layout chrome, reusable components, repeatables,
 * collection entries, bindings, function definitions, plugin installs,
 * named tokens, denormalize. The screen path and the collection-fallback
 * path (which has no screen doc) build identical trees through this one
 * pipeline.
 */
export async function composeNodesWithChrome(options: {
  hostId: string
  /**
   * The layout binding, or a PROMISE of it.
   *
   * The unresolved form exists for the same reason `screenNodes` accepts one
   * (AGL-1428): the binding may live on the version document (key-present
   * wins over the screen's), and awaiting the version before this call would
   * put every host-scoped read back behind it. Only the layout-chain walk
   * consumes the binding, so it alone waits; the rest of the chrome bundle
   * still starts immediately.
   */
  layoutId?:
    | string
    | null
    | Promise<string | null | undefined>
  /**
   * The screen's own nodes, or a PROMISE of them (AGL-1428).
   *
   * Accepting the unresolved form is what lets `composeScreenNodes` hand the
   * version read over before it has finished, so the host-scoped reads below
   * — none of which look at these nodes — overlap it instead of queueing
   * behind it. Passing a resolved value behaves exactly as before, which is
   * what every other caller does.
   */
  screenNodes: Record<string, any> | Promise<Record<string, any>>
  /** Entry-template tokens (AGL-105) substituted before denormalize. */
  tokens?: Record<string, string>
  /** Routed content collection (AGL-551) for Collection entries blocks. */
  collection?: ComposeCollectionContext
  /**
   * The host document, for `host.*` tokens (AGL-1022).
   *
   * Passed in rather than read here: every caller already holds it, and
   * `composeScreenNodes` was the largest single render phase before AGL-1225
   * cut it to one round trip — adding a read back would spend that win on
   * data we already have in hand.
   */
  host?: Aglyn.HostTokenSource | null
}): Promise<Record<string, any>> {
  const { hostId, layoutId } = options

  /**
   * The layout chain, innermost first (AGL-703).
   *
   * A layout may itself render inside another layout, so this walks the
   * `layoutId` pointers rather than reading one. Fetching is sequential
   * because each step's parent is only known once the previous layout
   * document is in hand — but the walk is short by construction
   * (MAX_LAYOUT_CHAIN_DEPTH) and every layout is already a cached read.
   *
   * `seen` stops a cycle from looping forever. Stored data can hold one
   * even though both the console and `canNestLayout` refuse to create it:
   * the API, a script, or a restored backup can all write a layout
   * document directly, and a render must degrade rather than hang.
   */
  const walkLayoutChain = async () => {
    const chain: Array<Record<string, any> | undefined> = []
    const seen = new Set<string>()
    const boundLayoutId = await layoutId
    let currentLayoutId = boundLayoutId ? String(boundLayoutId) : undefined
    while (
      currentLayoutId &&
      !seen.has(currentLayoutId) &&
      chain.length < Aglyn.MAX_LAYOUT_CHAIN_DEPTH
    ) {
      seen.add(currentLayoutId)
      const layoutRes = await getPublishedLayoutVersion({
        hostId,
        layoutId: currentLayoutId,
      })
      chain.push(layoutRes?.version?.nodes as any)
      const parentId = (layoutRes?.layout as any)?.layoutId
      currentLayoutId = parentId ? String(parentId) : undefined
    }
    return chain
  }

  /**
   * ONE round-trip stage instead of three (AGL-1225).
   *
   * This used to be `await layout walk` → `await getComponents` → `await
   * Promise.all([five reads])`: three sequential waits, where only the first
   * has any reason to be sequential. Every one of the other six reads takes
   * `hostId` and nothing else — none of them consumes the layout chain — so
   * they were waiting on a walk whose result they never look at.
   *
   * The walk stays internally sequential because it genuinely is: each step's
   * parent id is only known once the previous layout document is in hand. It
   * just no longer gates anything else. The critical path becomes the walk
   * alone rather than walk + components + bulk.
   *
   * Measured budget that motivated this (production, `/product/besigner`):
   * `composeScreenNodes` was the largest single phase at 1577 ms cold and
   * consistently ~1.4-1.6 s warm too, so this is not cold-start cost. The
   * existing `AGL-1152:render` timing line reports `composeScreenNodes` as a
   * phase, so the effect of this shows up there directly — no new
   * instrumentation, and a regression would be visible in the same place.
   */
  /**
   * Does the SCREEN itself repeat over a dataset (AGL-1440)?
   *
   * Asked as soon as the nodes are in hand — which since AGL-1428 is after
   * the fan-out has been ISSUED rather than before — so the overwhelmingly
   * common case still keeps the AGL-1225 shape: a page that repeats almost
   * always says so on its own document, and its datasets read goes out
   * alongside the remaining chrome reads instead of after them.
   *
   * It is deliberately NOT the correctness gate — a repeatable can arrive from
   * a layout or a grafted reusable component, neither of which exists yet. The
   * gate is re-asked against the composed tree after grafting, which is the
   * exact input `expandRepeatables` reads.
   */
  /*
   * ISSUE THE HOST-SCOPED READS FIRST, THEN AWAIT THE NODES (AGL-1428).
   *
   * Every read in this bundle is keyed by `hostId` (and `layoutId`) alone —
   * none of them reads `screenNodes` — so starting them before the nodes are
   * in hand lets `composeScreenNodes`' version read overlap them rather than
   * run ahead of them. `Promise.all` is created BEFORE the `await` below on
   * purpose: that is the line that makes the two independent, and moving the
   * await above it silently gives the whole saving back.
   *
   * `getDatasets` is the one read that genuinely depends on the nodes, so it
   * cannot join the bundle. It does not have to wait for the bundle either —
   * it is issued the moment the nodes resolve and awaited after, so it still
   * overlaps whatever is left of the chrome reads instead of costing the
   * extra serial round trip that dropping it from the batch would imply.
   */
  const chromeBundle = Promise.all([
    walkLayoutChain(),
    getComponents({ hostId }),
    // Host variable + function bindings (AGL-91/93): {{name}} and
    // {{fn:name(args)}} in string props resolve to values; unknown tokens
    // and failed runs stay literal.
    Promise.all([
      getVariables({ hostId }),
      getFunctions({ hostId }),
      getWorkflows({ hostId }),
      getPluginInstalls({ hostId }),
    ]),
  ])
  const screenNodes = await options.screenNodes
  const screenDatasetsPromise = Aglyn.hasRepeatableNodes(screenNodes)
    ? getDatasets({ hostId })
    : undefined
  // Does the SCREEN itself place a form entity? Gated and re-asked exactly
  // like the datasets read beside it (AGL-1440): most pages carry no form, and
  // the ones that do usually say so on their own document, so the read goes
  // out here alongside the chrome reads instead of as a serial tail. It is not
  // the correctness gate — a placed form can arrive from a layout or a grafted
  // component — so the composed tree is asked again below.
  const screenFormsPromise = Aglyn.placesFormEntity(screenNodes)
    ? getForms({ hostId })
    : undefined
  // Issued HERE, beside the datasets read and before the chrome bundle is
  // awaited, so the collection read overlaps it instead of trailing it.
  const prefetchedSources = prefetchCollectionSources(
    hostId,
    screenNodes,
    options.collection,
  )
  const [layoutNodesChain, componentsRes, bulk] = await chromeBundle
  const [rawVariables, functions, workflows, pluginInstalls] = bulk
  const screenDatasets = await screenDatasetsPromise

  const composedNodes = Aglyn.composeLayoutChainAndScreenNodes(
    layoutNodesChain as any,
    screenNodes as any,
  )
  const graftedComponents = Aglyn.composeReusableComponentNodes(
    composedNodes as any,
    componentsRes.definitions as any,
  )
  /*
   * PLACED FORMS RESOLVE AGAINST THEIR ENTITY (`docs/specs/reusable-forms.md`).
   *
   * A form node bound to `hosts/{hostId}/forms/{formId}` renders that entity's
   * published design, so a form is edited once and every page placing it
   * follows. Without this the entity's tree was written on every publish and
   * read by nothing: the fields had to be redrawn per page, and the two copies
   * diverged the moment either was touched.
   *
   * The gate is the COMPONENT-grafted tree, not the screen's own nodes, for
   * the reason the repeatables gate below states: a form placed inside a
   * layout or a shared component does not exist in `screenNodes`, and a page
   * that renders one would silently keep its stale inline copy.
   *
   * The second graft re-runs the component expansion deliberately. Instances
   * already expanded are skipped by their own prefix, so the repeat costs a
   * scan, and passing BOTH placement kinds is what expands a reusable
   * component nested inside a form's design — which the first pass could not
   * have seen, because that subtree was not in the tree yet.
   */
  const forms =
    (await screenFormsPromise)?.forms ??
    (Aglyn.placesFormEntity(graftedComponents as any)
      ? (await getForms({ hostId })).forms
      : undefined)
  const grafted = forms
    ? Aglyn.composeReusableComponentNodes(
        graftedComponents as any,
        componentsRes.definitions as any,
        [Aglyn.placedFormPlacement(forms as any)],
      )
    : graftedComponents
  // Computed variables (AGL-129): workflow-backed values resolve once per
  // compose; failures keep each variable's stored fallback.
  const variables = Aglyn.resolveComputedVariables(
    rawVariables,
    functions,
    workflows,
  )
  // Repeatables (AGL-103) expand after grafting (so they work inside
  // reusable components) and before bindings (so {{name}} tokens inside
  // cloned items still resolve).
  //
  // The datasets themselves are fetched only if this tree actually repeats
  // (AGL-1440). `expandRepeatables` returns its input untouched when no node
  // carries `repeatDataset`, so on every other page the up-to-5,050 reads
  // bought nothing at all. The gate is the composed tree — after grafting —
  // because that is the map the expansion reads: a repeatable living in a
  // layout or a reusable component is invisible in `screenNodes`, and gating
  // on the screen alone would silently render one template row where the
  // author put a list. When the screen DID declare one, the read is already in
  // hand from the batch above and this costs no extra round trip.
  const datasets =
    screenDatasets ??
    (Aglyn.hasRepeatableNodes(grafted as any)
      ? await getDatasets({ hostId })
      : undefined)
  const repeated = Aglyn.expandRepeatables(grafted as any, datasets)
  // Collection entries blocks (AGL-551) expand alongside repeatables:
  // per-entry {{entry.*}} tokens substitute inside the clones here, while
  // page-level tokens wait for resolveNamedTokens below.
  const withEntries = await expandCollectionEntryBlocks(
    hostId,
    repeated,
    options.collection,
    prefetchedSources,
  )
  // Entry Meta blocks (AGL-1385): fill in the routed entry's date/category/
  // tags. Needs no source fetch — the routed entry and its taxonomy are
  // already in hand — so it sits outside `expandCollectionEntryBlocks`, which
  // returns early when no block asks for a collection read. AFTER it, so the
  // per-entry clones it just produced already carry their own resolved values
  // and are skipped.
  const withEntryMeta = Aglyn.expandCollectionEntryMeta(
    withEntries as any,
    options.collection?.entry,
    options.collection?.categories,
  )
  // Entry Author cards (AGL-2486): the same fill, one block over. Its values
  // come off the author RECORD the routed entry resolved to, which the
  // collection read has already attached, so this costs nothing either.
  const withEntryAuthor = Aglyn.expandCollectionEntryAuthor(
    withEntryMeta as any,
    options.collection?.entry,
  )
  const bound = Aglyn.resolveNodesBindings(
    withEntryAuthor as any,
    variables,
    functions,
  )
  // Host variables (AGL-1022): `{{host.*}}` resolves from the INSTALLING
  // site, late — at render, never at install — so a rebrand propagates to
  // every artifact that names the host instead of hard-coding it. Same
  // registry the email path uses, so a token means one thing in both.
  const withHostTokens = Aglyn.resolveNodesHostTokens(
    bound as any,
    options.host,
  )
  // Function widgets run client-side: embed their definitions (AGL-93).
  const withFunctions = Aglyn.attachFunctionDefinitions(
    withHostTokens,
    functions,
  )
  // Marketplace plugins (AGL-45): stamp each marketplacePlugin node with its
  // pinned install (version/sha256/capabilities) + kill-switch state.
  const nodes = Aglyn.attachPluginInstalls(withFunctions, pluginInstalls)
  // Entry-template tokens (AGL-105): {{entry.*}} from the rendered entry.
  const finalNodes = Aglyn.resolveNamedTokens(nodes as any, options.tokens)
  // The document's one `main` landmark (AGL-2486). LAST, so it reads the tree
  // the page actually ships — a slot grafted from a layout chain, an element
  // an author chose — rather than the screen as stored.
  const withLandmark = Aglyn.stampDocumentLandmark(finalNodes as any)
  return Aglyn.canvas.processNodesToDenormalized(withLandmark as any)
}

/**
 * Full published-render composition for one screen (extracted for AGL-87 so
 * the SSG path and the password-unlock API build identical trees): applies
 * a due publish schedule, loads the version, composes the shared layout
 * chrome, grafts reusable components, and denormalizes.
 */
export async function composeScreenNodes(options: {
  hostId: string
  screenId: string
  screen: Aglyn.AglynScreen
  /** Entry-template tokens (AGL-105) substituted before denormalize. */
  tokens?: Record<string, string>
  /** Routed content collection (AGL-551) for Collection entries blocks. */
  collection?: ComposeCollectionContext
  /**
   * Compose a specific version instead of the published one (AGL-253):
   * experiment variants point at versions; schedules don't apply.
   */
  versionId?: string
  /** The host document, for `host.*` tokens (AGL-1022). */
  host?: Aglyn.HostTokenSource | null
}): Promise<Record<string, any> | null> {
  const { hostId, screenId, screen } = options

  const effectiveVersionId = options.versionId
    ? null
    : await applyDuePublishSchedule({
        hostId,
        collectionName: 'screens',
        docId: screenId,
        parent: screen,
      })
  const versionId = (options.versionId ??
    effectiveVersionId ??
    screen.versionId) as string

  /*
   * OVERLAP THE VERSION READ WITH THE CHROME BUNDLE (AGL-1428).
   *
   * `composeNodesWithChrome`'s reads are keyed by `hostId`/`layoutId`, both
   * of which are in hand here, so the version read no longer has to finish
   * before they start. Handing the promise over instead of the resolved
   * value is the whole change: it is `composeNodesWithChrome` that decides
   * when it actually needs the nodes.
   *
   * The `versionId`-less screen still exits BEFORE anything is issued, so a
   * screen that has never been published costs no reads. What remains is the
   * narrow case of a `versionId` that points at a missing or unreadable
   * version document — a data-integrity fault rather than a routing outcome
   * — and that one now pays for a chrome bundle it discards. That is the
   * deliberate trade: one wasted bundle on a broken screen, against the
   * version read hiding under the chrome reads on every render that works.
   */
  if (!versionId) return null

  const versionPromise = getScreenVersion({ hostId, screenId, versionId })

  /*
   * NEITHER DERIVED PROMISE MAY REJECT ON ITS OWN.
   *
   * `composed` is discarded on every failure path below, and a rejected
   * promise nobody awaited is an unhandled rejection — which in Node takes
   * the whole render process down instead of letting this 404. So the nodes
   * handed to the compose absorb the failure (an empty tree it will never be
   * asked for), and `composed` gets a rejection handler attached the moment
   * it exists rather than at the point we decide to drop it. The real error
   * still propagates, from the `await versionPromise` below, exactly where it
   * did when this function awaited the version directly.
   */
  const composed = composeNodesWithChrome({
    hostId,
    // Version-first (key-present wins, null = explicitly no layout), screen
    // fallback — resolved as a promise so only the layout-chain walk waits on
    // the version read; the rest of the chrome bundle keeps the AGL-1428
    // overlap. A failed version read falls back to the screen binding; the
    // whole compose is discarded on that path anyway.
    layoutId: versionPromise.then(
      (res) =>
        res.version && 'layoutId' in res.version
          ? ((res.version as Aglyn.AglynScreenVersion).layoutId as
              | string
              | null)
          : (screen.layoutId as string | undefined),
      () => screen.layoutId as string | undefined,
    ),
    screenNodes: versionPromise.then(
      (res) => (res.version?.nodes ?? {}) as any,
      () => ({}) as any,
    ),
    tokens: options.tokens,
    collection: options.collection,
    host: options.host,
  })
  void composed.catch(() => undefined)

  const versionRes = await versionPromise
  if (versionRes.error || !versionRes.version) return null

  return composed
}

export default composeScreenNodes
