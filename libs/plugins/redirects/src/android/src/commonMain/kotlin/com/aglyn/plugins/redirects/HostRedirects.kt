package com.aglyn.plugins.redirects

import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.Live
import com.aglyn.core.decode
import com.aglyn.contracts.HostRedirect
import com.aglyn.pluginhost.NativePluginContext

/** The console Redirects page's own ceiling: a window the page holds whole. */
const val REDIRECTS_WINDOW = 200

/** The serve path's default priority for a rule that names none. */
const val REDIRECT_DEFAULT_PRIORITY = 100L

/** A rule as the console stores it (the generated [HostRedirect]), with its id. */
data class RedirectRow(
  val id: String,
  val rule: HostRedirect,
  /** A soft-deleted rule is gone for the console and the serve path. */
  val deleted: Boolean = false,
) {
  val source: String get() = rule.source
  val destination: String get() = rule.destination
  val statusCode: Long get() = rule.statusCode
  val kind: String? get() = rule.kind?.raw?.ifEmpty { null }
  val enabled: Boolean get() = rule.enabled != false
  val priority: Long? get() = rule.priority?.toLong()

  companion object {
    /** Null for a document that is not a rule. */
    fun from(doc: FirestoreDoc): RedirectRow? =
      doc.decode(HostRedirect.serializer())?.let { RedirectRow(doc.id, it, doc.data["deletedAt"] != null) }
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
    is Live.Ready -> Live.Ready(inEvaluationOrder(value.value.mapNotNull(RedirectRow::from)))
    is Live.Failed -> value
    Live.Loading -> Live.Loading
  }
}
