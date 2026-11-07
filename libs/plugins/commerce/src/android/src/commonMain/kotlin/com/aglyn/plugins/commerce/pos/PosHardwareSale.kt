package com.aglyn.plugins.commerce.pos

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Checkbox
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.ConsoleApiError
import com.aglyn.pluginhost.CustomerDisplayHosts
import com.aglyn.pluginhost.CustomerDisplayScreen
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.ui.FormSheet
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.OutlinedButton
import com.aglyn.ui.PanelSheet
import com.aglyn.ui.SectionCard
import com.aglyn.ui.StatusTone
import com.aglyn.ui.TextButton
import com.aglyn.ui.space
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlin.uuid.Uuid

/*
 * SELLING A CARD READER AT THE PLATFORM'S OWN STORE'S REGISTER (AGL-4038), as the console's PosHardwareBuyer has it:
 * on a sale that has one, the buyer is attached to it here (found by email, name or workspace), the buyer accepts the
 * terms of sale before paying (on the customer display, on this tablet, or by the booth sign), and each reader's serial
 * is taken, or the reader registered to the buyer's store by its code. Every reader sold without a buyer waits on the To
 * attach list. Draws nothing on any store but the platform's own hardware seller (`status`). The route
 * (`/api/commerce/pos-hardware-sale`) does all of it. The Apple kit's PosHardwareSale.swift.
 */

const val POS_HARDWARE_SALE_ROUTE = "/api/commerce/pos-hardware-sale"

/** The display page the terms open at, beneath `/kiosk/commerce`. */
const val POS_HARDWARE_TERMS_SCREEN_PATH = "/hardware-terms"

/** The printable booth sign, a public page of this plugin. */
const val POS_HARDWARE_TERMS_SIGN_PATH = "/kiosk/commerce/hardware-terms-sign"

/** How often the register asks whether the buyer accepted on the display. */
const val POS_HARDWARE_TERMS_POLL_MS = 2_500L

private fun JsonElement?.field(key: String): JsonElement? = (this as? JsonObject)?.get(key)
private fun JsonElement?.text(key: String): String? = (field(key) as? JsonPrimitive)?.contentOrNull
private fun JsonElement?.flag(key: String): Boolean = (field(key) as? JsonPrimitive)?.booleanOrNull == true
private fun JsonElement?.number(key: String): Double? = (field(key) as? JsonPrimitive)?.doubleOrNull
private fun JsonElement?.list(key: String): List<JsonElement> = (field(key) as? JsonArray).orEmpty()

private fun refusal(failure: Throwable, fallback: String): String =
  (((failure as? ConsoleApiError)?.body as? JsonObject)?.get("error") as? JsonPrimitive)?.contentOrNull ?: fallback

private fun reason(failure: Throwable): String? = (((failure as? ConsoleApiError)?.body as? JsonObject)?.get("reason") as? JsonPrimitive)?.contentOrNull

private fun newHardwareKey() = "attach-${Uuid.random()}"

/** The route, for one store. */
class PosHardwareSaleApi(private val api: ConsoleApiClient, private val hostId: String) {
  suspend fun call(action: String, fields: Map<String, JsonElement> = emptyMap(), attemptKey: String? = null): JsonElement? =
    api.request(POS_HARDWARE_SALE_ROUTE, ApiMethod.POST, JsonObject(mapOf("action" to JsonPrimitive(action), "hostId" to JsonPrimitive(hostId)) + fields), idempotencyKey = attemptKey)
}

/** The platform's own card reader sales at a register: the route, and whether this store is its hardware seller. */
class PosHardwareSales(val context: NativePluginContext, val api: PosHardwareSaleApi) {
  var seller by mutableStateOf(false)
    private set
  private var asked = false

  suspend fun check() {
    if (asked) return
    asked = true
    seller = runCatching { api.call("status").flag("seller") }.getOrDefault(false)
  }
}

/** The register's card reader sales, for the checkout to draw its part; null on a register with no console to ask. */
val LocalPosHardwareSales = staticCompositionLocalOf<PosHardwareSales?> { null }

/** A sale on the To attach list, as `pending` and `attach` answer it. */
data class HardwareToAttachRow(val id: String, val linesLabel: String, val detail: String) {
  companion object {
    fun from(json: JsonElement): HardwareToAttachRow? {
      val id = json.text("id") ?: return null
      val lines = json.list("lines").joinToString(", ") { "${it.number("quantity")?.toInt() ?: 0} × ${it.text("name").orEmpty()}" }
      val total = money((json.number("totalCents") ?: 0.0).toLong(), "usd")
      val register = json.number("registerNumber")?.toInt()
      val detail = listOfNotNull(
        register?.let { "${if (json.flag("online")) "Online order" else "Sale"} #$it" } ?: json.text("number"),
        json.number("createdAtMs")?.let { com.aglyn.contracts.formatLocalDay(it.toLong(), "MMM d, h:mm a") },
        if (json.flag("kiosk")) "at the kiosk" else null,
        if (json.flag("offline")) "rung offline" else null,
        if (json.flag("invited")) "invited ${json.text("contactEmail").orEmpty()}".trim() else json.text("contactEmail"),
        if (json.flag("awaitingWorkspace")) "has an account, no workspace yet" else null,
      ).filter { it.isNotEmpty() }.joinToString(" · ")
      return HardwareToAttachRow(id, "$lines · $total", detail)
    }
  }
}

/** One way the hardware can go: a person's workspace store, the store chosen at setup, or no workspace yet. */
data class HardwareBuyerOption(val id: String, val label: String, val detail: String?, val choice: JsonObject, val needsAddress: Boolean, val storeChosen: Boolean)

/** Every option a `find` answer offers, people first (the console's `optionsOf`). */
fun hardwareBuyerOptions(found: JsonElement?): List<HardwareBuyerOption> {
  fun workspaceOptions(uid: String, workspace: JsonElement, who: String): List<HardwareBuyerOption> {
    val orgId = workspace.text("orgId").orEmpty()
    val name = workspace.text("name").orEmpty()
    val plan = if (workspace.flag("posPlan")) null else "No point of sale plan yet: they add it when they set the reader up"
    return workspace.list("stores").map { store ->
      val hostId = store.text("hostId").orEmpty()
      val hasLocation = store.flag("hasLocation")
      val detail = listOfNotNull(plan, if (hasLocation) null else "No card reader location on this store yet: you can enter its address here").joinToString(". ")
      HardwareBuyerOption(
        "$uid:$orgId:$hostId", "$who · $name · ${store.text("name").orEmpty()}", detail.ifEmpty { null },
        JsonObject(mapOf("uid" to JsonPrimitive(uid), "orgId" to JsonPrimitive(orgId), "hostId" to JsonPrimitive(hostId))), !hasLocation, true,
      )
    } + HardwareBuyerOption(
      "$uid:$orgId:", "$who · $name · choose the store at setup", plan,
      JsonObject(mapOf("uid" to JsonPrimitive(uid), "orgId" to JsonPrimitive(orgId))), needsAddress = false, storeChosen = false,
    )
  }
  val options = mutableListOf<HardwareBuyerOption>()
  for (person in found.list("people")) {
    val uid = person.text("uid").orEmpty()
    val who = "${person.text("name")?.ifEmpty { null } ?: "No name"} (${person.text("email").orEmpty()})"
    val workspaces = person.list("workspaces")
    if (workspaces.isEmpty()) {
      options += HardwareBuyerOption("$uid::", "$who · no workspace yet", "It joins the workspace they create.", JsonObject(mapOf("uid" to JsonPrimitive(uid))), needsAddress = false, storeChosen = false)
    }
    workspaces.forEach { options += workspaceOptions(uid, it, who) }
  }
  for (workspace in found.list("workspaces")) {
    val owner = workspace.field("owner") as? JsonObject ?: continue
    val uid = owner.text("uid") ?: continue
    val who = "${owner.text("name")?.ifEmpty { null } ?: "Owner"} (${owner.text("email").orEmpty()})"
    workspaceOptions(uid, workspace, who).forEach { option -> if (options.none { it.id == option.id }) options += option }
  }
  return options
}

/** The open sale's card reader part, in the checkout: attach the buyer, the terms of sale, the readers. */
@Composable
fun PosHardwareSaleSection(sales: PosHardwareSales, saleOrderId: String, productIds: List<String>) {
  var sells by remember(saleOrderId) { mutableStateOf(false) }
  var attaching by remember { mutableStateOf(false) }
  var attached by remember(saleOrderId) { mutableStateOf<Triple<String, Boolean, Boolean>?>(null) }
  var notice by remember { mutableStateOf<Pair<String, StatusTone>?>(null) }
  LaunchedEffect(saleOrderId) {
    sales.check()
    if (!sales.seller) return@LaunchedEffect
    val hostId = sales.context.hostId ?: return@LaunchedEffect
    // A sale with a product that names a hardware SKU.
    sells = productIds.toSet().any { id ->
      (runCatching { sales.context.firestore.get("hosts/$hostId/products/$id") }.getOrNull()?.data?.get("hardwareSku") as? String).orEmpty().isNotEmpty()
    }
  }
  if (!sales.seller || !sells) return
  SectionCard("Card reader", Modifier.fillMaxWidth().testTag("pos-hardware-sale")) {
    Column(verticalArrangement = Arrangement.spacedBy(space(1.5f))) {
      notice?.let { (text, tone) -> NoticeBanner(text, tone) }
      Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1f))) {
        Text(
          attached?.first ?: "This sale has a card reader. Attach it to the buyer’s workspace.",
          Modifier.weight(1f),
          style = MaterialTheme.typography.bodyMedium,
          color = if (attached == null) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.primary,
        )
        OutlinedButton(onClick = { attaching = true }, modifier = Modifier.testTag("pos-hardware-attach-buyer")) { Text(if (attached == null) "Attach buyer" else "Change") }
      }
      // The terms of sale, accepted before paying (Terms 4.28).
      PosHardwareTermsRow(sales, saleOrderId) { notice = it }
      PosHardwareReadersRow(sales.api, saleOrderId, attached?.second == true, attached?.third == true) { notice = it }
    }
  }
  if (attaching) {
    PosHardwareAttachPanel(sales.api, mapOf("registerOrderId" to JsonPrimitive(saleOrderId)), null, onDismiss = { attaching = false }) { message, storeChosen, needsAddress ->
      // The row says it; no banner repeats it.
      attached = Triple(message, storeChosen, needsAddress)
      notice = null
      attaching = false
    }
  }
}

@Composable
private fun PosHardwareTermsRow(sales: PosHardwareSales, saleOrderId: String, notify: (Pair<String, StatusTone>) -> Unit) {
  val scope = rememberCoroutineScope()
  val uri = LocalUriHandler.current
  val display = CustomerDisplayHosts.current
  var acceptance by remember(saleOrderId) { mutableStateOf<Pair<String, Double>?>(null) }
  var waiting by remember(saleOrderId) { mutableStateOf(false) }
  var tablet by remember { mutableStateOf<Triple<String, String, List<String>>?>(null) }
  var busy by remember { mutableStateOf(false) }

  suspend fun refresh(): String? {
    val held = runCatching { sales.api.call("terms-status", mapOf("registerOrderId" to JsonPrimitive(saleOrderId))) }.getOrNull().field("acceptance")
    val method = held.text("method") ?: return null
    acceptance = method to (held.number("atMs") ?: 0.0)
    return method
  }
  LaunchedEffect(saleOrderId) { refresh() }
  LaunchedEffect(waiting) {
    // Waiting on the display: asked until the buyer accepts there.
    while (waiting) {
      delay(POS_HARDWARE_TERMS_POLL_MS)
      val held = refresh()
      if (held != null && held != "notice") {
        waiting = false
        notify("The buyer accepted the terms of sale on the display." to StatusTone.SUCCESS)
      }
    }
  }

  val accepted = acceptance?.takeIf { it.first != "notice" }
  Column(verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
    if (accepted != null) {
      val how = mapOf("tablet" to "on this tablet", "display" to "on the customer display", "notice" to "by the receipt and booth sign")[accepted.first].orEmpty()
      Text(
        "Terms of sale accepted $how at ${com.aglyn.contracts.formatLocalDay(accepted.second.toLong(), "h:mm a")}.",
        Modifier.testTag("pos-hardware-terms-accepted"), color = MaterialTheme.colorScheme.primary,
      )
    } else {
      Text(
        if (waiting) "Waiting for the buyer to accept the terms of sale on the display…"
        else "Before the buyer pays, have them accept the terms of sale. If no screen can be used, the receipt and the booth sign state the terms, and paying is agreeing.",
        style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
      FlowRow(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
        if (display != null) {
          if (waiting) {
            TextButton(onClick = { waiting = false; scope.launch { display.close("commerce") } }) { Text("Take off display") }
          } else {
            TextButton(
              onClick = {
                busy = true
                scope.launch {
                  try {
                    sales.api.call("terms-on-display", mapOf("registerOrderId" to JsonPrimitive(saleOrderId)))
                    if (!display.show(CustomerDisplayScreen("commerce", POS_HARDWARE_TERMS_SCREEN_PATH, mapOf("order" to saleOrderId)))) error("not shown")
                    waiting = true
                  } catch (failure: Throwable) {
                    if (failure is kotlinx.coroutines.CancellationException) throw failure
                    notify(refusal(failure, "The terms could not be shown on the display. Hand them this tablet instead.") to StatusTone.WARNING)
                  } finally {
                    busy = false
                  }
                }
              },
              enabled = !busy,
              modifier = Modifier.testTag("pos-hardware-terms-display"),
            ) { Text("Show on display") }
          }
        }
        TextButton(
          onClick = {
            busy = true
            scope.launch {
              try {
                val view = sales.api.call("terms")
                tablet = Triple(view.text("sections").orEmpty(), view.text("url").orEmpty(), view.list("summary").mapNotNull { (it as? JsonPrimitive)?.contentOrNull })
              } catch (failure: Throwable) {
                if (failure is kotlinx.coroutines.CancellationException) throw failure
                notify(refusal(failure, "The terms could not be shown.") to StatusTone.WARNING)
              } finally {
                busy = false
              }
            }
          },
          enabled = !busy,
          modifier = Modifier.testTag("pos-hardware-terms-tablet"),
        ) { Text("Accept on this tablet") }
      }
    }
    TextButton(onClick = { uri.openUri(sales.context.api.origin.trimEnd('/') + POS_HARDWARE_TERMS_SIGN_PATH) }) { Text("Print the booth sign") }
  }

  tablet?.let { (sections, url, summary) ->
    var agreed by remember { mutableStateOf(false) }
    var sending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    FormSheet(
      title = "Terms of sale for your card reader hardware",
      busy = sending,
      error = error,
      onDismiss = { tablet = null },
      onConfirm = {
        sending = true
        error = null
        scope.launch {
          try {
            val held = sales.api.call("accept-terms", mapOf("registerOrderId" to JsonPrimitive(saleOrderId))).field("acceptance")
            held.text("method")?.let { acceptance = it to (held.number("atMs") ?: 0.0) }
            tablet = null
            notify("The buyer accepted the terms of sale." to StatusTone.SUCCESS)
          } catch (failure: Throwable) {
            if (failure is kotlinx.coroutines.CancellationException) throw failure
            error = refusal(failure, "The acceptance did not go through. Try again.")
          } finally {
            sending = false
          }
        }
      },
      confirmLabel = "Accept",
      confirmEnabled = agreed && !sending,
      workingLabel = "Accepting…",
    ) {
      Column(verticalArrangement = Arrangement.spacedBy(space(1f))) {
        Text("Hand this tablet to the buyer. This purchase is made under our Terms, Sections $sections. In short:")
        summary.forEach { Text("•  $it", style = MaterialTheme.typography.bodyMedium) }
        TextButton(onClick = { uri.openUri(url) }) { Text(url.removePrefix("https://").removePrefix("http://")) }
        Row(Modifier.fillMaxWidth().clickable { agreed = !agreed }, verticalAlignment = Alignment.CenterVertically) {
          Checkbox(agreed, { agreed = it }, Modifier.testTag("pos-hardware-terms-agree"))
          Text("I have read the terms of sale (Sections $sections) and accept them for this purchase.")
        }
      }
    }
  }
}

@Composable
private fun PosHardwareReadersRow(api: PosHardwareSaleApi, saleOrderId: String, storeChosen: Boolean, needsAddress: Boolean, notify: (Pair<String, StatusTone>) -> Unit) {
  val scope = rememberCoroutineScope()
  var serials by remember(saleOrderId) { mutableStateOf("") }
  var code by remember(saleOrderId) { mutableStateOf("") }
  var busy by remember { mutableStateOf(false) }
  var attemptKey by remember { mutableStateOf(newHardwareKey()) }
  var askAddress by remember(needsAddress) { mutableStateOf(needsAddress) }
  var line1 by remember { mutableStateOf("") }
  var city by remember { mutableStateOf("") }
  var state by remember { mutableStateOf("") }
  var postalCode by remember { mutableStateOf("") }
  var country by remember { mutableStateOf("US") }
  val list = serials.split(Regex("[\\s,;]+")).map { it.trim() }.filter { it.isNotEmpty() }
  val addressComplete = line1.isNotBlank() && city.isNotBlank() && postalCode.isNotBlank() && Regex("^[A-Z]{2}$").matches(country)

  Column(verticalArrangement = Arrangement.spacedBy(space(1f))) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1f))) {
      OutlinedTextField(
        serials, { serials = it }, label = { Text("Reader serial numbers") }, singleLine = true,
        supportingText = { Text("Scan or type each reader's serial. It sets itself up when the buyer adds it.") },
        modifier = Modifier.weight(1f).testTag("pos-hardware-serials"),
      )
      TextButton(
        onClick = {
          busy = true
          scope.launch {
            try {
              api.call("serials", mapOf("registerOrderId" to JsonPrimitive(saleOrderId), "serials" to JsonArray(list.map(::JsonPrimitive))))
              notify((if (list.size == 1) "Serial number saved" else "Serial numbers saved") to StatusTone.SUCCESS)
            } catch (failure: Throwable) {
              if (failure is kotlinx.coroutines.CancellationException) throw failure
              notify(refusal(failure, "That did not work. Try again.") to StatusTone.WARNING)
            } finally {
              busy = false
            }
          }
        },
        enabled = !busy && list.isNotEmpty(),
        modifier = Modifier.testTag("pos-hardware-serials-save"),
      ) { Text("Save") }
    }
    if (storeChosen && askAddress) {
      Text(
        "Their store has no address for card readers yet. Enter it with the buyer to register the reader now: the reader is set up for this country. Or leave it, and they add it on their POS devices card.",
        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
      OutlinedTextField(line1, { line1 = it }, label = { Text("Street") }, singleLine = true, modifier = Modifier.fillMaxWidth())
      Row(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
        OutlinedTextField(city, { city = it }, label = { Text("City") }, singleLine = true, modifier = Modifier.weight(1f))
        OutlinedTextField(state, { state = it }, label = { Text("State") }, singleLine = true, modifier = Modifier.weight(1f))
      }
      Row(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
        OutlinedTextField(postalCode, { postalCode = it }, label = { Text("Postal code") }, singleLine = true, modifier = Modifier.weight(1f))
        OutlinedTextField(
          country, { country = it.uppercase().take(2) }, label = { Text("Country") }, singleLine = true,
          supportingText = { Text("Two letters, like US") }, modifier = Modifier.weight(1f),
        )
      }
    }
    if (storeChosen) {
      Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1f))) {
        OutlinedTextField(
          code, { code = it }, label = { Text("Code on the reader") }, singleLine = true,
          supportingText = { Text("Register it to the buyer's store now, while they are here.") },
          modifier = Modifier.weight(1f),
        )
        TextButton(
          onClick = {
            busy = true
            scope.launch {
              val fields = buildMap<String, JsonElement> {
                put("registerOrderId", JsonPrimitive(saleOrderId))
                put("registrationCode", JsonPrimitive(code.trim()))
                if (askAddress) {
                  put("address", JsonObject(mapOf("line1" to line1, "city" to city, "state" to state, "postalCode" to postalCode, "country" to country).mapValues { JsonPrimitive(it.value) }))
                }
              }
              try {
                val saved = api.call("register-at-booth", fields, attemptKey).flag("storeAddressSaved")
                code = ""
                attemptKey = newHardwareKey()
                if (saved) askAddress = false
                notify((if (saved) "Reader registered to their store, and the store’s address saved" else "Reader registered to their store") to StatusTone.SUCCESS)
              } catch (failure: Throwable) {
                if (failure is kotlinx.coroutines.CancellationException) throw failure
                if (reason(failure) == "needs-address") {
                  askAddress = true
                  // A new attempt: the request with the address is a different one.
                  attemptKey = newHardwareKey()
                }
                notify(refusal(failure, "That did not work. Try again.") to StatusTone.WARNING)
              } finally {
                busy = false
              }
            }
          },
          enabled = !busy && code.trim().length >= 3 && !(askAddress && !addressComplete),
        ) { Text("Register") }
      }
    }
  }
}

/** Finding the buyer and saying whose the card reader is: by an exact email, a person's name or a workspace's name. */
@Composable
fun PosHardwareAttachPanel(
  api: PosHardwareSaleApi,
  target: Map<String, JsonElement>,
  summary: String?,
  onDismiss: () -> Unit,
  onAttached: (message: String, storeChosen: Boolean, needsAddress: Boolean) -> Unit,
) {
  val scope = rememberCoroutineScope()
  var query by remember { mutableStateOf("") }
  var searched by remember { mutableStateOf("") }
  var found by remember { mutableStateOf<JsonElement?>(null) }
  var chosen by remember { mutableStateOf<String?>(null) }
  var busy by remember { mutableStateOf(false) }
  var error by remember { mutableStateOf<String?>(null) }
  val attemptKey = remember { newHardwareKey() }
  val options = found?.let(::hardwareBuyerOptions).orEmpty()

  fun search() {
    val text = query.trim()
    if (text.length < 2) return
    busy = true
    error = null
    scope.launch {
      try {
        found = api.call("find", mapOf("query" to JsonPrimitive(text)))
        searched = text
        chosen = null
      } catch (failure: Throwable) {
        if (failure is kotlinx.coroutines.CancellationException) throw failure
        error = refusal(failure, "The lookup did not answer")
      } finally {
        busy = false
      }
    }
  }

  fun attach(choice: JsonObject, storeChosen: Boolean, needsAddress: Boolean) {
    busy = true
    error = null
    scope.launch {
      try {
        val outcome = api.call("attach", target + ("buyer" to choice), attemptKey).text("outcome")
        onAttached(
          when {
            outcome == "waiting" -> "Buyer attached. The card reader joins their workspace as soon as the sale is paid."
            outcome == "attached" -> "Card reader attached to the buyer’s workspace."
            choice.containsKey("email") -> "Invitation sent. The card reader joins their workspace when they sign up."
            else -> "Attached to their account. It joins the workspace they create."
          },
          storeChosen, needsAddress,
        )
      } catch (failure: Throwable) {
        if (failure is kotlinx.coroutines.CancellationException) throw failure
        error = refusal(failure, "The card reader could not be attached")
      } finally {
        busy = false
      }
    }
  }

  PanelSheet(
    title = "Who is the card reader for?",
    onDismiss = onDismiss,
    modifier = Modifier.testTag("pos-hardware-attach-panel"),
    closeLabel = "Cancel",
    action = {
      androidx.compose.material3.Button(
        onClick = { options.firstOrNull { it.id == chosen }?.let { attach(it.choice, it.storeChosen, it.needsAddress) } },
        enabled = !busy && chosen != null,
        modifier = Modifier.testTag("pos-hardware-attach"),
      ) { Text("Attach") }
    },
  ) {
    Column(verticalArrangement = Arrangement.spacedBy(space(1.5f))) {
      summary?.let { Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant) }
      Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1f))) {
        OutlinedTextField(query, { query = it }, label = { Text("Email, name or workspace") }, singleLine = true, modifier = Modifier.weight(1f).testTag("pos-hardware-buyer-query"))
        OutlinedButton(onClick = ::search, enabled = !busy && query.trim().length >= 2) { Text("Search") }
      }
      if (found.flag("noAccount")) {
        NoticeBanner(
          "No account uses $searched. Sell anyway: we email them an invitation, and the card reader joins their workspace when they sign up.",
          StatusTone.INFO,
          action = { TextButton(onClick = { attach(JsonObject(mapOf("email" to JsonPrimitive(searched))), false, false) }, enabled = !busy) { Text("Invite them") } },
        )
      } else if (found != null && found !is JsonNull && options.isEmpty()) {
        Text("Nobody matches. Try their exact email address.", color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
      Column(Modifier.fillMaxWidth()) {
        options.forEach { option ->
          Row(
            Modifier.fillMaxWidth().clickable { chosen = option.id }.padding(vertical = space(0.5f)).testTag("pos-hardware-buyer-${option.id}"),
            verticalAlignment = Alignment.CenterVertically,
          ) {
            RadioButton(chosen == option.id, { chosen = option.id })
            Column {
              Text(option.label, style = MaterialTheme.typography.bodyMedium)
              option.detail?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            }
          }
        }
      }
      Text("Every lookup is recorded. Ask the buyer before you search for them.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
      error?.let { NoticeBanner(it, StatusTone.WARNING) }
    }
  }
}

/** The To attach list: card readers sold here that nobody has said whose they are yet, newest first. */
@Composable
fun PosHardwareToAttachPanel(api: PosHardwareSaleApi, onDismiss: () -> Unit) {
  var rows by remember { mutableStateOf<List<HardwareToAttachRow>?>(null) }
  var error by remember { mutableStateOf<String?>(null) }
  var picked by remember { mutableStateOf<HardwareToAttachRow?>(null) }
  var notice by remember { mutableStateOf<String?>(null) }
  var reloads by remember { mutableStateOf(0) }
  LaunchedEffect(reloads) {
    rows = try {
      api.call("pending").list("orders").mapNotNull(HardwareToAttachRow::from)
    } catch (failure: Throwable) {
      if (failure is kotlinx.coroutines.CancellationException) throw failure
      error = refusal(failure, "The list could not be read")
      emptyList()
    }
  }
  PanelSheet(title = "Card reader sales to attach", onDismiss = onDismiss, modifier = Modifier.testTag("pos-hardware-to-attach")) {
    Column(verticalArrangement = Arrangement.spacedBy(space(1f))) {
      notice?.let { NoticeBanner(it, StatusTone.SUCCESS) }
      error?.let { NoticeBanner(it, StatusTone.WARNING) }
      val shown = rows
      when {
        shown == null -> Text("Reading the card reader sales…", color = MaterialTheme.colorScheme.onSurfaceVariant)
        shown.isEmpty() -> Text("Every card reader sold here is attached to its buyer.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        else -> shown.forEachIndexed { index, row ->
          if (index > 0) HorizontalDivider()
          Row(Modifier.fillMaxWidth().padding(vertical = space(1f)), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
              Text(row.linesLabel, style = MaterialTheme.typography.bodyMedium)
              Text(row.detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            TextButton(onClick = { picked = row }) { Text("Attach") }
          }
        }
      }
    }
  }
  picked?.let { row ->
    PosHardwareAttachPanel(api, mapOf("orderId" to JsonPrimitive(row.id)), row.linesLabel, onDismiss = { picked = null }) { message, _, _ ->
      picked = null
      notice = message
      reloads += 1
    }
  }
}
