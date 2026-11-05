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
  val siteStamp = ((site as? Live.Ready)?.value?.data?.get("memberPermissions") as? Map<*, *>)?.get(uid) as? Map<*, *>
  return remember(memberData, orgRole, customRoleData, siteStamp) {
    val workspace = memberPermissions(memberData, orgRole, customRoleData)
    @Suppress("UNCHECKED_CAST")
    MemberPermissions(workspace, sitePermissions(workspace, siteStamp as Map<String, Any?>?))
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
