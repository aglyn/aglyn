package com.aglyn.plugins.waivers

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.layout.size
import com.aglyn.contracts.checkInDayKeyMillis
import com.aglyn.contracts.checkInDayKeyOfMillis
import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiError
import com.aglyn.core.siteAddress
import com.aglyn.pluginhost.CustomerDisplayHosts
import com.aglyn.pluginhost.CustomerDisplayScreen
import com.aglyn.pluginhost.LocalSlotProps
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.ui.DateField
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.PanelSheet
import com.aglyn.ui.StatusChip
import com.aglyn.ui.StatusTone
import com.aglyn.ui.TextButton
import com.aglyn.ui.space
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull

/*
 * A RIDER'S WAIVER AT CHECK-IN (AGL-4042), as the console's WaiverCheckInStatus draws it in commerce's `posCheckIn`
 * zone: "Waiver signed", "Signed for 2 of 3 riders" or "Waiver needed", matched by email first and, when the email
 * matches nothing, by the name and birth date the site's CRM record of the customer keeps (`contactId`). A rider with no
 * email match and no birth date on file reads "Waiver not matched", and Find by name asks for a date of birth. Sign
 * waiver opens the store's own signing page for the rider, and Check again reads the status once more. Draws nothing for
 * a member who may not see signatures (the route refuses them). The zone hands what the console's does, as
 * `LocalSlotProps`; this plugin never imports commerce. The Apple kit's WaiverCheckIn.swift.
 */

const val WAIVERS_CHECK_IN_SLOT = "posCheckIn"
const val WAIVERS_CHECK_IN_WIDGET = "waivers.check-in-status"
internal const val WAIVERS_STATUS_ROUTE = "/api/waivers/status"

/** The store's own signing page, at `/{path}` on its site (`WAIVERS_SITE_SIGN_PATH`). */
internal const val WAIVERS_SITE_SIGN_PATH = "sign-waiver"

/** The waivers plugin's public page a paired customer display signs on (`WAIVERS_DISPLAY_PAGE_PATH`). */
internal const val WAIVERS_DISPLAY_PAGE_PATH = "/display-sign"
internal const val WAIVERS_PLUGIN_ID = "waivers"

/** The status route's answer. */
data class WaiverStatusAnswer(val signed: Boolean, val label: String, val matched: Boolean? = null, val searchName: String? = null) {
  companion object {
    fun from(element: JsonElement?): WaiverStatusAnswer? {
      val json = element as? JsonObject ?: return null
      fun text(key: String) = (json[key] as? JsonPrimitive)?.contentOrNull
      fun flag(key: String) = (json[key] as? JsonPrimitive)?.booleanOrNull
      val label = text("label") ?: return null
      return WaiverStatusAnswer(flag("signed") == true, label, flag("matched"), text("searchName"))
    }
  }
}

/** What the row shows for an answer (null: the route answered nothing usable). */
data class WaiverStatusLook(val label: String, val signedInFull: Boolean, val needed: Boolean, val notMatched: Boolean) {
  companion object {
    fun of(status: WaiverStatusAnswer?): WaiverStatusLook {
      val label = status?.label ?: "Waiver not on file"
      val full = status?.signed == true && label == "Waiver signed"
      return WaiverStatusLook(label, full, !full, status?.matched == false && !status.searchName.isNullOrEmpty())
    }
  }
}

/** The status query the console's widget sends: email, the CRM contact, the name, and the people due when more than one. */
fun waiverStatusQuery(hostId: String, dayKey: String, email: String?, contactId: String?, name: String?, unitsDue: Int?): Map<String, String> =
  buildMap {
    put("hostId", hostId)
    put("dayKey", dayKey)
    email?.trim()?.ifEmpty { null }?.let { put("email", it) }
    contactId?.trim()?.ifEmpty { null }?.let { put("contactId", it) }
    name?.trim()?.ifEmpty { null }?.let { put("name", it) }
    if ((unitsDue ?: 0) > 1) put("people", unitsDue.toString())
  }

private sealed interface LoadState {
  data object Loading : LoadState
  data object Hidden : LoadState
  data class Ready(val status: WaiverStatusAnswer?) : LoadState
}

/** The widget in the `posCheckIn` zone. */
@Composable
fun WaiverCheckInStatus(context: NativePluginContext) {
  val props = LocalSlotProps.current
  val hostId = props["hostId"] ?: context.hostId.orEmpty()
  val dayKey = props["dayKey"].orEmpty()
  val email = props["email"]
  val contactId = props["contactId"]
  val name = props["name"]?.trim().orEmpty()
  val compact = props["placement"] == "check-in-row"
  val uri = LocalUriHandler.current
  val scope = rememberCoroutineScope()
  var state by remember { mutableStateOf<LoadState>(LoadState.Loading) }
  var revision by remember { mutableStateOf(0) }
  var opened by remember { mutableStateOf(false) }
  var findingByName by remember { mutableStateOf(false) }
  var notice by remember { mutableStateOf<String?>(null) }
  // Sent to the customer display from this row, until the status reads signed.
  var sent by remember { mutableStateOf(false) }
  var displayError by remember { mutableStateOf<String?>(null) }
  val display = CustomerDisplayHosts.current

  LaunchedEffect(hostId, dayKey, email, contactId, name, revision) {
    if (hostId.isEmpty() || dayKey.isEmpty()) return@LaunchedEffect
    if (email.isNullOrEmpty() && contactId.isNullOrEmpty() && name.isEmpty()) {
      state = LoadState.Ready(null)
      return@LaunchedEffect
    }
    state = try {
      val query = waiverStatusQuery(hostId, dayKey, email, contactId, name, props["unitsDue"]?.toIntOrNull())
      LoadState.Ready(WaiverStatusAnswer.from(context.api.request(WAIVERS_STATUS_ROUTE, ApiMethod.GET, query = query)))
    } catch (failure: Throwable) {
      if (failure is kotlinx.coroutines.CancellationException) throw failure
      // Not this member's to see, or no plan with waivers: say nothing.
      val status = (failure as? ConsoleApiError)?.status
      if (status == 403 || status == 404) LoadState.Hidden else LoadState.Ready(null)
    }
  }

  /** The store's own signing page, on its custom domain else its platform address, for the rider to sign on this device. */
  fun openSigning() {
    notice = null
    scope.launch {
      val host = runCatching { context.firestore.get("hosts/$hostId") }.getOrNull()?.data.orEmpty()
      val domain = (host["cname"] as? String)?.trim()?.ifEmpty { null } ?: siteAddress(host["subdomain"] as? String)
      if (domain == null) {
        notice = "This site has no address to sign on yet."
      } else {
        opened = true
        uri.openUri("https://$domain/$WAIVERS_SITE_SIGN_PATH")
      }
    }
  }

  when (val current = state) {
    LoadState.Hidden -> Unit
    LoadState.Loading -> CircularProgressIndicator(Modifier.size(16.dp).testTag("waiver-loading"), strokeWidth = 2.dp)
    is LoadState.Ready -> Column(verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
      val look = WaiverStatusLook.of(current.status)
      FlowRow(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalArrangement = Arrangement.Center) {
        StatusChip(look.label, if (look.signedInFull) StatusTone.SUCCESS else StatusTone.WARNING, Modifier.align(Alignment.CenterVertically).testTag("waiver-status"))
        if (look.notMatched) TextButton(onClick = { findingByName = true }, modifier = Modifier.testTag("waiver-find-by-name")) { Text("Find by name") }
        if (look.needed) TextButton(onClick = ::openSigning, modifier = Modifier.testTag("waiver-sign")) { Text(if (compact) "Sign" else "Sign waiver") }
        if (display != null && look.needed) {
          TextButton(
            onClick = {
              displayError = null
              scope.launch {
                // The display's own pairing is what lets it sign, so nothing is minted for it here; the site is the screen's one parameter.
                if (display.show(CustomerDisplayScreen(WAIVERS_PLUGIN_ID, WAIVERS_DISPLAY_PAGE_PATH, mapOf("host" to hostId)))) {
                  sent = true
                } else {
                  displayError = "The customer display didn’t answer. Check that it is on, or hand over this device."
                }
              }
            },
            modifier = Modifier.testTag("waiver-customer-display"),
          ) { Text("Customer display") }
        }
        if ((opened || sent) && look.needed) TextButton(onClick = { revision += 1 }, modifier = Modifier.testTag("waiver-check-again")) { Text("Check again") }
      }
      if (sent && look.needed) StatusChip("Sent to the customer display", modifier = Modifier.testTag("waiver-sent-to-display"))
      displayError?.let { NoticeBanner(it, StatusTone.WARNING) }
      notice?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
      val searchName = current.status?.searchName
      if (findingByName && searchName != null) {
        WaiverNameCheckPanel(context, hostId, dayKey, searchName) {
          findingByName = false
          revision += 1
        }
      }
    }
  }
}

/** Find a rider's waiver by name and date of birth (the console's WaiverNameCheckDialog). */
@Composable
fun WaiverNameCheckPanel(context: NativePluginContext, hostId: String, dayKey: String, initialName: String, onClose: () -> Unit) {
  val scope = rememberCoroutineScope()
  var name by remember { mutableStateOf(initialName) }
  var dateOfBirth by remember { mutableStateOf("") }
  var answer by remember { mutableStateOf<WaiverStatusAnswer?>(null) }
  var busy by remember { mutableStateOf(false) }
  var error by remember { mutableStateOf<String?>(null) }
  PanelSheet(title = "Find a waiver by name", onDismiss = onClose, modifier = Modifier.testTag("waiver-name-check")) {
    Column(verticalArrangement = Arrangement.spacedBy(space(1.5f))) {
      Text(
        "Ask the rider’s date of birth to match their name and birth date with a signed waiver, theirs or one a parent signed for them.",
        style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
      OutlinedTextField(name, { name = it }, label = { Text("Full name") }, singleLine = true, modifier = Modifier.fillMaxWidth().testTag("waiver-name"))
      DateField(
        "Date of birth", dateOfBirth, { dateOfBirth = it; answer = null },
        toMillis = ::checkInDayKeyMillis, fromMillis = ::checkInDayKeyOfMillis,
        modifier = Modifier.fillMaxWidth().testTag("waiver-dob"),
      )
      Button(
        onClick = {
          busy = true
          error = null
          answer = null
          scope.launch {
            try {
              val json = context.api.request(
                WAIVERS_STATUS_ROUTE, ApiMethod.GET,
                query = mapOf("hostId" to hostId, "dayKey" to dayKey, "name" to name.trim(), "dateOfBirth" to dateOfBirth),
              )
              answer = WaiverStatusAnswer.from(json)
              if (answer == null) error = "The waiver could not be checked."
            } catch (failure: Throwable) {
              if (failure is kotlinx.coroutines.CancellationException) throw failure
              error = (((failure as? ConsoleApiError)?.body as? JsonObject)?.get("error") as? JsonPrimitive)?.contentOrNull ?: "The waiver could not be checked."
            } finally {
              busy = false
            }
          }
        },
        enabled = !busy && name.isNotBlank() && dateOfBirth.isNotEmpty() && dateOfBirth <= dayKey,
        modifier = Modifier.testTag("waiver-check"),
      ) { Text("Check") }
      answer?.let {
        StatusChip(
          if (it.matched == true) it.label else "No signed waiver for that name and date of birth",
          if (it.signed) StatusTone.SUCCESS else StatusTone.WARNING,
          Modifier.testTag("waiver-check-answer"),
        )
      }
      error?.let { NoticeBanner(it, StatusTone.WARNING) }
    }
  }
}
