package com.aglyn.plugins.commerce.orders

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.input.KeyboardType
import com.aglyn.contracts.HostOrder
import com.aglyn.contracts.OrderStatus
import com.aglyn.contracts.QUOTE_MAX_SEND_MESSAGE
import com.aglyn.contracts.QUOTE_MAX_SEND_SUBJECT
import com.aglyn.contracts.QUOTE_NOTHING_TO_SEND_MESSAGE
import com.aglyn.contracts.currentQuoteProofs
import com.aglyn.contracts.formatQuoteNumber
import com.aglyn.contracts.formatReceiptTime
import com.aglyn.contracts.isUnpaidQuote
import com.aglyn.contracts.permissionRefusalText
import com.aglyn.contracts.quoteEmailDefaultSubject
import com.aglyn.contracts.quoteIsProofOnly
import com.aglyn.contracts.quoteLinkVersion
import com.aglyn.contracts.quotePayLinkWords
import com.aglyn.contracts.quoteSendLabel
import com.aglyn.contracts.quoteSendNote
import com.aglyn.contracts.quoteSendPrefill
import com.aglyn.contracts.quoteSendReplacesLink
import com.aglyn.contracts.quoteSendStatus
import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.ConsoleApiError
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.pluginhost.rememberMemberPermissions
import com.aglyn.ui.Busy
import com.aglyn.ui.FormSheet
import com.aglyn.ui.SectionCard
import com.aglyn.ui.StatusTone
import com.aglyn.ui.space
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlin.math.floor
import kotlin.random.Random

/*
 * Emailing a quote to the customer and its pay link (AGL-4097, AGL-4094), as the console's QuoteSendSection and
 * QuotePayLinkSection have them: when it was last sent and to whom, Send quote / Send again / Send revision N with a
 * short form (To, Subject, Message), Send invoice beside it, and the pay link the business copies or replaces. The
 * server writes and sends the email and signs the link (`POST /api/commerce/quote` send, pay-link, replace-link). The
 * Apple kit's QuoteSend.swift.
 */

const val QUOTE_SEND_PERMISSION = "commerce.quotes.send"

/** The pay link as the server made it, with the link version it was made at. */
data class SignedQuoteLink(val url: String, val version: Int)

private fun JsonObject?.errorText(): String? = ((this?.get("error")) as? JsonPrimitive)?.contentOrNull?.takeIf { it.isNotBlank() }

private fun attempt() = "${Random.nextLong()}-${Random.nextLong()}"

/** Asks the server for the quote's pay link, or for a new one (`pay-link`, `replace-link`). */
suspend fun requestQuoteLink(api: ConsoleApiClient, hostId: String, quoteId: String, replace: Boolean, fallbackVersion: Int): SignedQuoteLink {
  val answer = api.request(
    QUOTE_ROUTE, ApiMethod.POST,
    JsonObject(mapOf("action" to JsonPrimitive(if (replace) "replace-link" else "pay-link"), "hostId" to JsonPrimitive(hostId), "quoteId" to JsonPrimitive(quoteId))),
  ) as? JsonObject
  val url = (answer?.get("url") as? JsonPrimitive)?.contentOrNull?.takeIf { it.isNotEmpty() } ?: throw ConsoleApiError(answer.errorText() ?: "", 500, answer)
  val made = (answer["linkVersion"] as? JsonPrimitive)?.doubleOrNull?.let { floor(it).toInt() } ?: fallbackVersion
  return SignedQuoteLink(url, if (made >= 1) made else fallbackVersion)
}

/** Emailing the quote (the console's QuoteSendSection): when it was last sent, and Send / Send invoice. */
@Composable
fun QuoteEmailSection(
  context: NativePluginContext, order: HostOrder, quoteId: String, site: InvoiceSite,
  readiness: @Composable () -> Unit, onNotice: (String, StatusTone) -> Unit,
) {
  val quote = order.quote
  val unpaid = isUnpaidQuote(order)
  val proofOnly = quoteIsProofOnly(order)
  val closed = order.status == OrderStatus.CANCELLED || order.status == OrderStatus.REFUNDED
  val canSend = rememberMemberPermissions(context).can(QUOTE_SEND_PERMISSION)
  var sending by remember { mutableStateOf(false) }
  var invoicing by remember { mutableStateOf(false) }
  SectionCard("Email to customer") {
    Column(verticalArrangement = Arrangement.spacedBy(space(1f))) {
      Text(quoteSendStatus(order) { formatReceiptTime(it.toLong(), com.aglyn.contracts.deviceTimeZone()) }, color = MaterialTheme.colorScheme.onSurfaceVariant)
      if (unpaid && quoteSendReplacesLink(quote)) {
        Text(
          "Sending revision ${quote?.revision?.toLong() ?: 1} gives your customer a new pay link. The link in your earlier email will say the quote was updated.",
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
      }
      invoiceSentLine(order)?.let { Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant) }
      if (!closed) {
        Row(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
          if (unpaid) {
            OutlinedButton(onClick = {
              when {
                !canSend -> onNotice(permissionRefusalText(QUOTE_SEND_PERMISSION), StatusTone.INFO)
                proofOnly && currentQuoteProofs(quote).isEmpty() -> onNotice(QUOTE_NOTHING_TO_SEND_MESSAGE, StatusTone.INFO)
                else -> sending = true
              }
            }, modifier = Modifier.testTag("quote-send")) { Text(quoteSendLabel(quote, proofOnly)) }
          }
          if (!proofOnly) {
            TextButton(onClick = {
              if (canSend) invoicing = true else onNotice(permissionRefusalText(QUOTE_SEND_PERMISSION), StatusTone.INFO)
            }, modifier = Modifier.testTag("quote-send-invoice")) { Text("Send invoice") }
          }
        }
      }
    }
  }
  if (sending) {
    QuoteSendDialog(context, order, quoteId, site, readiness, onDismiss = { sending = false }) { message ->
      sending = false
      onNotice(message, StatusTone.SUCCESS)
    }
  }
  if (invoicing) {
    QuoteInvoiceDialog(context, order, quoteId, site, onDismiss = { invoicing = false }) { message ->
      invoicing = false
      onNotice(message, StatusTone.SUCCESS)
    }
  }
}

/** The send form: To, Subject and Message, what the customer's Pay waits on, and what the email shows. */
@Composable
private fun QuoteSendDialog(
  context: NativePluginContext, order: HostOrder, quoteId: String, site: InvoiceSite, readiness: @Composable () -> Unit,
  onDismiss: () -> Unit, onSent: (String) -> Unit,
) {
  val scope = rememberCoroutineScope()
  val busy = remember { Busy() }
  val number = formatQuoteNumber(order, quoteId)
  val label = quoteSendLabel(order.quote, quoteIsProofOnly(order))
  var to by remember { mutableStateOf(quoteSendPrefill(order)) }
  var subject by remember { mutableStateOf(quoteEmailDefaultSubject(order, site.businessName, quoteId)) }
  var message by remember { mutableStateOf("") }
  // One attempt per form: a retried Send presents the same key, a changed form is a new attempt.
  var key by remember { mutableStateOf(attempt()) }
  LaunchedEffect(to, subject, message) { key = attempt() }
  FormSheet(
    title = "$label: $number", busy = busy, onDismiss = onDismiss,
    onConfirm = {
      busy.run(scope) {
        val answer = try {
          context.api.request(
            QUOTE_ROUTE, ApiMethod.POST,
            JsonObject(mapOf(
              "action" to JsonPrimitive("send"), "hostId" to JsonPrimitive(context.hostId.orEmpty()), "quoteId" to JsonPrimitive(quoteId),
              "to" to JsonPrimitive(to), "subject" to JsonPrimitive(subject), "message" to JsonPrimitive(message),
            )),
            idempotencyKey = key,
          ) as? JsonObject
        } catch (error: ConsoleApiError) {
          throw Exception((error.body as? JsonObject).errorText() ?: "The quote could not be sent")
        }
        val address = (answer?.get("to") as? JsonPrimitive)?.contentOrNull ?: to
        val replaced = (answer?.get("linkReplaced") as? JsonPrimitive)?.booleanOrNull == true
        onSent("$number sent to $address" + if (replaced) ". The link in your earlier email no longer opens the quote." else "")
      }
    },
    confirmLabel = "Send", confirmEnabled = to.isNotBlank(), workingLabel = "Sending…",
    modifier = Modifier.testTag("quote-send-form"),
  ) {
    Column(verticalArrangement = Arrangement.spacedBy(space(1.5f))) {
      readiness()
      OutlinedTextField(to, { to = it }, label = { Text("To") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
        modifier = Modifier.fillMaxWidth().testTag("quote-send-to"))
      OutlinedTextField(
        subject, { subject = it.take(QUOTE_MAX_SEND_SUBJECT) }, label = { Text("Subject") }, singleLine = true,
        supportingText = order.quote?.emailThread?.let { { Text("Keep the subject the same to keep these emails in one conversation in your customer’s inbox.") } },
        modifier = Modifier.fillMaxWidth(),
      )
      OutlinedTextField(
        message, { message = it.take(QUOTE_MAX_SEND_MESSAGE) }, label = { Text("Message") }, minLines = 4,
        supportingText = { Text("Shown at the top of the email, in your words.") }, modifier = Modifier.fillMaxWidth(),
      )
      Text(quoteSendNote(order, site.contact), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
      if (quoteSendReplacesLink(order.quote)) {
        Text("This sends a new pay link. The link in your earlier email will say the quote was updated.", style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
    }
  }
}

/** Send invoice beside it (AGL-4099): the order invoice form, for the quote. */
@Composable
private fun QuoteInvoiceDialog(
  context: NativePluginContext, order: HostOrder, quoteId: String, site: InvoiceSite, onDismiss: () -> Unit, onSent: (String) -> Unit,
) {
  val scope = rememberCoroutineScope()
  val busy = remember { Busy() }
  val number = formatInvoiceNumber(order, quoteId)
  var to by remember { mutableStateOf(invoiceSendPrefill(order)) }
  var subject by remember { mutableStateOf(invoiceEmailDefaultSubject(order, site.businessName, quoteId)) }
  var message by remember { mutableStateOf("") }
  var key by remember { mutableStateOf(attempt()) }
  LaunchedEffect(to, subject, message) { key = attempt() }
  FormSheet(
    title = "Send invoice: $number", busy = busy, onDismiss = onDismiss,
    onConfirm = {
      busy.run(scope) {
        val answer = try {
          context.api.request(
            ORDER_INVOICE_SEND_ROUTE, ApiMethod.POST,
            JsonObject(mapOf(
              "hostId" to JsonPrimitive(context.hostId.orEmpty()), "orderId" to JsonPrimitive(quoteId), "to" to JsonPrimitive(to.trim()),
              "subject" to JsonPrimitive(subject), "message" to JsonPrimitive(message),
            )),
            idempotencyKey = key,
          ) as? JsonObject
        } catch (error: ConsoleApiError) {
          throw Exception((error.body as? JsonObject).errorText() ?: error.message)
        }
        onSent("$number sent to ${(answer?.get("to") as? JsonPrimitive)?.contentOrNull ?: to.trim()}")
      }
    },
    confirmLabel = "Send", confirmEnabled = to.isNotBlank(), workingLabel = "Sending…",
    modifier = Modifier.testTag("quote-invoice-form"),
  ) {
    Column(verticalArrangement = Arrangement.spacedBy(space(1.5f))) {
      OutlinedTextField(to, { to = it }, label = { Text("To") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
        modifier = Modifier.fillMaxWidth())
      OutlinedTextField(
        subject, { subject = it.take(INVOICE_SUBJECT_LIMIT) }, label = { Text("Subject") }, singleLine = true,
        supportingText = invoiceEmailThread(order)?.let { { Text("Keep the subject the same to keep these emails in one conversation in your customer’s inbox.") } },
        modifier = Modifier.fillMaxWidth(),
      )
      OutlinedTextField(message, { message = it.take(INVOICE_MESSAGE_LIMIT) }, label = { Text("Message") }, minLines = 4,
        supportingText = { Text("Shown at the top of the email, in your words.") }, modifier = Modifier.fillMaxWidth())
      Text(invoiceSendNote(invoiceIsPaid(order), site.contact), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
  }
}

/** The pay link (the console's QuotePayLinkSection): copy it, or replace it so the one sent before stops working. */
@Composable
fun QuotePayLinkSection(context: NativePluginContext, order: HostOrder, quoteId: String, onNotice: (String, StatusTone) -> Unit) {
  val words = quotePayLinkWords(order)
  val version = quoteLinkVersion(order.quote)
  val canSend = rememberMemberPermissions(context).can(QUOTE_SEND_PERMISSION)
  @Suppress("DEPRECATION") val clipboard = LocalClipboardManager.current
  val scope = rememberCoroutineScope()
  var signed by remember { mutableStateOf<SignedQuoteLink?>(null) }
  var busy by remember { mutableStateOf(false) }
  var confirmingReplace by remember { mutableStateOf(false) }

  suspend fun fetch(replace: Boolean): String? {
    busy = true
    return try {
      requestQuoteLink(context.api, context.hostId.orEmpty(), quoteId, replace, version).also { signed = it }.url
    } catch (error: Throwable) {
      if (error is kotlinx.coroutines.CancellationException) throw error
      onNotice(((error as? ConsoleApiError)?.body as? JsonObject).errorText() ?: "The ${words.name} could not be made", StatusTone.ERROR)
      null
    } finally {
      busy = false
    }
  }

  // The quote's link moved on (a revision was emailed, or the link replaced): fetch the current one in its place.
  LaunchedEffect(version) { if ((signed?.version ?: version) < version) fetch(false) }

  // A link the server made at a version the stored quote has not caught up to yet is the newest one.
  val url = signed?.takeIf { it.version >= version }?.url
  SectionCard(words.title) {
    Column(verticalArrangement = Arrangement.spacedBy(space(1f))) {
      Text(words.explanation, color = MaterialTheme.colorScheme.onSurfaceVariant)
      url?.let {
        OutlinedTextField(it, {}, readOnly = true, label = { Text(words.title) }, modifier = Modifier.fillMaxWidth().testTag("quote-pay-link-url"))
      }
      Row(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
        OutlinedButton(onClick = {
          if (!canSend) return@OutlinedButton onNotice(permissionRefusalText(QUOTE_SEND_PERMISSION), StatusTone.INFO)
          scope.launch {
            val link = url ?: fetch(false) ?: return@launch
            clipboard.setText(AnnotatedString(link))
            onNotice("${words.title} copied", StatusTone.SUCCESS)
          }
        }, enabled = !busy, modifier = Modifier.testTag("quote-copy-link")) { Text("Copy ${words.name}") }
        if (isUnpaidQuote(order)) {
          TextButton(onClick = {
            if (canSend) confirmingReplace = true else onNotice(permissionRefusalText(QUOTE_SEND_PERMISSION), StatusTone.INFO)
          }, enabled = !busy, modifier = Modifier.testTag("quote-replace-link")) { Text("Replace link") }
        }
      }
    }
  }
  if (confirmingReplace) {
    AlertDialog(
      onDismissRequest = { if (!busy) confirmingReplace = false },
      title = { Text("Replace the ${words.name}?") },
      text = { Text("The link you sent before will stop working: it will tell the customer the ${words.opens} was updated, and show nothing of it. Send them the new link.") },
      confirmButton = {
        TextButton(onClick = {
          scope.launch {
            val link = fetch(true)
            confirmingReplace = false
            if (link != null) {
              clipboard.setText(AnnotatedString(link))
              onNotice("New ${words.name} copied. The earlier link no longer opens the ${words.opens}.", StatusTone.SUCCESS)
            }
          }
        }, enabled = !busy, modifier = Modifier.testTag("quote-replace-confirm")) { Text("Replace link") }
      },
      dismissButton = { TextButton(onClick = { confirmingReplace = false }, enabled = !busy) { Text("Cancel") } },
    )
  }
}
