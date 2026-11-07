package com.aglyn.pluginhost

import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import com.aglyn.contracts.memberPermissions
import com.aglyn.contracts.sitePermissions
import com.aglyn.core.Live
import com.aglyn.core.OrgAccess
import kotlinx.coroutines.flow.flowOf

/**
 * The signed-in person's member row in [orgId], read live
 * (`orgs/{orgId}/members/{uid}`) and turned into what it grants: whether they
 * reach the whole workspace, and the scope tokens a list of org-shared
 * resources (datasets, campaigns, media) must be filtered by, since the rules
 * refuse an unfiltered list to a member scoped to some sites. A refused read
 * is a member with no row, never an org-wide one.
 */
@Composable
fun rememberOrgAccess(context: NativePluginContext, orgId: String): Live<OrgAccess> {
  val member by remember(orgId, context.uid, context.firestore) { context.firestore.observeDoc("orgs/$orgId/members/${context.uid}") }
    .collectAsState(Live.Loading)
  return when (val live = member) {
    Live.Loading -> Live.Loading
    is Live.Failed -> Live.Ready(OrgAccess.fromMember(null))
    is Live.Ready -> Live.Ready(OrgAccess.fromMember(live.value))
  }
}

/**
 * What the signed-in person holds, live: the verdict on every catalog key in the workspace, and the same on the site in
 * view. A key is what a gate asks; a role is only a preset of keys. For what to show only: the routes and rules decide.
 */
data class MemberPermissions(val workspace: Map<String, Boolean>, val site: Map<String, Boolean>) {
  /** Whether they hold [key] here: on a site, that site's verdict, else the workspace's. */
  fun can(key: String): Boolean = site[key] == true
}

/**
 * [MemberPermissions] read live from the member row (`resolvedPermissions`), their custom role and the site's own stamp
 * (`hosts/{hostId}.memberPermissions[uid]`). Until the row is read, the role the membership index names answers.
 */
@Composable
fun rememberMemberPermissions(firestore: com.aglyn.core.FirestoreReader, orgId: String?, hostId: String?, uid: String, orgRole: String?): MemberPermissions {
  fun read(path: String?) = path?.let { firestore.observeDoc(it) } ?: flowOf(Live.Loading)
  val member by remember(orgId, uid, firestore) { read(orgId?.let { "orgs/$it/members/$uid" }) }.collectAsState(Live.Loading)
  val memberData = (member as? Live.Ready)?.value?.data
  val roleId = memberData?.get("roleId") as? String
  val customRole by remember(orgId, roleId, firestore) { read(if (orgId != null && roleId != null) "orgs/$orgId/roles/$roleId" else null) }.collectAsState(Live.Loading)
  val site by remember(hostId, firestore) { read(hostId?.let { "hosts/$it" }) }.collectAsState(Live.Loading)
  val customRoleData = (customRole as? Live.Ready)?.value?.data
  val siteData = (site as? Live.Ready)?.value?.data
  return remember(memberData, orgRole, customRoleData, siteData, uid) {
    val workspace = memberPermissions(memberData, orgRole, customRoleData)
    MemberPermissions(workspace, sitePermissions(workspace, siteData, uid))
  }
}

/** [rememberMemberPermissions] for where this context stands. */
@Composable
fun rememberMemberPermissions(context: NativePluginContext): MemberPermissions =
  rememberMemberPermissions(context.firestore, context.orgId, context.hostId, context.uid, context.orgRole)

/** The scope clause [access] needs on an org-shared list: none for an org-wide member, their tokens otherwise. */
fun OrgAccess.listScopeTokens(): List<String>? = if (orgWide) null else tokens

/*
 * A resource's sharing scope (`visibleTo`), as scope-tokens.ts words and
 * checks it; the data plugin's tests replay the console's answers.
 */

/** The most sites one stored scope may name (`MAX_SCOPE_HOSTS`). */
const val MAX_SCOPE_HOSTS = 30

private fun hostIdsOf(visibleTo: List<String>?): List<String> =
  visibleTo.orEmpty().filter { it.startsWith("host:") && it.length > 5 }.map { it.removePrefix("host:") }

/** "All sites", "Bakery only", "3 sites" or "No sites" (`describeScope`). */
fun describeScope(visibleTo: List<String>?, hostNames: Map<String, String> = emptyMap()): String {
  if (visibleTo != null && OrgAccess.ORG_SCOPE_TOKEN in visibleTo) return "All sites"
  val hostIds = hostIdsOf(visibleTo)
  return when (hostIds.size) {
    0 -> "No sites"
    1 -> hostNames[hostIds[0]]?.let { "$it only" } ?: "1 site"
    else -> "${hostIds.size} sites"
  }
}

/** The `scopeMode` a document kept up by the all-except sweep carries (`SCOPE_MODE_ALL_EXCEPT`). */
const val SCOPE_MODE_ALL_EXCEPT = "allExcept"

/** How a document is shared, as a person would choose it (`ScopeSharing`). */
sealed interface ScopeSharing {
  data object All : ScopeSharing
  data class Selected(val hostIds: List<String>) : ScopeSharing
  data class AllExcept(val exceptHostIds: List<String>, val includedHostIds: List<String>) : ScopeSharing
  data object None : ScopeSharing
}

/**
 * The excluded sites a marker names, or null when the marker is not one to act on (anything but host tokens), so a
 * damaged marker never reads as "except nothing".
 */
private fun markerExceptHostIds(doc: Map<String, Any?>?): List<String>? {
  if (doc?.get("scopeMode") != SCOPE_MODE_ALL_EXCEPT) return null
  val except = doc["scopeExcept"] as? List<*> ?: return null
  val ids = mutableListOf<String>()
  for (token in except) {
    val text = token as? String ?: return null
    if (!text.startsWith("host:") || text.length <= 5) return null
    ids += text.removePrefix("host:")
  }
  return ids.filter { it.isNotEmpty() }.distinct()
}

/**
 * How a document is shared (`scopeSharingOf`). The marker is read only where it agrees with what readers enforce: a
 * document carrying `org` is All sites whatever a marker beside it says, and a damaged marker reads as the chosen sites.
 */
fun scopeSharingOf(doc: Map<String, Any?>?): ScopeSharing {
  val tokens = (doc?.get("visibleTo") as? List<*>)?.filterIsInstance<String>()
  if (tokens != null && OrgAccess.ORG_SCOPE_TOKEN in tokens) return ScopeSharing.All
  val included = hostIdsOf(tokens).filter { it.isNotEmpty() }.distinct()
  val except = if (tokens != null) markerExceptHostIds(doc) else null
  if (except != null) return ScopeSharing.AllExcept(except, included)
  return if (included.isEmpty()) ScopeSharing.None else ScopeSharing.Selected(included)
}

/**
 * The sentence for how a document is shared (`describeSharing`): [describeScope], plus "All sites except …". Sites are
 * named only where [hostNames] has them, so a reader who cannot see a site's name is told how many, never an id.
 */
fun describeSharing(doc: Map<String, Any?>?, hostNames: Map<String, String> = emptyMap()): String {
  val sharing = scopeSharingOf(doc)
  if (sharing !is ScopeSharing.AllExcept) return describeScope((doc?.get("visibleTo") as? List<*>)?.filterIsInstance<String>(), hostNames)
  if (sharing.includedHostIds.isEmpty()) return "No sites"
  val names = sharing.exceptHostIds.map { hostNames[it] }
  if (names.size == 1) return "All sites except ${names[0] ?: "1 site"}"
  if (names.size == 2 && names.all { it != null }) return "All sites except ${names[0]} and ${names[1]}"
  return "All sites except ${names.size} sites"
}

/** What a person picked (`ScopeSharingChoice`). */
sealed interface ScopeSharingChoice {
  data object All : ScopeSharingChoice
  data class Selected(val hostIds: List<String>) : ScopeSharingChoice
  data class AllExcept(val exceptHostIds: List<String>) : ScopeSharingChoice
}

/** What a sharing choice writes (`ScopeSharingFields`): a null marker means the document must not carry it. */
data class ScopeSharingFields(val visibleTo: List<String>, val scopeMode: String?, val scopeExcept: List<String>?)

/**
 * What a sharing choice writes, or why it cannot be (`sharingFromChoice`). [orgHostIds] is the workspace's sites as the
 * writer read them; an exclusion naming a site no longer there is dropped.
 */
fun sharingFromChoice(
  choice: ScopeSharingChoice, orgHostIds: List<String>, maxIncluded: Int? = null, keepHostIds: List<String> = emptyList(),
): Pair<ScopeSharingFields?, String?> = when (choice) {
  ScopeSharingChoice.All -> ScopeSharingFields(listOf(OrgAccess.ORG_SCOPE_TOKEN), null, null) to null
  is ScopeSharingChoice.Selected -> {
    val (scope, problem) = scopeToStore(choice.hostIds.map { "host:$it" })
    if (scope == null) null to problem else ScopeSharingFields(scope, null, null) to null
  }
  is ScopeSharingChoice.AllExcept -> {
    val org = orgHostIds.filter { it.isNotEmpty() }.distinct()
    val except = choice.exceptHostIds.filter { it.isNotEmpty() }.distinct().filter { it in org }
    val kept = keepHostIds.toSet()
    val included = org.filter { it !in except || it in kept }.sorted()
    when {
      except.isEmpty() -> null to "Choose at least one site to leave out, or share with All sites."
      included.isEmpty() -> null to "Keep at least one site in, or choose the sites."
      maxIncluded != null && included.size > maxIncluded ->
        null to "This can reach ${if (maxIncluded == 1) "1 site" else "$maxIncluded sites"} at most. Leave out more sites, or choose the sites."
      else -> ScopeSharingFields(included.map { "host:$it" }, SCOPE_MODE_ALL_EXCEPT, except.map { "host:$it" }) to null
    }
  }
}

/** A picked scope as it may be stored, or the problem with it (`scopeToStore`). */
fun scopeToStore(input: List<String>?): Pair<List<String>?, String?> {
  val tokens = input.orEmpty().filter { it == OrgAccess.ORG_SCOPE_TOKEN || (it.startsWith("host:") && it.length > 5) }
  val scope = when {
    tokens.isEmpty() -> null
    OrgAccess.ORG_SCOPE_TOKEN in tokens -> listOf(OrgAccess.ORG_SCOPE_TOKEN)
    else -> tokens.distinct().takeIf { it.size <= MAX_SCOPE_HOSTS }
  }
  if (scope != null) return scope to null
  return null to if (tokens.isNotEmpty()) {
    "Choose $MAX_SCOPE_HOSTS sites or fewer, or share with All sites."
  } else {
    "Choose at least one site, or share with All sites."
  }
}

/** Whether [after] takes access away from a site [before] reached (`narrowsScope`). */
fun narrowsScope(before: List<String>?, after: List<String>?): Boolean {
  val wideBefore = before != null && OrgAccess.ORG_SCOPE_TOKEN in before
  val wideAfter = after != null && OrgAccess.ORG_SCOPE_TOKEN in after
  if (wideBefore) return !wideAfter
  if (wideAfter) return false
  val kept = after.orEmpty().toSet()
  return before.orEmpty().any { it !in kept }
}

/**
 * Whether [target] stays visible everywhere [source] is, for whole documents (`sharingCovers`): today's tokens are not
 * enough once either side is all-except, because both lists move when a site is added.
 */
fun sharingCovers(target: Map<String, Any?>?, source: Map<String, Any?>?): Boolean {
  val targetTokens = (target?.get("visibleTo") as? List<*>)?.filterIsInstance<String>()
  val sourceTokens = (source?.get("visibleTo") as? List<*>)?.filterIsInstance<String>()
  val sourceSharing = scopeSharingOf(source)
  if (sourceSharing is ScopeSharing.AllExcept) {
    when (val targetSharing = scopeSharingOf(target)) {
      ScopeSharing.All -> return true
      is ScopeSharing.AllExcept -> if (!targetSharing.exceptHostIds.all { it in sourceSharing.exceptHostIds }) return false
      else -> return false
    }
  }
  return scopeTokensCover(targetTokens, sourceTokens)
}

/** `scopeCovers`: an org-wide target covers anything; a restricted one, an org-wide source never, else every token. */
fun scopeTokensCover(target: List<String>?, source: List<String>?): Boolean {
  if (target.orEmpty().contains(OrgAccess.ORG_SCOPE_TOKEN)) return true
  if (source.orEmpty().contains(OrgAccess.ORG_SCOPE_TOKEN)) return false
  val reach = target.orEmpty().toSet()
  return source.orEmpty().all { it in reach }
}
