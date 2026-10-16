package com.aglyn.site.artifacts

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.FilterOp
import com.aglyn.core.FirestoreFilter
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.FirestoreReader
import com.aglyn.core.FirestoreTimestamp
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull

/*
 * The per-plan count beside Create on the components, layouts and templates
 * lists: `3/10 layouts on your plan`, the figure the console prints above its
 * table and the one `/api/hosts/resources` refuses a create at (AGL-473). The
 * cap is the plan's quota from `/api/orgs/entitlements` (`componentsPerHost`,
 * `sharedLayoutsPerHost`, `templatesPerHost`); the count is the server's
 * aggregate over what the route counts, not the length of the window the list
 * has read (AGL-1716). The Swift kit's `ArtifactQuota.swift`.
 */

/** The quota key `/api/hosts/resources` enforces for this list. */
val ArtifactKind.quotaKey: String
  get() = when (this) {
    ArtifactKind.COMPONENT -> "componentsPerHost"
    ArtifactKind.LAYOUT -> "sharedLayoutsPerHost"
    ArtifactKind.TEMPLATE -> "templatesPerHost"
  }

/**
 * The plan's cap for a list from the entitlements body: a number, or null for an unlimited plan (the route writes `null`,
 * JSON having no Infinity) and for a quota the body does not name.
 */
fun artifactQuotaLimit(body: JsonElement?, kind: ArtifactKind): Long? {
  val cap = ((body as? JsonObject)?.get("quotas") as? JsonObject)?.get(kind.quotaKey) as? JsonPrimitive ?: return null
  return cap.doubleOrNull?.takeIf { it.isFinite() }?.toLong()
}

/**
 * The two aggregates that count what the create route counts. Components and layouts: every document less the tombstones
 * (a delete stamps `deletedAt` and leaves the document). Templates: everything that is not a starter's page.
 */
fun artifactCountQueries(kind: ArtifactKind, hostId: String): Pair<FirestoreQuery, FirestoreQuery?> {
  val path = "hosts/$hostId/${kind.collection}"
  return when (kind) {
    ArtifactKind.COMPONENT, ArtifactKind.LAYOUT ->
      FirestoreQuery(path) to FirestoreQuery(path, filters = listOf(FirestoreFilter("deletedAt", FilterOp.GT, FirestoreTimestamp(0))))
    ArtifactKind.TEMPLATE -> FirestoreQuery(path, filters = listOf(FirestoreFilter("source.type", FilterOp.NE, "starter"))) to null
  }
}

/** The count never goes below zero: the two aggregates are separate round trips and a delete between them can make the second the larger. */
fun artifactLiveCount(total: Long, subtract: Long?): Int = maxOf(0L, total - (subtract ?: 0L)).toInt()

/** The standing readout: `3/25 layouts on your plan`, `∞` for an unlimited plan, or the count alone while the plan loads. */
fun artifactQuotaReadout(used: Int, limit: Long?, ready: Boolean, noun: String): String =
  if (ready) "$used/${limit?.toString() ?: "∞"} ${noun}s on your plan" else "$used ${if (used == 1) noun else "${noun}s"} · checking your plan…"

/** One list's readout: the plan's cap and the site's count, each unknown until it is read. */
class ArtifactQuotaModel(
  private val kind: ArtifactKind,
  private val hostId: String,
  private val api: ConsoleApiClient,
  private val firestore: FirestoreReader,
) {
  /** Whether the plan has answered; a readout before that says it is still checking. */
  var ready by mutableStateOf(false)
    private set

  /** The plan's cap; null is unlimited. */
  var limit by mutableStateOf<Long?>(null)
    private set

  /** The server's count; null while it is pending or refused, and the list's own window stands in then. */
  var count by mutableStateOf<Int?>(null)
    private set

  /** Reads the plan once for the site and list; a refusal leaves the readout saying it is checking. */
  suspend fun loadPlan() {
    try {
      limit = artifactQuotaLimit(api.request("/api/orgs/entitlements", query = mapOf("hostId" to hostId)), kind)
      ready = true
    } catch (error: CancellationException) {
      throw error
    } catch (error: Throwable) {
      ready = false
    }
  }

  /** Asks the server for the count again; run when the list's rows change, which is when a create or a delete could have. */
  suspend fun recount() {
    val (totalQuery, subtractQuery) = artifactCountQueries(kind, hostId)
    val total = runCatching { firestore.count(totalQuery) }.getOrNull() ?: return
    val subtract = if (subtractQuery == null) null else runCatching { firestore.count(subtractQuery) }.getOrNull() ?: return
    count = artifactLiveCount(total, subtract)
  }
}
