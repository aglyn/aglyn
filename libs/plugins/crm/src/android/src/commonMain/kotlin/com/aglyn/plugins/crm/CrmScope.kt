package com.aglyn.plugins.crm

import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestoreReader
import com.aglyn.core.Live
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine

/*
 * WHO IS READING THE CRM, AND WHAT THEY STAMP (the console's `useCrmScope`).
 *
 * Every CRM row carries `visibleTo`, and every listener asks for it:
 * `visibleTo array-contains-any` the reader's tokens. On a site that is
 * `crmReadTokens(group)`, the org's own token and the site's consent group,
 * narrowed to the member's reach when the group is a declared one. A record
 * this viewer creates is stamped `crmScopeTokens(org, group)`: the whole org
 * when the org shares by default, else the group's sites.
 *
 * The consent groups are the org document's `consentGroups`, read as
 * `readConsentGroups` reads them (malformed entries dropped, a site claimed
 * twice dropped from both). Ported here and replayed against the console's
 * own answers (function-cases.generated.json).
 */

const val ORG_SCOPE_TOKEN = "org"
const val MAX_SCOPE_HOSTS = 30
const val MAX_CONSENT_GROUP_HOSTS = 30
const val CONSENT_GROUPS_FIELD = "consentGroups"

fun hostScopeToken(hostId: String) = "host:$hostId"

data class ConsentGroup(
  val hostId: String,
  val groupId: String,
  val name: String?,
  val hostIds: List<String>,
  val declared: Boolean,
)

fun soloConsentGroup(hostId: String) = ConsentGroup(hostId, hostId, null, listOf(hostId), false)

private data class StoredGroup(val name: String, val hostIds: List<String>)

private fun consentGroupSiteIds(org: Map<String, Any?>, raw: Map<String, Any?>): Set<String> {
  val ids = linkedSetOf<String>()
  when (val hosts = org["hosts"]) {
    is List<*> -> hosts.filterIsInstance<String>().filter { it.isNotEmpty() }.forEach { ids += it }
    is Map<*, *> -> hosts.keys.map { it.toString() }.filter { it.isNotEmpty() }.forEach { ids += it }
  }
  for (value in raw.values) {
    val hostIds = (value as? Map<*, *>)?.get("hostIds") as? List<*> ?: continue
    for (id in hostIds) id?.toString()?.trim()?.takeIf { it.isNotEmpty() }?.let { ids += it }
  }
  return ids
}

private fun readConsentGroups(org: Map<String, Any?>?): Map<String, StoredGroup> {
  @Suppress("UNCHECKED_CAST")
  val raw = org?.get(CONSENT_GROUPS_FIELD) as? Map<String, Any?> ?: return emptyMap()
  val siteIds = consentGroupSiteIds(org, raw)
  val usable = linkedMapOf<String, StoredGroup>()
  for ((groupId, value) in raw) {
    val group = value as? Map<*, *> ?: continue
    if (groupId.isEmpty() || groupId in siteIds) continue
    val name = (group["name"] as? String)?.trim().orEmpty()
    if (name.isEmpty()) continue
    val hostIds = (group["hostIds"] as? List<*>).orEmpty().map { it?.toString()?.trim().orEmpty() }.filter { it.isNotEmpty() }.distinct().sorted()
    if (hostIds.size < 2 || hostIds.size > MAX_CONSENT_GROUP_HOSTS) continue
    usable[groupId] = StoredGroup(name, hostIds)
  }
  val claims = usable.values.flatMap { it.hostIds }.groupingBy { it }.eachCount()
  val contested = claims.filterValues { it > 1 }.keys
  if (contested.isEmpty()) return usable
  return usable.filterValues { group -> group.hostIds.none { it in contested } }
}

/** The consent group a site belongs to: a declared one that names it, else the site alone. */
fun consentGroupForHost(org: Map<String, Any?>?, hostId: String): ConsentGroup {
  for ((groupId, group) in readConsentGroups(org)) {
    if (hostId in group.hostIds) return ConsentGroup(hostId, groupId, group.name, group.hostIds, true)
  }
  return soloConsentGroup(hostId)
}

fun consentGroupScope(group: ConsentGroup): List<String> = group.hostIds.map(::hostScopeToken)

/** `crmDefaultScopeOf`: `crm.defaultRecordScope`, else the legacy `defaultResourceScope`. */
fun crmDefaultScopeOf(org: Map<String, Any?>?): String? {
  val own = (org?.get("crm") as? Map<*, *>)?.get("defaultRecordScope")
  if (own == "org" || own == "host") return own as String
  val legacy = org?.get("defaultResourceScope")
  return if (legacy == "org" || legacy == "host") legacy as String else null
}

/** What a record this viewer creates is stamped with. */
fun crmScopeTokens(org: Map<String, Any?>?, group: ConsentGroup): List<String> =
  if (crmDefaultScopeOf(org) == "org") listOf(ORG_SCOPE_TOKEN) else consentGroupScope(group)

/** What a reader of this group lists by: the org's token, then the group's sites, capped. */
fun crmReadTokens(group: ConsentGroup): List<String> = (listOf(ORG_SCOPE_TOKEN) + consentGroupScope(group)).take(MAX_SCOPE_HOSTS)

private val CRM_PLANS = setOf("starter", "pro", "business", "scale", "advanced", "agency", "enterprise")
private val LAPSED = setOf("canceled", "unpaid", "incomplete", "incomplete_expired")

/** Whether the org carries the CRM suite, as the rules' `crmSuiteCarried` decides it. */
fun crmSuiteCarried(org: Map<String, Any?>?): Boolean {
  val entitlements = org?.get("entitlements") as? Map<*, *>
  val override = (entitlements?.get("features") as? Map<*, *>)?.get("crm")
  if (override is Boolean) return override
  val status = (org?.get("billingStatus") as? String)?.takeIf { it.isNotEmpty() }
    ?: ((org?.get("subscription") as? Map<*, *>)?.get("status") as? String).orEmpty()
  val plan = (org?.get("plan") as? String) ?: "free"
  val comp = ((entitlements?.get("planComp") as? Map<*, *>)?.get("plan") as? String).orEmpty()
  return (plan in CRM_PLANS && status !in LAPSED) || (comp in CRM_PLANS && (status.isEmpty() || status in LAPSED))
}

/** The CRM as this member sees it from the picked site. */
data class CrmScope(
  val orgId: String,
  val hostId: String,
  /** The holder a contact's own fields are kept under: the site's consent group. */
  val groupId: String,
  val uid: String,
  val role: String?,
  val orgWide: Boolean,
  /** The `visibleTo array-contains-any` every list asks with. */
  val readTokens: List<String>,
  /** What a created record is stamped with. */
  val createTokens: List<String>,
  val suite: Boolean,
  val org: Map<String, Any?>,
) {
  /** `canWriteOrgData`: an owner, admin or editor of the workspace. */
  val canWrite: Boolean get() = role in setOf("owner", "admin", "editor")
  val canManage: Boolean get() = role in setOf("owner", "admin")
  /** The scope the CRM routes take: the site, as the console's site hub sends it. */
  val routeScope: Map<String, Any?> get() = mapOf("hostId" to hostId, "orgId" to orgId)
}

/** The member's reach on a declared group: the group's tokens they hold, or all of them org-wide. */
fun narrowToReach(tokens: List<String>, member: Map<String, Any?>?, orgWide: Boolean): List<String> {
  if (orgWide) return tokens
  @Suppress("UNCHECKED_CAST") val held = (member?.get("scopeTokens") as? List<Any?>)?.filterIsInstance<String>()?.toSet() ?: return tokens
  return tokens.filter { it == ORG_SCOPE_TOKEN || it in held }
}

fun crmScopeOf(orgId: String, hostId: String, uid: String, org: FirestoreDoc?, member: FirestoreDoc?): CrmScope {
  val orgData = org?.data.orEmpty()
  val role = member?.string("role")
  val orgWide = role in setOf("owner", "admin") || member?.bool("allHosts") == true
  val group = consentGroupForHost(orgData, hostId)
  val read = crmReadTokens(group).let { if (group.declared) narrowToReach(it, member?.data, orgWide) else it }
  return CrmScope(orgId, hostId, group.groupId, uid, role, orgWide, read, crmScopeTokens(orgData, group), crmSuiteCarried(orgData), orgData)
}

/** The scope, live: the org document and the member's own row. */
fun observeCrmScope(reader: FirestoreReader, orgId: String, hostId: String, uid: String): Flow<Live<CrmScope>> =
  combine(reader.observeDoc("orgs/$orgId"), reader.observeDoc("orgs/$orgId/members/$uid")) { org, member ->
    when {
      org is Live.Failed -> org
      member is Live.Failed -> member
      org is Live.Ready && member is Live.Ready -> Live.Ready(crmScopeOf(orgId, hostId, uid, org.value, member.value))
      else -> Live.Loading
    }
  }
