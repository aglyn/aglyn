package com.aglyn.core

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

data class WorkspaceOrg(val id: String, val name: String, val slug: String, val role: String)

data class WorkspaceSite(
  val id: String,
  val orgId: String,
  val name: String,
  val subdomain: String,
  val role: String,
  /**
   * The site's favicon as the membership row mirrors it (`favicon`, the host's `seo.favicon`): a reference, a CDN path
   * or an address, shown through [mediaPreviewUrl] as the console's `HostIcon` resolves it.
   */
  val favicon: String? = null,
  /** The site's custom domain as the membership row mirrors it (`cname`), or null; see [address]. */
  val cname: String? = null,
) {
  /** The address its rows show: the custom domain, else the platform address ([siteListAddress]). */
  val address: String? get() = siteListAddress(cname, subdomain)

  /**
   * The address with the host's own document at hand ([hostCname], its `cname`): that first, then the membership row's
   * copy, then the platform address, the order every site address follows in both apps.
   */
  fun addressWith(hostCname: String?): String? = siteListAddress(hostCname?.trim()?.ifEmpty { null } ?: cname, subdomain)
}

/**
 * A workspace's logos as its own document keeps them (`logoUrl`, `logoDarkUrl`): the membership index carries none, so
 * the console's switcher reads each workspace's document for them, and so does [WorkspaceStore].
 */
data class WorkspaceOrgLogo(
  val light: String?,
  val dark: String?,
  /** The workspace's own brand color (`brandingProfile.primaryColor`, white-label workspaces), `#RRGGBB`. */
  val brandColor: String? = null,
  /** The plugins the workspace keeps on (`enabledPlugins`), null for the defaults. */
  val enabledPlugins: List<String>? = null,
  /** The plan in force, as the console's plan chip names it. */
  val plan: String? = null,
  /**
   * The white-label mark (`brandingProfile.faviconUrl` / `faviconDarkUrl`), which the console's chrome wears in place of
   * the platform's when the workspace is entitled to `whiteLabel` (`resolveBrandingProfile`).
   */
  val brandMark: String? = null,
  val brandMarkDark: String? = null,
  /** Custom-priced or flagged Enterprise, as the console's `isEnterpriseOrg` reads it: nothing to upgrade to. */
  val enterprise: Boolean = false,
  /** The workspace's own release-flag overrides (`releaseFlags`), which win over the published values. */
  val releaseFlags: Map<String, Any?>? = null,
) {
  companion object {
    fun from(data: Map<String, Any?>?): WorkspaceOrgLogo = WorkspaceOrgLogo(
      light = (data?.get("logoUrl") as? String)?.ifBlank { null },
      dark = (data?.get("logoDarkUrl") as? String)?.ifBlank { null },
      brandColor = ((data?.get("brandingProfile") as? Map<*, *>)?.get("primaryColor") as? String)?.takeIf { com.aglyn.contracts.isAccountColor(it) },
      enabledPlugins = (data?.get("enabledPlugins") as? List<*>)?.filterIsInstance<String>(),
      plan = data?.let { effectivePlan(it) },
      brandMark = ((data?.get("brandingProfile") as? Map<*, *>)?.get("faviconUrl") as? String)?.trim()?.ifEmpty { null },
      brandMarkDark = ((data?.get("brandingProfile") as? Map<*, *>)?.get("faviconDarkUrl") as? String)?.trim()?.ifEmpty { null },
      releaseFlags = (data?.get("releaseFlags") as? Map<*, *>)?.entries?.associate { it.key.toString() to it.value },
      enterprise = data?.get("enterprise") == true || data?.get("plan") == "enterprise" ||
        (((data?.get("subscription") as? Map<*, *>)?.get("customMonthlyUsd") as? Number)?.toDouble() ?: 0.0) > 0,
    )
  }
}

/** [whole]: the whole workspace is on screen, no site (the workspace scope). */
@Serializable
data class WorkspacePick(val orgId: String? = null, val hostId: String? = null, val whole: Boolean = false)

data class WorkspaceState(
  val orgs: List<WorkspaceOrg> = emptyList(),
  val sites: List<WorkspaceSite> = emptyList(),
  val org: WorkspaceOrg? = null,
  val site: WorkspaceSite? = null,
  /** False until the org list (and, with an org, its sites) has arrived once. */
  val ready: Boolean = false,
  val error: String? = null,
  /**
   * Whether the workspace window is full, so the list is not known to be complete (the console's `hasMoreOrgs`):
   * [WorkspaceStore.loadMoreOrgs] grows it.
   */
  val hasMoreOrgs: Boolean = false,
  /** Each workspace's logos read so far, by workspace id: the shown one's always, the others' once the switcher asks. */
  val orgLogos: Map<String, WorkspaceOrgLogo> = emptyMap(),
  /** The person is looking at the whole workspace rather than one of its sites. */
  val wholeWorkspace: Boolean = false,
) {
  /** The shown workspace's logos; null until read. */
  val orgLogo: WorkspaceOrgLogo? get() = org?.let { orgLogos[it.id] }
}

/**
 * The workspace and site the person is working in: `users/{uid}/orgs` and
 * `users/{uid}/hostMemberships where orgId ==`, with the last pick remembered
 * per person. The same queries and the same healing rules as the console's
 * switcher, so a stale pick (a removed site, a left workspace) falls back to
 * the first one that exists.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class WorkspaceStore(
  private val scope: CoroutineScope,
  auth: AuthSession,
  private val firestore: FirestoreReader,
  private val prefs: KeyValueStore,
) {
  private val picked = MutableStateFlow(WorkspacePick())
  private val restoredFor = MutableStateFlow<String?>(null)

  /** How many memberships the listener holds: a page, not a ceiling (the console's `ORG_PAGE_SIZE`, AGL-2336). */
  private val orgWindow = MutableStateFlow(ORG_WINDOW)

  /** Whether the last answer filled the window. */
  private val orgsFull = MutableStateFlow(false)

  /** Each workspace's logos read so far, and the ids already asked for. */
  private val logos = MutableStateFlow<Map<String, WorkspaceOrgLogo>>(emptyMap())
  private val logosAsked = mutableSetOf<String>()

  private val uid = auth.state
    .map { (it as? AuthState.SignedIn)?.user?.uid }
    .distinctUntilChanged()
    .onEach { uid ->
      picked.value = uid?.let { restore(it) } ?: WorkspacePick()
      orgWindow.value = ORG_WINDOW
      restoredFor.value = uid
    }
    .stateIn(scope, SharingStarted.Eagerly, null)

  private val orgs = combine(uid, orgWindow) { uid, window -> uid to window }.flatMapLatest { (uid, window) ->
    if (uid == null) {
      flowOf<Live<List<WorkspaceOrg>>>(Live.Loading)
    } else {
      firestore.observe(FirestoreQuery("users/$uid/orgs", limit = window)).map { live ->
        when (live) {
          is Live.Ready -> {
            orgsFull.value = live.value.size >= window
            Live.Ready(
              live.value.map { orgFromMembership(it.id, it.data) }
                .sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { it.name }),
            )
          }
          is Live.Failed -> live
          Live.Loading -> Live.Loading
        }
      }
    }
  }.stateIn(scope, SharingStarted.Eagerly, Live.Loading)

  private val orgId = combine(restoredFor, orgs, picked) { restored, orgs, picked ->
    val list = (orgs as? Live.Ready)?.value
    if (restored == null || list == null) null else restored to reconcilePick(picked, list, null).orgId
  }.distinctUntilChanged()

  private val sites = orgId.flatMapLatest { pair ->
    val (uid, orgId) = pair ?: (null to null)
    if (uid == null || orgId == null) {
      flowOf<Live<List<WorkspaceSite>>>(Live.Loading)
    } else {
      firestore.observe(
        FirestoreQuery(
          "users/$uid/hostMemberships",
          filters = listOf(FirestoreFilter("orgId", FilterOp.EQ, orgId)),
          orderBy = listOf(FirestoreOrder("nameLower")),
          limit = SITE_WINDOW,
        ),
      ).map { live ->
        when (live) {
          is Live.Ready -> Live.Ready(live.value.map { siteFromMembership(it.id, it.data) })
          is Live.Failed -> live
          Live.Loading -> Live.Loading
        }
      }
    }
  }.stateIn(scope, SharingStarted.Eagerly, Live.Loading)

  init {
    // The shown workspace's own document, read live, so a new logo reaches the drawer's footer.
    orgId.flatMapLatest { pair ->
      val orgId = pair?.second
      if (orgId == null) flowOf(null) else firestore.observeDoc("orgs/$orgId").map { live ->
        (live as? Live.Ready)?.let { orgId to WorkspaceOrgLogo.from(it.value?.data) }
      }
    }.onEach { entry -> if (entry != null) logos.value = logos.value + entry }.launchIn(scope)
  }

  val state: StateFlow<WorkspaceState> = combine(restoredFor, orgs, sites, picked, logos) { restored, orgs, sites, picked, logos ->
    val orgList = (orgs as? Live.Ready)?.value
    val siteList = (sites as? Live.Ready)?.value
    val error = when {
      orgs is Live.Failed -> "Could not load your workspaces."
      sites is Live.Failed -> "Could not load the sites in this workspace."
      else -> null
    }
    if (restored == null || orgList == null) return@combine WorkspaceState(error = error)
    val effective = reconcilePick(picked, orgList, siteList)
    // Remember what is actually shown, so a stale pick heals on disk too.
    persist(restored, effective)
    WorkspaceState(
      orgs = orgList,
      sites = siteList ?: emptyList(),
      org = orgList.firstOrNull { it.id == effective.orgId },
      site = siteList?.firstOrNull { it.id == effective.hostId },
      ready = orgList.isEmpty() || siteList != null,
      error = error,
      hasMoreOrgs = orgsFull.value,
      orgLogos = logos,
      wholeWorkspace = effective.whole || (siteList != null && siteList.isEmpty()),
    )
  }.stateIn(scope, SharingStarted.Eagerly, WorkspaceState())

  /**
   * Reads each of these workspaces' logos from its own document, once (the console's switcher reads its rows' logos the
   * same way, `useOrgRows`).
   */
  fun loadLogos(orgIds: List<String>) {
    for (orgId in orgIds) {
      if (!logosAsked.add(orgId) || orgId in logos.value) continue
      scope.launch {
        val doc = runCatching { firestore.get("orgs/$orgId") }.getOrNull()
        logos.value = logos.value + (orgId to WorkspaceOrgLogo.from(doc?.data))
      }
    }
  }

  /** Grows the workspace window by a page (the console's `loadMoreOrgs`); the listener re-subscribes with it. */
  fun loadMoreOrgs() {
    orgWindow.value += ORG_WINDOW
  }

  /**
   * Opens a workspace where the person last was in it: the whole workspace or the site they had open, remembered per
   * workspace on this device. A workspace never opened here opens on the whole workspace.
   */
  fun selectOrg(orgId: String) {
    reportPick(orgId, null)
    val remembered = restoredFor.value?.let { uid -> prefs.get(scopeKey(uid, orgId)) }
    picked.value = when (remembered) {
      null, WHOLE -> WorkspacePick(orgId, null, whole = true)
      else -> WorkspacePick(orgId, remembered)
    }
  }

  /** Shows the whole workspace on screen, no site. */
  fun selectWholeWorkspace() {
    picked.value = WorkspacePick(state.value.org?.id ?: picked.value.orgId, null, whole = true)
  }

  /**
   * Picks a site in the workspace on screen. The pick names that workspace
   * too: a fresh install has remembered none, and a site picked under a
   * workspace the pick does not name would fall back to the first site.
   */
  fun selectSite(hostId: String?) {
    reportPick(state.value.org?.id, hostId)
    picked.value = WorkspacePick(state.value.org?.id ?: picked.value.orgId, hostId)
  }

  /**
   * Picks a workspace and one of its sites at once, as a notification about
   * that site does: the site holds once the workspace's sites have loaded and
   * name it, and falls back to the first one otherwise.
   */
  fun select(orgId: String, hostId: String?) {
    reportPick(orgId, hostId)
    picked.value = WorkspacePick(orgId, hostId)
  }

  /** Puts exactly this scope on screen: [hostId]'s site, or the whole workspace when it is null (a window tab's own). */
  fun selectScope(orgId: String, hostId: String?) {
    picked.value = WorkspacePick(orgId, hostId, whole = hostId == null)
  }

  /**
   * Analytics for a pick (AGL-4067): `workspace_switch` when another workspace replaces the one on show, `site_open` when
   * a site is opened. No ids or names go with either.
   */
  private fun reportPick(orgId: String?, hostId: String?) {
    val shown = state.value
    val current = shown.org?.id
    if (orgId != null && current != null && orgId != current) Telemetry.event(TelemetryEvent.WORKSPACE_SWITCH)
    if (hostId != null && hostId != shown.site?.id) Telemetry.event(TelemetryEvent.SITE_OPEN)
  }

  private fun restore(uid: String): WorkspacePick =
    prefs.get(storageKey(uid))?.let { runCatching { Json.decodeFromString<WorkspacePick>(it) }.getOrNull() }
      ?: WorkspacePick()

  private fun persist(uid: String, pick: WorkspacePick) {
    val encoded = Json.encodeToString(WorkspacePick.serializer(), pick)
    if (prefs.get(storageKey(uid)) != encoded) prefs.set(storageKey(uid), encoded)
    val orgId = pick.orgId ?: return
    val scope = if (pick.whole) WHOLE else pick.hostId ?: return
    if (prefs.get(scopeKey(uid, orgId)) != scope) prefs.set(scopeKey(uid, orgId), scope)
  }

  companion object {
    /** The workspace window the switcher loads; matches the console's first page. */
    const val ORG_WINDOW = 50
    const val SITE_WINDOW = 100

    fun storageKey(uid: String) = "aglyn.workspace.$uid"
    fun scopeKey(uid: String, orgId: String) = "aglyn.scope.$uid.$orgId"
    private const val WHOLE = "*"

    fun orgFromMembership(id: String, data: Map<String, Any?>): WorkspaceOrg = WorkspaceOrg(
      id = id,
      name = (data["orgName"] ?: data["slug"] ?: id).toString(),
      slug = (data["slug"] ?: id).toString(),
      role = (data["role"] ?: "").toString(),
    )

    fun siteFromMembership(id: String, data: Map<String, Any?>): WorkspaceSite {
      val subdomain = (data["subdomain"] ?: "").toString()
      return WorkspaceSite(
        id = id,
        orgId = (data["orgId"] ?: "").toString(),
        name = (data["displayName"] ?: subdomain.ifEmpty { id }).toString(),
        subdomain = subdomain,
        role = (data["role"] ?: "").toString(),
        favicon = (data["favicon"] as? String)?.ifBlank { null },
        cname = (data["cname"] as? String)?.trim()?.ifBlank { null },
      )
    }

    /**
     * Whether the site that was on screen ([shownOrgId]'s [shownHostId]) has left that workspace's loaded sites: deleted
     * (here, on the web or on another device) or taken away from the person. The shell then shows the whole workspace's
     * Sites, never another site in its place: whatever screen of the gone site was open, its Danger zone included, would
     * otherwise stay open on the next site.
     */
    fun shownSiteRemoved(shownOrgId: String?, shownHostId: String?, state: WorkspaceState): Boolean =
      shownHostId != null && state.ready && state.org?.id == shownOrgId && state.sites.none { it.id == shownHostId }

    /** Which org and site to show, given what is remembered and what exists. */
    fun reconcilePick(
      picked: WorkspacePick,
      orgs: List<WorkspaceOrg>,
      sites: List<WorkspaceSite>?,
    ): WorkspacePick {
      val orgId = if (orgs.any { it.id == picked.orgId }) picked.orgId else orgs.firstOrNull()?.id
      if (picked.whole && orgId == picked.orgId) return WorkspacePick(orgId, null, whole = true)
      // A remembered site belongs to the remembered workspace only. When the
      // workspace falls back, so does the site: to the first one in [sites],
      // which the store loads for the effective workspace.
      if (orgId != picked.orgId) return WorkspacePick(orgId, sites?.firstOrNull()?.id)
      if (sites == null) return WorkspacePick(orgId, picked.hostId)
      val hostId = if (sites.any { it.id == picked.hostId }) picked.hostId else sites.firstOrNull()?.id
      return WorkspacePick(orgId, hostId)
    }
  }
}
