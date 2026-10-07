package com.aglyn.plugins.bookings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.aglyn.contracts.formatReceiptMoney
import com.aglyn.hardware.CardCollectorState
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.EmptyState
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.SkeletonList
import com.aglyn.ui.StatusChip
import com.aglyn.ui.StatusTone
import com.aglyn.ui.space
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlin.time.Clock
import kotlin.time.ExperimentalTime
import kotlin.uuid.ExperimentalUuidApi
import kotlin.uuid.Uuid

@OptIn(ExperimentalTime::class)
private fun nowMs() = Clock.System.now().toEpochMilliseconds()

@OptIn(ExperimentalUuidApi::class)
private fun attemptKey() = "pos-booking-${Uuid.random()}"

private fun usd(cents: Long) = formatReceiptMoney(cents.toDouble(), "usd")

private sealed interface Loaded {
  data object Loading : Loaded
  data class Ready(val bookings: List<CounterBooking>) : Loaded
  data class Failed(val message: String) : Loaded
}

private fun stateChip(state: BookingInPersonState): Pair<String, StatusTone> = when (state) {
  BookingInPersonState.PAID -> "Paid" to StatusTone.SUCCESS
  BookingInPersonState.COLLECTING -> "Card in progress" to StatusTone.INFO
  BookingInPersonState.AWAITING_ONLINE -> "Paying online" to StatusTone.INFO
  BookingInPersonState.PAYABLE -> "To pay" to StatusTone.WARNING
  BookingInPersonState.CANCELED -> "Canceled" to StatusTone.NEUTRAL
}

/**
 * Today's bookings at the counter, earliest first, with what each owes; a
 * payable one takes its payment on this device's card reader.
 */
@Composable
fun CounterBookingsScreen(context: NativePluginContext) {
  val hostId = context.hostId ?: return
  var refresh by remember { mutableIntStateOf(0) }
  var loaded by remember { mutableStateOf<Loaded>(Loaded.Loading) }
  var paying by remember { mutableStateOf<CounterBooking?>(null) }
  var notice by remember { mutableStateOf<Pair<String, StatusTone>?>(null) }
  LaunchedEffect(hostId, refresh) {
    loaded = try {
      val now = nowMs()
      val docs = context.firestore.page(todayBookingsQuery(hostId, now)).docs
      val prices = docs.mapNotNull { it.data["serviceId"] as? String }.distinct().associateWith { serviceId ->
        bookingSuggestedCents(runCatching { context.firestore.get("hosts/$hostId/services/$serviceId") }.getOrNull()?.data)
      }
      Loaded.Ready(
        docs.map { counterBookingFrom(it, prices[it.data["serviceId"] as? String], now) }.filter { it.state != BookingInPersonState.CANCELED },
      )
    } catch (error: Throwable) {
      if (error is CancellationException) throw error
      Loaded.Failed("Today's bookings could not be loaded. Check the connection and try again.")
    }
  }
  val collector = context.peripherals.cardCollector
  val readerState by (collector?.state ?: remember { kotlinx.coroutines.flow.MutableStateFlow<CardCollectorState?>(null) }).collectAsState()
  val ready = readerState is CardCollectorState.Connected

  Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
    Column(Modifier.widthIn(max = 760.dp).fillMaxWidth().testTag("pos-counter-bookings")) {
      if (!ready) {
        NoticeBanner(
          when (val state = readerState) {
            is CardCollectorState.Unavailable -> state.reason
            null -> "Booking payments are taken on a device's own reader (Tap to Pay or Bluetooth), which this register does not have."
            else -> "Open the register to connect this device's card reader."
          },
          StatusTone.NEUTRAL,
          Modifier.padding(space(2f)),
        )
      }
      notice?.let { (message, tone) -> NoticeBanner(message, tone, Modifier.padding(horizontal = space(2f)).padding(bottom = space(1f))) }
      when (val value = loaded) {
        Loaded.Loading -> SkeletonList(rows = 4)
        is Loaded.Failed -> EmptyState(
          "Bookings did not load",
          body = value.message,
          icon = AglynIcons.named("error"),
          action = { OutlinedButton(onClick = { refresh++ }) { Text("Try again") } },
        )
        is Loaded.Ready -> if (value.bookings.isEmpty()) {
          EmptyState("No bookings today", body = "Bookings made for today show up here.", icon = AglynIcons.named("event"))
        } else {
          LazyColumn(Modifier.fillMaxSize()) {
            items(value.bookings, key = { it.id }) { booking ->
              BookingRow(booking, canPay = ready) { paying = booking }
              HorizontalDivider(Modifier.padding(horizontal = space(2f)))
            }
          }
        }
      }
    }
  }

  paying?.let { booking ->
    PayDialog(
      booking = booking,
      onDismiss = { paying = null },
      pay = { cents, onPriced ->
        takeBookingPayment(context.api, collector!!, hostId, booking.id, cents, attemptKey(), onPriced)
      },
      onDone = { outcome ->
        paying = null
        notice = when (outcome) {
          is InPersonOutcome.Paid -> "${booking.name} paid ${usd(outcome.amountCents)}." to StatusTone.SUCCESS
          InPersonOutcome.Canceled -> "The payment was canceled. Nobody was charged." to StatusTone.WARNING
          is InPersonOutcome.Failed -> outcome.message to StatusTone.ERROR
        }
        refresh++
      },
    )
  }
}

@Composable
private fun BookingRow(booking: CounterBooking, canPay: Boolean, onPay: () -> Unit) {
  val (label, tone) = stateChip(booking.state)
  Row(
    Modifier.fillMaxWidth().padding(horizontal = space(2f), vertical = space(1.5f)).testTag("booking-${booking.id}"),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(space(2f)),
  ) {
    Column(Modifier.widthIn(min = 72.dp)) {
      Text(formatBookingTime(booking.startsAtMs), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
      Text(formatBookingTime(booking.endsAtMs), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
      Text(booking.name, style = MaterialTheme.typography.titleMedium)
      Text(booking.serviceName, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
      Row(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalAlignment = Alignment.CenterVertically) {
        StatusChip(label, tone)
        if (booking.state == BookingInPersonState.PAID && booking.paidAmountCents > 0) {
          Text(usd(booking.paidAmountCents), style = MaterialTheme.typography.bodyMedium)
        } else {
          booking.suggestedCents?.let { Text(usd(it), style = MaterialTheme.typography.bodyMedium) }
        }
      }
    }
    if (booking.state == BookingInPersonState.PAYABLE) {
      FilledTonalButton(onClick = onPay, enabled = canPay, modifier = Modifier.heightIn(min = 48.dp).testTag("pay-${booking.id}")) { Text("Take payment") }
    }
  }
}

@Composable
private fun PayDialog(
  booking: CounterBooking,
  onDismiss: () -> Unit,
  pay: suspend (Long, (PricedCharge) -> Unit) -> InPersonOutcome,
  onDone: (InPersonOutcome) -> Unit,
) {
  val scope = rememberCoroutineScope()
  var text by remember { mutableStateOf(booking.suggestedCents?.let { "${it / 100}.${(it % 100).toString().padStart(2, '0')}" } ?: "") }
  var busy by remember { mutableStateOf(false) }
  var priced by remember { mutableStateOf<PricedCharge?>(null) }
  val cents = Regex("^\\d+(\\.\\d{0,2})?$").matchEntire(text.replace(Regex("[$,\\s]"), ""))?.value?.let { value ->
    val parts = value.split('.')
    parts[0].toLong() * 100 + (parts.getOrNull(1)?.padEnd(2, '0')?.toLong() ?: 0)
  }
  val problem = bookingInPersonAmountProblem(cents)
  AlertDialog(
    onDismissRequest = { if (!busy) onDismiss() },
    title = { Text("Take payment") },
    text = {
      Column(verticalArrangement = Arrangement.spacedBy(space(1.5f))) {
        Text("${booking.name} · ${booking.serviceName}", style = MaterialTheme.typography.bodyLarge)
        OutlinedTextField(
          value = text,
          onValueChange = { text = it },
          enabled = !busy,
          label = { Text("Amount for the service") },
          prefix = { Text("$") },
          singleLine = true,
          isError = text.isNotEmpty() && problem != null,
          supportingText = { Text(if (text.isNotEmpty() && problem != null) problem else "The store's tax is added to this.") },
          keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
          modifier = Modifier.testTag("booking-amount"),
        )
        if (busy) {
          Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1.5f))) {
            CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
            Text(priced?.let { "Ask the customer to tap or insert a card for ${usd(it.amountCents)}." } ?: "Starting the payment…")
          }
        }
      }
    },
    confirmButton = {
      TextButton(
        onClick = {
          val amount = cents ?: return@TextButton
          busy = true
          scope.launch { onDone(pay(amount) { priced = it }) }
        },
        enabled = !busy && problem == null,
      ) { Text(cents?.let { "Charge ${usd(it)} + tax" } ?: "Charge") }
    },
    dismissButton = { TextButton(onClick = onDismiss, enabled = !busy) { Text("Cancel") } },
  )
}
