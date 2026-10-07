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
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.flow.stateIn
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

data class WorkspaceOrg(val id: String, val name: String, val slug: String, val role: String)

data class WorkspaceSite(
  val id: String,
  val orgId: String,
  val name: String,
  val subdomain: String,
  val role: String,
)

@Serializable
data class WorkspacePick(val orgId: String? = null, val hostId: String? = null)

data class WorkspaceState(
  val orgs: List<WorkspaceOrg> = emptyList(),
  val sites: List<WorkspaceSite> = emptyList(),
  val org: WorkspaceOrg? = null,
  val site: WorkspaceSite? = null,
  /** False until the org list (and, with an org, its sites) has arrived once. */
  val ready: Boolean = false,
  val error: String? = null,
)

/**
 * The workspace and site the person is working in: `users/{uid}/orgs` and
 * `users/{uid}/hostMemberships where orgId ==`, with the last pick remembered
 * per person. The same queries and the same healing rules as the console's
 * switcher, so a stale pick (a removed site, a left workspace) falls back to
 * the first one that exists.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class WorkspaceStore(
  scope: CoroutineScope,
  auth: AuthSession,
  private val firestore: FirestoreReader,
  private val prefs: KeyValueStore,
) {
  private val picked = MutableStateFlow(WorkspacePick())
  private val restoredFor = MutableStateFlow<String?>(null)

  private val uid = auth.state
    .map { (it as? AuthState.SignedIn)?.user?.uid }
    .distinctUntilChanged()
    .onEach { uid ->
      picked.value = uid?.let { restore(it) } ?: WorkspacePick()
      restoredFor.value = uid
    }
    .stateIn(scope, SharingStarted.Eagerly, null)

  private val orgs = uid.flatMapLatest { uid ->
    if (uid == null) {
      flowOf<Live<List<WorkspaceOrg>>>(Live.Loading)
    } else {
      firestore.observe(FirestoreQuery("users/$uid/orgs", limit = ORG_WINDOW)).map { live ->
        when (live) {
          is Live.Ready -> Live.Ready(
            live.value.map { orgFromMembership(it.id, it.data) }
              .sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { it.name }),
          )
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

  val state: StateFlow<WorkspaceState> = combine(restoredFor, orgs, sites, picked) { restored, orgs, sites, picked ->
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
    )
  }.stateIn(scope, SharingStarted.Eagerly, WorkspaceState())

  fun selectOrg(orgId: String) {
    picked.value = WorkspacePick(orgId, null)
  }

  /**
   * Picks a site in the workspace on screen. The pick names that workspace
   * too: a fresh install has remembered none, and a site picked under a
   * workspace the pick does not name would fall back to the first site.
   */
  fun selectSite(hostId: String?) {
    picked.value = WorkspacePick(state.value.org?.id ?: picked.value.orgId, hostId)
  }

  private fun restore(uid: String): WorkspacePick =
    prefs.get(storageKey(uid))?.let { runCatching { Json.decodeFromString<WorkspacePick>(it) }.getOrNull() }
      ?: WorkspacePick()

  private fun persist(uid: String, pick: WorkspacePick) {
    val encoded = Json.encodeToString(WorkspacePick.serializer(), pick)
    if (prefs.get(storageKey(uid)) != encoded) prefs.set(storageKey(uid), encoded)
  }

  companion object {
    /** The workspace window the switcher loads; matches the console's first page. */
    const val ORG_WINDOW = 50
    const val SITE_WINDOW = 100

    fun storageKey(uid: String) = "aglyn.workspace.$uid"

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
      )
    }

    /** Which org and site to show, given what is remembered and what exists. */
    fun reconcilePick(
      picked: WorkspacePick,
      orgs: List<WorkspaceOrg>,
      sites: List<WorkspaceSite>?,
    ): WorkspacePick {
      val orgId = if (orgs.any { it.id == picked.orgId }) picked.orgId else orgs.firstOrNull()?.id
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
