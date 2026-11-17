package com.aglyn.core

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/*
 * Visit site as the team (the console's `SiteVisitButton`, AGL-4086). While a site is in preview or in maintenance its
 * visitors see the 503 page, so Visit site enters it through a two-minute link the console mints for a member of the
 * site's team (`/api/site-preview/link`); anywhere the link cannot be had it opens the ordinary address, where the public
 * answer is what anyone gets. The Apple core's SiteVisit.swift.
 */
object SiteVisit {
  /** Whether Visit site enters this site as the team: it is in preview (`preview: true`) or in maintenance. */
  fun entersAsTeam(host: Map<String, Any?>?): Boolean {
    if (host?.get("preview") == true) return true
    return when (val maintenance = host?.get("maintenance")) {
      null -> false
      is Boolean -> maintenance
      is String -> maintenance.isNotEmpty()
      is Number -> maintenance.toDouble() != 0.0
      else -> true
    }
  }

  /** The link that enters the site as the team at [path], or null when the console would not mint one. */
  suspend fun teamLink(api: ConsoleApiClient, hostId: String, path: String = "/"): String? = runCatching {
    val answer = api.request("/api/site-preview/link", ApiMethod.POST, jsonValue(mapOf("hostId" to hostId, "path" to path))) as? JsonObject
    (answer?.get("url") as? JsonPrimitive)?.takeIf { it.isString }?.content
  }.getOrNull()

  /**
   * Where Visit site goes: the team link while the site is in preview or maintenance ([entersAsTeam]), else (or when no
   * link comes) [address].
   */
  suspend fun url(entersAsTeam: Boolean, hostId: String, address: String, api: ConsoleApiClient?): String {
    if (!entersAsTeam || api == null) return address
    return teamLink(api, hostId) ?: address
  }
}
