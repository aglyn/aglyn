package com.aglyn.core

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/**
 * After a write that changes every page of a site (an overlay, an A/B test),
 * what the console's `writeSiteWideChange` does next: stage a
 * `publishOutbox` entry so the drain re-renders the site if this run cannot,
 * ask `/api/screens/revalidate` to re-render it now, and retire the entry
 * when that worked. Like the console, a refused entry (the rules pin its
 * `createdAt` to the request time) is not an error: the revalidate still runs.
 */
suspend fun publishSiteWideChange(api: ConsoleApiClient, writer: FirestoreWriter, hostId: String) {
  val path = "publishOutbox/${com.aglyn.core.listquery.newResourceId()}"
  val staged = runCatching {
    writer.merge(path, mapOf("hostId" to hostId, "paths" to listOf("/"), "createdAt" to ServerTimestamp, "attempts" to 0L, "entireHost" to true))
  }.isSuccess
  val answer = runCatching {
    api.request("/api/screens/revalidate", ApiMethod.POST, firestoreJson(mapOf("hostId" to hostId, "entireHost" to true))) as? JsonObject
  }.getOrNull()
  if (staged && (answer?.get("reason") as? JsonPrimitive)?.contentOrNull == "ok") runCatching { writer.delete(path) }
}
