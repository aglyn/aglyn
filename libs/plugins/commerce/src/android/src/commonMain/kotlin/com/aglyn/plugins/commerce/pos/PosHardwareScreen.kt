package com.aglyn.plugins.commerce.pos

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import com.aglyn.contracts.Contracts
import com.aglyn.contracts.permissionRefusalText
import com.aglyn.core.AglynConfig
import com.aglyn.core.PlanFeatureDefaults
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.pluginhost.rememberMemberPermissions
import com.aglyn.plugins.commerce.products.productCheckInCarried
import com.aglyn.ui.ActionDialog
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.EmptyState
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.SectionCard
import com.aglyn.ui.SelectField
import com.aglyn.ui.SelectOption
import com.aglyn.ui.SkeletonList
import com.aglyn.ui.StatusChip
import com.aglyn.ui.StatusTone
import com.aglyn.ui.TextButton
import com.aglyn.ui.rememberInlineMarkdown
import com.aglyn.ui.space
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/** The tone Status is drawn in (the console's `POS_HARDWARE_STATUS_COLOR`, on the kit's tones). */
fun posHardwareStatusTone(status: String): StatusTone = when (status) {
  "delivered", "registered" -> StatusTone.SUCCESS
  "canceled", "refunded" -> StatusTone.NEUTRAL
  else -> StatusTone.INFO
}

/** The published Terms the hardware terms of sale are part of (`posHardwareTermsUrl`). */
val POS_HARDWARE_TERMS_URL = "${AglynConfig.DEFAULT_LEGAL_ORIGIN}/legal/terms"

/**
 * Hardware (AGL-4038): the console's Hardware card and its Card readers to set up card on one screen. The catalog, the
 * basket and its summary, the terms of sale and business use, Check out on Stripe's own page in the secure browser tab,
 * Your orders with a return request, and the readers bought in person waiting for their store.
 */
@Composable
fun PosHardwareScreen(context: NativePluginContext) {
  val hostId = context.hostId ?: return
  val permissions = rememberMemberPermissions(context)
  val mayVisit = POS_HARDWARE_VISIT_KEYS.any { permissions.can(it) }
  if (!mayVisit) {
    EmptyState(
      "Point of sale is off for you here",
      body = permissionRefusalText(POS_HARDWARE_BUY_KEY),
      icon = AglynIcons.named("lock"),
      modifier = Modifier.testTag("pos-hardware-refused"),
    )
    return
  }
  val canBuy = permissions.can(POS_HARDWARE_BUY_KEY)
  val canSetUp = permissions.can(POS_HARDWARE_DEVICES_KEY)
  val text = Contracts.posHardwareShopText
  val words = Contracts.posHardwareWaitingText
  val shop = remember(context.api, hostId) { PosHardwareApi(context.api, hostId) }
  val scope = rememberCoroutineScope()
  val uri = LocalUriHandler.current

  var refresh by remember { mutableIntStateOf(0) }
  var catalog by remember { mutableStateOf<PosHardwareCatalog?>(null) }
  var orders by remember { mutableStateOf<List<PosHardwareOrderRow>?>(null) }
  var waiting by remember { mutableStateOf(PosHardwareWaiting.NONE) }
  var posPlan by remember { mutableStateOf<Boolean?>(null) }
  val quantities = remember { mutableStateMapOf<String, Int>() }
  var shippingMethod by remember { mutableStateOf("") }
  var termsAccepted by remember { mutableStateOf(false) }
  var businessUse by remember { mutableStateOf(false) }
  var busy by remember { mutableStateOf(false) }
  var notice by remember { mutableStateOf<Pair<String, StatusTone>?>(null) }
  var returning by remember { mutableStateOf<PosHardwareOrderRow?>(null) }
  var returnReason by remember { mutableStateOf("") }
  val chosen = remember { mutableStateMapOf<String, String>() }
  // One attempt per basket: the same basket reaches the same Checkout Session, a changed one is a new attempt.
  var attempt by remember { mutableStateOf("" to newAttemptKey("pos-hw")) }

  LaunchedEffect(hostId, refresh) {
    // A catalog that cannot be read is a closed shop, as the console's card treats it.
    val answer = runCatching { shop.catalog() }.getOrElse { if (it is CancellationException) throw it; PosHardwareCatalog.CLOSED }
    catalog = answer
    if (answer.available && shippingMethod.isEmpty()) answer.shipping.firstOrNull()?.let { shippingMethod = it.method }
    orders = runCatching { shop.orders() }.getOrElse { if (it is CancellationException) throw it; emptyList() }
    waiting = runCatching { shop.waiting() }.getOrElse { if (it is CancellationException) throw it; PosHardwareWaiting.NONE }
    posPlan = productCheckInCarried(context.api, hostId)
  }

  fun run(done: String?, fallback: String, block: suspend () -> Unit) {
    if (busy) return
    busy = true
    scope.launch {
      try {
        block()
        if (done != null) notice = done to StatusTone.SUCCESS
        refresh++
      } catch (error: Throwable) {
        if (error is CancellationException) throw error
        notice = posHardwareRefusal(error, fallback) to StatusTone.WARNING
      } finally {
        busy = false
      }
    }
  }

  val included = PlanFeatureDefaults.grantedFrom["pos"]?.let { " Included from $it." }.orEmpty()
  val arrived = if (posPlan == false) {
    posHardwareArrivedNumbers(orders.orEmpty().map { Triple(it.number, it.status, it.source) })
  } else {
    emptyList()
  }

  Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
    Column(
      Modifier.fillMaxWidth().verticalScroll(rememberScrollState())
        .padding(horizontal = com.aglyn.ui.paneInset(), vertical = space(2f)).testTag("pos-hardware"),
      verticalArrangement = Arrangement.spacedBy(space(2f)),
    ) {
      notice?.let { (message, tone) ->
        NoticeBanner(message, tone)
      }

      if (waiting.orders.isNotEmpty()) {
        SectionCard(words.header) {
          Column(verticalArrangement = Arrangement.spacedBy(space(1.5f))) {
            Text(words.subheader, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            val planReason = if (waiting.posPlan) null else words.planReason
            val devicesReason = if (canSetUp) null else permissionRefusalText(POS_HARDWARE_DEVICES_KEY)
            if (!waiting.posPlan) NoticeBanner(words.planPrompt + included, StatusTone.INFO)
            waiting.orders.forEach { order ->
              Column(verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
                Text(posHardwareWaitingItems(order.lines), style = MaterialTheme.typography.titleSmall)
                Text(
                  "Order ${order.number} · bought ${posHardwareDay(order.createdAtMs, numeric = true)}",
                  style = MaterialTheme.typography.bodySmall,
                  color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                val store = waiting.stores.firstOrNull { it.hostId == order.hostId }
                if (store != null) {
                  Text(posHardwareWaitingNote(store.name, order.serialsTaken, store.hasLocation), style = MaterialTheme.typography.bodyMedium)
                  (planReason ?: devicesReason)?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                  TextButton(
                    onClick = { run(words.marked, words.failed) { shop.markSetUp(order.hostId, order.id) } },
                    enabled = !busy && planReason == null && devicesReason == null,
                    modifier = Modifier.testTag("pos-hardware-mark-set-up"),
                  ) { Text(words.markSetUp) }
                } else {
                  val pick = chosen[order.id] ?: waiting.stores.firstOrNull()?.hostId.orEmpty()
                  SelectField(
                    label = words.whichStore,
                    options = waiting.stores.map { SelectOption(it.hostId, it.name) },
                    selected = pick.ifEmpty { null },
                    onSelect = { chosen[order.id] = it.orEmpty() },
                  )
                  planReason?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                  TextButton(
                    onClick = { run(words.chosen, words.failed) { shop.chooseStore(pick, order.id) } },
                    enabled = !busy && pick.isNotEmpty() && planReason == null,
                    modifier = Modifier.testTag("pos-hardware-choose-store"),
                  ) { Text(words.choose) }
                }
              }
            }
          }
        }
      }

      val answer = catalog
      when {
        answer == null -> SectionCard(text.header) { SkeletonList(rows = 3) }
        answer.available -> {
          val shipping = answer.shipping.firstOrNull { it.method == shippingMethod }
          val basket = posHardwareBasket(answer.offers.map { it.sku to it.unitCents }, quantities, shipping?.cents, answer.automaticTax)
          val (blockedReason, enabled) = posHardwareCheckoutState(canBuy, termsAccepted, businessUse, basket.lines.isNotEmpty(), shipping != null)
          SectionCard(text.header) {
            Column(verticalArrangement = Arrangement.spacedBy(space(1.5f))) {
              Text(text.subheader, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
              if (posPlan == false && arrived.isEmpty()) NoticeBanner(posHardwarePlanPrompt() + included, StatusTone.INFO)
              Text(text.intro, style = MaterialTheme.typography.bodyMedium)
              answer.offers.forEach { offer ->
                Column(Modifier.fillMaxWidth().testTag("pos-hardware-offer-${offer.sku}"), verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
                  Text(offer.name, style = MaterialTheme.typography.titleSmall)
                  Text(offer.use, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                  Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(2f))) {
                    Text(formatPosHardwareCents(offer.unitCents), style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
                    SelectField(
                      label = text.quantity,
                      options = (0..Contracts.posHardwareMaxPerLine.toInt()).map { SelectOption("$it", "$it") },
                      selected = "${quantities[offer.sku] ?: 0}",
                      onSelect = { quantities[offer.sku] = it?.toIntOrNull() ?: 0 },
                      modifier = Modifier.weight(1f),
                    )
                  }
                }
              }
              SelectField(
                label = text.shipping,
                options = answer.shipping.map { SelectOption(it.method, "${it.label} · ${formatPosHardwareCents(it.cents)}") },
                selected = shippingMethod.ifEmpty { null },
                onSelect = { shippingMethod = it.orEmpty() },
              )
              SummaryRow(text.items, formatPosHardwareCents(basket.itemsCents))
              SummaryRow(text.shipping, shipping?.let { formatPosHardwareCents(it.cents) } ?: "—")
              if (answer.automaticTax) SummaryRow(text.tax, text.taxAtCheckout)
              SummaryRow(basket.totalLabel, formatPosHardwareCents(basket.totalCents), strong = true, modifier = Modifier.testTag("pos-hardware-total"))
              Text(text.shipsTo, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
              Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(termsAccepted, onCheckedChange = { termsAccepted = it }, modifier = Modifier.testTag("pos-hardware-terms"))
                // The terms are the published Terms page, read in the in-app browser.
                Text(
                  rememberInlineMarkdown("${text.termsBefore}[${text.termsLink}]($POS_HARDWARE_TERMS_URL)${text.termsAfter}") { uri.openUri(it) },
                  style = MaterialTheme.typography.bodyMedium,
                )
              }
              Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(businessUse, onCheckedChange = { businessUse = it }, modifier = Modifier.testTag("pos-hardware-business-use"))
                Text(text.businessUse, style = MaterialTheme.typography.bodyMedium)
              }
              blockedReason?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
              Button(
                onClick = {
                  val key = basket.lines.joinToString(",") { "${it.first}=${it.second}" } + "|" + shippingMethod
                  if (attempt.first != key) attempt = key to newAttemptKey("pos-hw")
                  run(null, text.checkoutFailed) {
                    val page = shop.checkout(basket.lines, shippingMethod, attempt.second)
                      ?: throw IllegalStateException(text.checkoutFailed)
                    // Stripe's page takes the card and the shipping address; the order shows under Your orders once paid.
                    uri.openUri(page)
                  }
                },
                enabled = enabled && !busy,
                modifier = Modifier.fillMaxWidth().testTag("pos-hardware-checkout"),
              ) { Text(text.checkout) }
            }
          }
        }
      }

      SectionCard(text.ordersTitle) {
        Column(verticalArrangement = Arrangement.spacedBy(space(1.5f))) {
          if (arrived.isNotEmpty()) NoticeBanner(posHardwarePlanPrompt(arrived) + included, StatusTone.INFO)
          val list = orders
          when {
            list == null -> SkeletonList(rows = 2)
            list.isEmpty() -> Text(text.noOrders, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            else -> list.forEach { order ->
              Column(verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                  Text(order.number, style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
                  StatusChip(order.statusLabel, posHardwareStatusTone(order.status))
                }
                Text(posHardwareOrderItems(order.lines), style = MaterialTheme.typography.bodyMedium)
                Text(
                  "${text.columnPlaced} ${posHardwareDay(order.createdAtMs)} · ${formatPosHardwareCents(order.totalCents)}",
                  style = MaterialTheme.typography.bodySmall,
                  color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                order.trackingNumber?.let { number ->
                  val url = order.trackingUrl
                  if (url != null) {
                    TextButton(onClick = { uri.openUri(url) }) { Text("${text.columnTracking} $number") }
                  } else {
                    Text("${text.columnTracking} $number", style = MaterialTheme.typography.bodySmall)
                  }
                }
                val label = order.returnLabel
                if (label != null) {
                  Text(label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                } else if (order.returnOffered) {
                  TextButton(onClick = { returning = order }, modifier = Modifier.testTag("pos-hardware-return-${order.number}")) { Text(text.returnAction) }
                }
              }
            }
          }
        }
      }
    }
  }

  returning?.let { order ->
    ActionDialog(
      title = posHardwareReturnTitle(order.number),
      confirmLabel = text.returnSend,
      dismissLabel = text.returnCancel,
      body = text.returnBody,
      busy = busy,
      confirmEnabled = posHardwareReturnReasonReady(returnReason),
      onDismiss = { returning = null },
      onConfirm = {
        run(text.returnSent, text.returnFailed) {
          try {
            shop.requestReturn(order.id, returnReason)
            returnReason = ""
          } finally {
            returning = null
          }
        }
      },
    ) {
      OutlinedTextField(
        returnReason,
        onValueChange = { returnReason = it },
        label = { Text(text.returnField) },
        minLines = 2,
        modifier = Modifier.fillMaxWidth().testTag("pos-hardware-return-reason"),
      )
    }
  }
}

@Composable
private fun SummaryRow(label: String, value: String, strong: Boolean = false, modifier: Modifier = Modifier) {
  Row(modifier.fillMaxWidth()) {
    Text(
      label,
      style = MaterialTheme.typography.bodyMedium,
      color = if (strong) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
      modifier = Modifier.weight(1f),
    )
    Text(value, style = if (strong) MaterialTheme.typography.titleSmall else MaterialTheme.typography.bodyMedium)
  }
}
