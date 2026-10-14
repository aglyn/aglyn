package com.aglyn.plugins.commerce.pos

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.ConsoleApiError
import com.aglyn.ui.space
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/*
 * "PAY AT COUNTER" ORDERS FROM THE KIOSKS (AGL-3623, AGL-3651, AGL-3652), on the
 * register. The Apple app's `PosKioskQueue.swift`. Each is an open sale a kiosk
 * already priced; Take payment loads it into the register's checkout, where the
 * cashier takes payment exactly as on a sale they rang themselves. Oldest first,
 * as a counter serves them, and nothing is drawn when the queue is empty.
 *
 * The register calls the SAME staff actions the console register calls
 * (`queue`, `take`), as the signed-in member.
 */

/** How often the register looks for orders a kiosk sent to the counter. */
const val POS_KIOSK_QUEUE_POLL_MS = 10_000L

data class PosKioskQueueEntry(val orderId: String, val number: Int, val queuedAtMs: Double, val totalCents: Long, val itemCount: Int)

/** A queued order, as the register loads it into checkout. */
data class PosKioskTaken(val sale: PosSale, val number: Int)

data class PosKioskQueueRead(val entries: List<PosKioskQueueEntry>, val currency: String?)

interface PosKioskQueueApi {
  suspend fun queue(registerId: String): PosKioskQueueRead
  suspend fun take(registerId: String, orderId: String): PosKioskTaken
}

class ConsolePosKioskQueueApi(private val api: ConsoleApiClient, private val hostId: String) : PosKioskQueueApi {
  override suspend fun queue(registerId: String): PosKioskQueueRead {
    val answer = api.request(POS_KIOSK_ROUTE, ApiMethod.GET, query = mapOf("action" to "queue", "hostId" to hostId, "registerId" to registerId)).obj()
    val entries = answer["entries"].arr().mapNotNull { entry ->
      val fields = entry.obj()
      PosKioskQueueEntry(
        orderId = fields["orderId"].str() ?: return@mapNotNull null,
        number = fields["number"].cents().toInt(),
        queuedAtMs = fields["queuedAtMs"].num() ?: 0.0,
        totalCents = fields["totalCents"].cents(),
        itemCount = fields["itemCount"].cents().toInt(),
      )
    }
    return PosKioskQueueRead(entries, answer["currency"].str())
  }

  override suspend fun take(registerId: String, orderId: String): PosKioskTaken {
    val answer = api.request(
      POS_KIOSK_ROUTE,
      ApiMethod.POST,
      buildJsonObject {
        put("action", "take")
        put("hostId", hostId)
        put("registerId", registerId)
        put("orderId", orderId)
      },
    ).obj()
    val sale = answer["sale"]?.takeIf { it is JsonObject } ?: throw ConsoleApiError("That order could not be opened", 502, null)
    return PosKioskTaken(readPaymentAnswer(JsonObject(mapOf("sale" to sale))).sale, answer["number"].cents().toInt())
  }
}

object OfflinePosKioskQueue : PosKioskQueueApi {
  private fun unreachable() = ConsoleApiError("The register is offline. Check the connection and try again.", 0, null)
  override suspend fun queue(registerId: String): PosKioskQueueRead = throw unreachable()
  override suspend fun take(registerId: String, orderId: String): PosKioskTaken = throw unreachable()
}

/** What taking a queued order came to. */
sealed interface PosKioskTake {
  data class Taken(val taken: PosKioskTaken) : PosKioskTake
  data class Refused(val message: String) : PosKioskTake
}

class PosKioskQueueModel(private val api: PosKioskQueueApi, private val registerId: () -> String?) {
  var entries by mutableStateOf<List<PosKioskQueueEntry>>(emptyList())
    private set
  var taking by mutableStateOf<String?>(null)
    private set

  /** A missed poll is retried on the next tick; the queue keeps what it showed. */
  suspend fun load() {
    val register = registerId()
    if (register == null) {
      entries = emptyList()
      return
    }
    try {
      entries = api.queue(register).entries
    } catch (failure: Throwable) {
      if (failure is CancellationException) throw failure
    }
  }

  /** Opens a queued order for payment; the reason when it cannot be. */
  suspend fun take(entry: PosKioskQueueEntry): PosKioskTake {
    val register = registerId()
    if (register == null || taking != null) return PosKioskTake.Refused("Wait a moment.")
    taking = entry.orderId
    return try {
      PosKioskTake.Taken(api.take(register, entry.orderId))
    } catch (failure: Throwable) {
      if (failure is CancellationException) throw failure
      load()
      PosKioskTake.Refused((failure as? ConsoleApiError)?.message ?: "That order could not be opened")
    } finally {
      taking = null
    }
  }
}

/** "Kiosk orders: sent to the counter to pay". Nothing when the queue is empty. */
@Composable
fun KioskQueueCard(model: RegisterModel) {
  val queue = model.kioskQueue
  val scope = rememberCoroutineScope()
  // A sale closing on the register is the moment a queued one may have gone; the poll also runs on a steady beat.
  LaunchedEffect(model.register?.id) {
    while (isActive) {
      queue.load()
      delay(POS_KIOSK_QUEUE_POLL_MS)
    }
  }
  if (queue.entries.isEmpty()) return
  Column(Modifier.padding(horizontal = space(2f), vertical = space(1f)).testTag("pos-kiosk-queue"), verticalArrangement = Arrangement.spacedBy(space(1f))) {
    Text("Kiosk orders", style = MaterialTheme.typography.titleSmall)
    Text("Sent to the counter to pay", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    for (entry in queue.entries) {
      Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1f))) {
        Column(Modifier.weight(1f)) {
          Text("#${entry.number}", style = MaterialTheme.typography.titleMedium)
          Text(
            "${entry.itemCount} ${if (entry.itemCount == 1) "item" else "items"} · ${money(entry.totalCents, model.currency)}",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
          )
        }
        Button(
          onClick = { scope.launch { model.takeKioskOrder(entry) } },
          enabled = model.checkout == null && queue.taking == null,
          modifier = Modifier.testTag("kiosk-take-${entry.number}"),
        ) { Text("Take payment") }
      }
    }
  }
}
