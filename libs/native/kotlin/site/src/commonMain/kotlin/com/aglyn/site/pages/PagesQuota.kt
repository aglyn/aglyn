package com.aglyn.site.pages

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.aglyn.core.ConsoleApiClient
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull

/*
 * The "N/M pages on your plan" readout opposite the Pages heading (AGL-2113):
 * the plan's `screensPerHost` from `/api/orgs/entitlements`, the count from
 * `/api/hosts/usage`, which counts with `countBillableScreens`, the same rule
 * the create route refuses at. The Apple kit's PagesQuota.swift.
 */

/** The plan's page cap from the entitlements body; null for an unlimited plan (`null`) or a body that does not name it. */
fun pagesQuotaLimit(body: JsonElement?): Long? {
  val cap = ((body as? JsonObject)?.get("quotas") as? JsonObject)?.get("screensPerHost") as? JsonPrimitive ?: return null
  return cap.doubleOrNull?.takeIf { it.isFinite() }?.toLong()
}

/** The site's billable pages from the usage body. */
fun pagesUsageCount(body: JsonElement?): Int? = ((body as? JsonObject)?.get("screens") as? JsonPrimitive)?.doubleOrNull?.takeIf { it.isFinite() }?.toInt()

class PagesQuotaModel(private val hostId: String, private val api: ConsoleApiClient) {
  var ready by mutableStateOf(false)
    private set
  var limit by mutableStateOf<Long?>(null)
    private set
  var count by mutableStateOf<Int?>(null)
    private set

  /** The plan, once, then the count; the count is asked again whenever the list changes. */
  suspend fun load() {
    if (!ready) {
      runCatching { api.request("/api/orgs/entitlements", query = mapOf("hostId" to hostId)) }.onSuccess {
        limit = pagesQuotaLimit(it)
        ready = true
      }
    }
    runCatching { api.request("/api/hosts/usage", query = mapOf("hostId" to hostId)) }.onSuccess { body -> pagesUsageCount(body)?.let { count = it } }
  }
}
