package com.aglyn.plugins.commerce.orders

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiError
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.Live
import com.aglyn.pluginhost.LocalSlotProps
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.StatusTone
import com.aglyn.ui.space
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/*
 * Start a quote from somewhere else (AGL-4098), as the console's quote-start.component.tsx has it: two widgets in other
 * plugins' zones, each a button that opens the quote editor already filled in.
 *
 *  - on an open submission in the Inbox (`inboxSubmissionActions`), for a quote request: the editor asks the quote
 *    route for the request's prefill (`start-from-request`), which reads the request for the member asking;
 *  - in a contact's head in the CRM (`crmRecordActions`): the person as the page shows them is the quote's customer.
 *
 * Either way the quote is the editor's ordinary new quote, saved by the ordinary create under "Create and edit quotes".
 * The zones pass what the console's do, as `LocalSlotProps`; this plugin never imports the Inbox or the CRM. The Apple
 * kit's QuoteStart.swift.
 */

const val INBOX_SUBMISSION_ACTIONS_ZONE = "inboxSubmissionActions"
const val CRM_RECORD_ACTIONS_ZONE = "crmRecordActions"

/** The editor over the store's products and settings, read while it is open. */
@Composable
private fun QuoteStartEditor(context: NativePluginContext, hostId: String, start: QuoteEditorStart, onClose: () -> Unit, onDone: (String) -> Unit) {
  val products by remember(hostId, context.firestore) {
    context.firestore.observe(FirestoreQuery("hosts/$hostId/products", limit = QUOTE_PRODUCT_WINDOW + 1))
  }.collectAsState(Live.Loading)
  val store by remember(hostId, context.firestore) { context.firestore.observeDoc("hosts/$hostId/settings/store") }.collectAsState(Live.Loading)
  QuoteEditorSheet(
    context, null, null, quoteProductsOf((products as? Live.Ready)?.value.orEmpty()), (store as? Live.Ready)?.value?.data,
    onDismiss = onClose, start = start,
  ) { message, _ ->
    onClose()
    onDone(message)
  }
}

/** "Start a quote" on an open quote request in the Inbox. Only a quote request has a quote to start. */
@Composable
fun QuoteStartFromRequestWidget(context: NativePluginContext) {
  val props = LocalSlotProps.current
  val hostId = props["hostId"] ?: context.hostId.orEmpty()
  val submissionId = props["submissionId"]
  if (props["requestKind"] != "quote" || hostId.isEmpty() || submissionId == null) return
  val scope = rememberCoroutineScope()
  var busy by remember { mutableStateOf(false) }
  var start by remember { mutableStateOf<QuoteEditorStart?>(null) }
  var notice by remember { mutableStateOf<Pair<String, StatusTone>?>(null) }
  Column(verticalArrangement = Arrangement.spacedBy(space(1f))) {
    OutlinedButton(
      onClick = {
        scope.launch {
          busy = true
          try {
            val answer = context.api.request(
              QUOTE_ROUTE, ApiMethod.POST,
              JsonObject(mapOf("action" to JsonPrimitive("start-from-request"), "hostId" to JsonPrimitive(hostId), "submissionId" to JsonPrimitive(submissionId))),
            ) as? JsonObject
            start = QuoteEditorStart.request(submissionId, answer)
          } catch (error: Throwable) {
            if (error is kotlinx.coroutines.CancellationException) throw error
            val reason = (((error as? ConsoleApiError)?.body as? JsonObject)?.get("error") as? JsonPrimitive)?.contentOrNull
            notice = (reason ?: "The quote could not be started") to StatusTone.ERROR
          } finally {
            busy = false
          }
        }
      },
      enabled = !busy,
      modifier = Modifier.testTag("quote-start-from-request"),
    ) { Text(if (busy) "Starting…" else "Start a quote") }
    notice?.let { (text, tone) -> NoticeBanner(text, tone) }
  }
  start?.let { QuoteStartEditor(context, hostId, it, onClose = { start = null }) { message -> notice = message to StatusTone.SUCCESS } }
}

/** "Start a quote" in a contact's head in the CRM. A quote is a site's: with no site, there is none to start. */
@Composable
fun QuoteStartFromContactWidget(context: NativePluginContext) {
  val props = LocalSlotProps.current
  val hostId = props["hostId"].orEmpty()
  val recordId = props["recordId"]
  if (hostId.isEmpty() || recordId == null) return
  var start by remember { mutableStateOf<QuoteEditorStart?>(null) }
  var notice by remember { mutableStateOf<String?>(null) }
  Column(verticalArrangement = Arrangement.spacedBy(space(1f))) {
    OutlinedButton(
      onClick = {
        start = QuoteEditorStart.contact(
          props["kind"] ?: "contact", recordId, props["name"].orEmpty(), props["email"].orEmpty(), props["phone"].orEmpty(), props["company"].orEmpty(),
        )
      },
      modifier = Modifier.testTag("quote-start-from-contact"),
    ) { Text("Start a quote") }
    notice?.let { NoticeBanner(it, StatusTone.SUCCESS) }
  }
  start?.let { QuoteStartEditor(context, hostId, it, onClose = { start = null }) { message -> notice = message } }
}
