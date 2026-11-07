package com.aglyn.plugins.commerce.orders

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.aglyn.contracts.HostOrder
import com.aglyn.contracts.QUOTE_MESSAGE_MAX
import com.aglyn.contracts.deviceTimeZone
import com.aglyn.contracts.formatReceiptTime
import com.aglyn.contracts.permissionRefusalText
import com.aglyn.contracts.quoteReplyRecipient
import com.aglyn.contracts.quoteReplyRefusal
import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiError
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.pluginhost.rememberMemberPermissions
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.SectionCard
import com.aglyn.ui.StatusTone
import com.aglyn.ui.space
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlin.random.Random

/*
 * The quote's conversation with its customer (AGL-4207), as the console's QuoteMessagesSection has it: every reply
 * sent from here and everything the customer wrote on the quote page, oldest first, and a reply box. A reply goes by
 * email in the quote's own conversation in the customer's mailbox (`POST /api/commerce/quote` messages, reply); their
 * email answer reaches the site's contact email, not this list. The Apple kit's QuoteMessages.swift.
 */

/** A message as the console lists it (`QuoteConsoleMessage`): who and when, and what was said. */
data class QuoteConsoleMessage(val id: String, val incoming: Boolean, val body: String, val atMs: Double, val label: String)

private fun JsonObject.text(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull

@Composable
fun QuoteMessagesSection(context: NativePluginContext, order: HostOrder, quoteId: String, onNotice: (String, StatusTone) -> Unit) {
  val canSend = rememberMemberPermissions(context).can(QUOTE_SEND_PERMISSION)
  val scope = rememberCoroutineScope()
  var messages by remember { mutableStateOf(emptyList<QuoteConsoleMessage>()) }
  var loadError by remember { mutableStateOf<String?>(null) }
  var message by remember { mutableStateOf("") }
  var busy by remember { mutableStateOf(false) }
  var attemptKey by remember { mutableStateOf<String?>(null) }

  fun body(action: String, extra: Map<String, String> = emptyMap()) = JsonObject(
    mapOf("action" to JsonPrimitive(action), "hostId" to JsonPrimitive(context.hostId.orEmpty()), "quoteId" to JsonPrimitive(quoteId)) +
      extra.mapValues { JsonPrimitive(it.value) },
  )

  suspend fun load() {
    try {
      val answer = context.api.request(QUOTE_ROUTE, ApiMethod.POST, body("messages")) as? JsonObject
      loadError = null
      messages = (answer?.get("messages") as? JsonArray).orEmpty().mapNotNull { raw ->
        val entry = raw as? JsonObject ?: return@mapNotNull null
        val id = entry.text("id") ?: return@mapNotNull null
        val text = entry.text("body") ?: return@mapNotNull null
        QuoteConsoleMessage(id, entry.text("direction") == "in", text, (entry["atMs"] as? JsonPrimitive)?.doubleOrNull ?: 0.0, entry.text("label").orEmpty())
      }
    } catch (error: Throwable) {
      if (error is kotlinx.coroutines.CancellationException) throw error
      loadError = ((error as? ConsoleApiError)?.body as? JsonObject)?.text("error") ?: "The messages could not be loaded."
    }
  }

  LaunchedEffect(quoteId) { load() }

  SectionCard("Messages") {
    Column(Modifier.testTag("quote-messages"), verticalArrangement = Arrangement.spacedBy(space(1f))) {
      Text(
        "Write to your customer about this quote. They can answer by email or on the quote page; what they write on the page shows here, and you’re notified of it.",
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
      loadError?.let { NoticeBanner(it, StatusTone.WARNING) }
      if (messages.isNotEmpty()) {
        Text("CONVERSATION", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        messages.forEach { entry ->
          Row(Modifier.height(IntrinsicSize.Min)) {
            Box(Modifier.width(3.dp).fillMaxHeight().background(if (entry.incoming) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant))
            Column(Modifier.padding(start = space(1.5f))) {
              Text("${formatReceiptTime(entry.atMs.toLong(), deviceTimeZone())} · ${entry.label}", style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
              Text(entry.body)
            }
          }
        }
      }
      val refused = quoteReplyRefusal(order)
      if (refused != null) {
        NoticeBanner(refused, StatusTone.INFO)
      } else {
        Text("To ${quoteReplyRecipient(order)}", color = MaterialTheme.colorScheme.onSurfaceVariant)
        OutlinedTextField(
          message, {
            message = it.take(QUOTE_MESSAGE_MAX)
            attemptKey = null
          },
          label = { Text("Message") }, placeholder = { Text("Write your reply.") }, minLines = 4, enabled = canSend,
          modifier = Modifier.fillMaxWidth().testTag("quote-reply-message"),
        )
        NoticeBanner(
          if (canSend) "Sent from your site in the same email conversation as the quote. When your customer replies by email, it goes to your site’s contact email (or yours, if the site has none), not here."
          else permissionRefusalText(QUOTE_SEND_PERMISSION),
          StatusTone.INFO,
        )
        Button(
          onClick = {
            val text = message.trim()
            if (busy || text.isEmpty()) return@Button
            // One key per reply: a retry of the same press is answered from the first.
            val key = attemptKey ?: "${Random.nextLong()}-${Random.nextLong()}"
            attemptKey = key
            scope.launch {
              busy = true
              try {
                val answer = context.api.request(QUOTE_ROUTE, ApiMethod.POST, body("reply", mapOf("message" to text)), idempotencyKey = key) as? JsonObject
                attemptKey = null
                message = ""
                onNotice("Reply sent to ${answer?.text("to") ?: quoteReplyRecipient(order)}", StatusTone.SUCCESS)
                load()
              } catch (error: Throwable) {
                if (error is kotlinx.coroutines.CancellationException) throw error
                attemptKey = null
                onNotice(((error as? ConsoleApiError)?.body as? JsonObject)?.text("error") ?: "The reply was not sent", StatusTone.WARNING)
              } finally {
                busy = false
              }
            }
          },
          enabled = canSend && !busy && message.isNotBlank(),
          modifier = Modifier.testTag("quote-reply-send"),
        ) { Text(if (busy) "Sending…" else "Send reply") }
      }
    }
  }
}
