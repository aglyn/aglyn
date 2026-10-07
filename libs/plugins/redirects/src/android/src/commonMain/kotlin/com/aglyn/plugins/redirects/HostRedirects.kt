package com.aglyn.plugins.redirects

import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.Live
import com.aglyn.pluginhost.NativePluginContext

/** The console Redirects page's own ceiling: a window the page holds whole. */
const val REDIRECTS_WINDOW = 200

/** The serve path's default priority for a rule that names none. */
const val REDIRECT_DEFAULT_PRIORITY = 100L

data class RedirectRow(
  val id: String,
  val source: String,
  val destination: String,
  val statusCode: Long,
  val kind: String?,
  val enabled: Boolean,
  val priority: Long?,
  val deleted: Boolean,
) {
  companion object {
    fun from(doc: FirestoreDoc) = RedirectRow(
      id = doc.id,
      source = doc.string("source") ?: "",
      destination = doc.string("destination") ?: "",
      statusCode = doc.long("statusCode") ?: 302,
      kind = doc.string("kind"),
      enabled = doc.bool("enabled") != false,
      priority = doc.long("priority"),
      deleted = doc.data["deletedAt"] != null,
    )
  }
}

/** Evaluation order, as the serve path applies it: priority, then source; soft-deleted rules are gone. */
fun inEvaluationOrder(rows: List<RedirectRow>): List<RedirectRow> = rows
  .filter { !it.deleted }
  .sortedWith(compareBy<RedirectRow> { it.priority ?: REDIRECT_DEFAULT_PRIORITY }.thenBy { it.source })

/**
 * A site's redirect rules, live: `hosts/{hostId}/redirects`, the collection
 * and rules the console's Redirects page reads, as the signed-in member.
 */
@Composable
fun hostRedirects(context: NativePluginContext): Live<List<RedirectRow>> {
  val hostId = context.hostId ?: return Live.Loading
  val flow = remember(hostId, context.firestore) {
    context.firestore.observe(FirestoreQuery("hosts/$hostId/redirects", limit = REDIRECTS_WINDOW))
  }
  val live by flow.collectAsState(Live.Loading)
  return when (val value = live) {
    is Live.Ready -> Live.Ready(inEvaluationOrder(value.value.map(RedirectRow::from)))
    is Live.Failed -> value
    Live.Loading -> Live.Loading
  }
}
