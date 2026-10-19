package com.aglyn.core

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull

/**
 * What a workspace's plan includes, as the console's `GET /api/orgs/entitlements` answers it (`resolveOrgEntitlements`):
 * the effective plan, each feature on or off, and each quota (null = unlimited). The one reading the shell's upgrade
 * surfaces, feature gates and white-label mark share.
 */
data class OrgEntitlements(val plan: String?, val features: Map<String, Boolean>, val quotas: Map<String, Long?>) {
  fun has(feature: String): Boolean = features[feature] == true
  fun limit(quota: String): Long? = quotas[quota]

  companion object {
    fun of(body: JsonElement?): OrgEntitlements? {
      val root = body as? JsonObject ?: return null
      val features = (root["features"] as? JsonObject)?.mapValues { (_, v) -> (v as? JsonPrimitive)?.booleanOrNull == true } ?: emptyMap()
      val quotas = (root["quotas"] as? JsonObject)?.mapValues { (_, v) ->
        (v as? JsonPrimitive)?.takeIf { it !is JsonNull }?.doubleOrNull?.takeIf { it.isFinite() }?.toLong()
      } ?: emptyMap()
      val plan = (root["plan"] as? JsonPrimitive)?.takeIf { it.isString }?.content
      return OrgEntitlements(plan, features, quotas)
    }
  }
}

/**
 * The entitlements of the workspaces this account has opened, read once per workspace per session and kept as state, so
 * every surface that asks gets the same answer without asking the server again.
 */
class OrgEntitlementsCache(private val api: ConsoleApiClient) {
  private val flows = mutableMapOf<String, MutableStateFlow<OrgEntitlements?>>()
  private val loading = mutableSetOf<String>()

  /** The workspace's entitlements as state: null until the first answer lands (and while a lookup fails). */
  fun state(orgId: String): StateFlow<OrgEntitlements?> = flows.getOrPut(orgId) { MutableStateFlow(null) }.asStateFlow()

  /** Asks the console once for [orgId] (again when [refresh] is set); a failure leaves the state as it was. */
  suspend fun load(orgId: String, refresh: Boolean = false) {
    val flow = flows.getOrPut(orgId) { MutableStateFlow(null) }
    if ((!refresh && flow.value != null) || !loading.add(orgId)) return
    try {
      runCatching { api.request("/api/orgs/entitlements", query = mapOf("orgId" to orgId)) }
        .getOrNull()?.let { OrgEntitlements.of(it) }?.let { flow.value = it }
    } finally {
      loading.remove(orgId)
    }
  }
}
