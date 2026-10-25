package com.aglyn.plugins.deliveryapps

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.aglyn.core.ConsoleApiError
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.OutlinedButton
import com.aglyn.ui.StatusChip
import com.aglyn.ui.StatusTone
import com.aglyn.ui.TextButton
import com.aglyn.ui.formatClock
import com.aglyn.ui.space
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/*
 * THE REGISTER'S DELIVERY QUEUE: the state behind the card. It asks the route
 * for the queue on a steady beat, says once when a new order has arrived (the
 * first look aside), and sends the cashier's one step on an order, then asks
 * again so the card shows where the order now stands.
 */

/** The route's own sentence about the last step, or why it did not go through. */
data class DeliveryNotice(val message: String, val isError: Boolean)

class DeliveryQueueModel(private val api: DeliveryAppsApi, private val hostId: () -> String?) {
  /** Null until the first answer; [DeliveryQueue.DISCONNECTED] once a look finds no service (or turns the cashier away). */
  var queue by mutableStateOf<DeliveryQueue?>(null)
    private set

  /** The order a step is on its way for. */
  var busy by mutableStateOf<String?>(null)
    private set

  /** A new order arrived since the last look, said once. */
  var announcement by mutableStateOf<String?>(null)
  var notice by mutableStateOf<DeliveryNotice?>(null)
  var showRecent by mutableStateOf(false)

  /** The order the cashier is about to turn down (the reason is asked first). */
  var rejecting by mutableStateOf<DeliveryOrder?>(null)

  private var seen: Set<String>? = null

  /** Orders waiting for the cashier to accept or reject. */
  val waiting: Int get() = queue?.open?.count { it.status == DeliveryOrderStatus.NEW } ?: 0

  suspend fun refresh() {
    val host = hostId() ?: return
    try {
      val answer = api.queue(host)
      // A new order since the last look is announced once, the first look aside.
      val known = seen
      val fresh = if (known == null) emptyList() else answer.open.filter { it.status == DeliveryOrderStatus.NEW && it.id !in known }
      seen = answer.open.map { it.id }.toSet()
      fresh.firstOrNull()?.let { first ->
        announcement = if (fresh.size == 1) "New ${first.serviceLabel} order ${first.externalRef}" else "${fresh.size} new delivery orders"
      }
      queue = answer
    } catch (failure: Throwable) {
      if (failure is CancellationException) throw failure
      // Turned away, or no service here: the register shows nothing.
      queue = queue ?: DeliveryQueue.DISCONNECTED
    }
  }

  /** The cashier's step on an order. Rejecting asks for a reason first ([reject]). */
  suspend fun act(order: DeliveryOrder, action: DeliveryAction, reason: String? = null) {
    val host = hostId() ?: return
    if (busy != null) return
    if (action == DeliveryAction.REJECT && reason == null) {
      rejecting = order
      return
    }
    busy = order.id
    notice = null
    try {
      api.act(host, order.id, action, reason).message?.let { notice = DeliveryNotice(it, false) }
    } catch (failure: Throwable) {
      if (failure is CancellationException) {
        busy = null
        throw failure
      }
      val words = (failure as? ConsoleApiError)?.message.orEmpty()
      notice = DeliveryNotice(words.ifEmpty { "That did not go through. Try again in a moment." }, true)
    }
    busy = null
    refresh()
  }

  suspend fun reject(order: DeliveryOrder, reason: String) {
    rejecting = null
    act(order, DeliveryAction.REJECT, reason)
  }
}

/**
 * The register's delivery orders, above the till: each open DoorDash, Uber Eats or Grubhub order with what to make and
 * the one next step (accept or reject, ready, picked up), the latest finished ones folded beneath. It asks again every
 * few seconds, and draws nothing until the site has a service connected, or for anyone the register's gate turns away.
 */
@Composable
fun DeliveryQueueCard(context: NativePluginContext) {
  val model = remember(context.hostId) { DeliveryQueueModel(ConsoleDeliveryAppsApi(context.api)) { context.hostId } }
  val scope = rememberCoroutineScope()
  LaunchedEffect(model) {
    while (isActive) {
      model.refresh()
      delay(DELIVERY_QUEUE_POLL_MS)
    }
  }
  val queue = model.queue
  if (queue == null || !queue.connected) return
  Surface(
    Modifier.fillMaxWidth().padding(horizontal = space(2f), vertical = space(1f)).testTag("delivery-queue"),
    shape = MaterialTheme.shapes.large,
    color = MaterialTheme.colorScheme.surfaceContainerLowest,
    tonalElevation = 1.dp,
  ) {
    Column(Modifier.padding(space(2f)), verticalArrangement = Arrangement.spacedBy(space(1.5f))) {
      Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1f))) {
        Text("Delivery orders", style = MaterialTheme.typography.titleMedium)
        if (model.waiting > 0) StatusChip("${model.waiting}", StatusTone.WARNING)
        Row(Modifier.weight(1f), horizontalArrangement = Arrangement.End) {
          if (queue.recent.isNotEmpty()) {
            TextButton(onClick = { model.showRecent = !model.showRecent }, modifier = Modifier.testTag("delivery-finished")) {
              Text(if (model.showRecent) "Hide finished" else "Finished")
            }
          }
        }
      }
      model.announcement?.let { NoticeBanner(it, StatusTone.INFO, Modifier.testTag("delivery-announcement"), action = { TextButton(onClick = { model.announcement = null }) { Text("Dismiss") } }) }
      model.notice?.let { notice ->
        NoticeBanner(notice.message, if (notice.isError) StatusTone.ERROR else StatusTone.INFO, action = { TextButton(onClick = { model.notice = null }) { Text("Dismiss") } })
      }
      if (queue.open.isEmpty()) {
        Text("No delivery orders open.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
      for (order in queue.open) {
        HorizontalDivider()
        OrderRow(model, order) { action -> scope.launch { model.act(order, action) } }
      }
      if (model.showRecent) {
        for (order in queue.recent) {
          HorizontalDivider()
          Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1f))) {
            StatusChip(order.status.label, order.status.tone())
            Text("${order.serviceLabel} ${order.externalRef}${order.customerName?.let { " · $it" }.orEmpty()}", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
            Text(order.displayRef ?: deliveryMoney(order.totalCents, order.currency), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
          }
        }
      }
    }
  }
  model.rejecting?.let { order -> RejectDialog(order, onClose = { reason -> if (reason == null) model.rejecting = null else scope.launch { model.reject(order, reason) } }) }
}

internal fun DeliveryOrderStatus.tone(): StatusTone = when (this) {
  DeliveryOrderStatus.NEW -> StatusTone.WARNING
  DeliveryOrderStatus.ACCEPTED -> StatusTone.INFO
  DeliveryOrderStatus.READY -> StatusTone.SUCCESS
  DeliveryOrderStatus.PICKED_UP, DeliveryOrderStatus.REJECTED -> StatusTone.NEUTRAL
  DeliveryOrderStatus.CANCELLED -> StatusTone.ERROR
}

@Composable
private fun OrderRow(model: DeliveryQueueModel, order: DeliveryOrder, onAct: (DeliveryAction) -> Unit) {
  val busy = model.busy == order.id
  Column(Modifier.fillMaxWidth().testTag("delivery-order-${order.id}"), verticalArrangement = Arrangement.spacedBy(space(1f))) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1f))) {
      StatusChip(order.status.label, order.status.tone())
      if (order.testMode) StatusChip("Test", StatusTone.INFO)
      Text("${order.serviceLabel} ${order.externalRef}${order.customerName?.let { " · $it" }.orEmpty()}", style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
      Text(deliveryMoney(order.totalCents, order.currency), style = MaterialTheme.typography.titleSmall)
    }
    Text(detailLine(order), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    for (line in order.lines) {
      Text(lineText(line), style = MaterialTheme.typography.bodyMedium)
    }
    order.instructions?.let { NoticeBanner(it, StatusTone.INFO) }
    if (order.oversold > 0) NoticeBanner("${order.oversold} sold beyond what was in stock.", StatusTone.WARNING)
    if (order.refundedCents > 0) {
      Text("${deliveryMoney(order.refundedCents, order.currency)} refunded by ${order.serviceLabel}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    order.error?.let { error ->
      NoticeBanner(
        error,
        if (order.pending == null) StatusTone.ERROR else StatusTone.WARNING,
        action = if (order.pending != null) ({ TextButton(onClick = { onAct(DeliveryAction.RETRY) }, enabled = !busy) { Text("Send again") } }) else null,
      )
    }
    val steps = deliverySteps(order)
    if (steps.isNotEmpty()) {
      Row(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
        for (step in steps) {
          val modifier = Modifier.heightIn(min = 52.dp).testTag("delivery-${step.action.wire}-${order.id}")
          when {
            step.destructive -> OutlinedButton(
              onClick = { onAct(step.action) },
              enabled = !busy,
              modifier = modifier,
              colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
            ) { Text(step.label) }
            step.primary -> Button(onClick = { onAct(step.action) }, enabled = !busy, modifier = modifier) { Text(step.label) }
            else -> OutlinedButton(onClick = { onAct(step.action) }, enabled = !busy, modifier = modifier) { Text(step.label) }
          }
        }
      }
    }
  }
}

private fun detailLine(order: DeliveryOrder): String {
  val parts = mutableListOf("Placed ${formatClock(order.placedAtMs.toLong())}")
  order.pickupAtMs?.let { parts += "${if (order.handoff == "customer") "Customer collects" else "Courier"} at ${formatClock(it.toLong())}" }
  order.displayRef?.let { parts += "Order $it" }
  return parts.joinToString(" · ")
}

private fun lineText(line: DeliveryOrderLine): String {
  var text = "${line.quantity} × ${line.name}"
  if (line.options.isNotEmpty()) text += " — ${line.options.joinToString(", ")}"
  line.instructions?.let { text += " · “$it”" }
  return text
}

@Composable
private fun RejectDialog(order: DeliveryOrder, onClose: (String?) -> Unit) {
  var reason by remember(order.id) { mutableStateOf(DELIVERY_REJECT_REASONS.first()) }
  AlertDialog(
    onDismissRequest = { onClose(null) },
    title = { Text("Reject ${order.serviceLabel} ${order.externalRef}?") },
    text = {
      Column(verticalArrangement = Arrangement.spacedBy(space(1f))) {
        Text("The service tells the customer and refunds them. Nothing is taken off your shelf.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        for (entry in DELIVERY_REJECT_REASONS) {
          Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            RadioButton(selected = reason == entry, onClick = { reason = entry })
            Text(entry, Modifier.padding(start = space(0.5f)))
          }
        }
      }
    },
    confirmButton = {
      Button(onClick = { onClose(reason) }, colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error), modifier = Modifier.testTag("delivery-reject-confirm")) { Text("Reject") }
    },
    dismissButton = { TextButton(onClick = { onClose(null) }) { Text("Keep it") } },
  )
}
