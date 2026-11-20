package com.aglyn.site.sitecare

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.OutlinedButton
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
import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.ConsoleApiError
import com.aglyn.core.jsonValue
import com.aglyn.ui.ActionDialog
import com.aglyn.ui.CountedTextField
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.StatusTone
import com.aglyn.ui.TextButton
import com.aglyn.ui.WithTooltip
import com.aglyn.ui.space
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull

/*
 * Site Care's "Request a change" on a site's Home (the console's SiteCareRequestButton, AGL-3959): a workspace with Site
 * Care tells the team what to change in its own words and is told when it will be done; one without it sees the button
 * off with the reason, beside Add Site Care. Routes: /api/site-care/requests (`view=status`, and the POST). The Apple site
 * lib's SiteCare.swift.
 */

/** Why Request a change is off on a workspace without Site Care (`SITE_CARE_MISSING_REASON`). */
const val SITE_CARE_MISSING_REASON = "Site Care is not on this workspace. With it, our team makes your site changes for you."

/** The longest subject and details the console's fields take. */
const val SITE_CARE_SUBJECT_MAX = 150
const val SITE_CARE_DETAILS_MAX = 5000

/** What the sheet says once the request is in, with the date the route answered (the console's words). */
fun siteCareSentText(dueAt: String): String =
  "We have your request and will have it done by ${dueAt.ifEmpty { "two business days from now" }}. We will email you when it is done."

/** The Site Care requests route for one workspace. */
class SiteCareApi(private val api: ConsoleApiClient, private val orgId: String) {
  /** Whether the workspace has Site Care; null when the route could not say. */
  suspend fun hasSiteCare(): Boolean? = runCatching {
    val answer = api.request("/api/site-care/requests", query = mapOf("orgId" to orgId, "view" to "status")) as? JsonObject
    (answer?.get("siteCare") as? JsonPrimitive)?.booleanOrNull == true
  }.getOrNull()

  /** Sends the request and answers the date it will be done by (empty when the route did not say). */
  suspend fun request(hostId: String?, subject: String, body: String): String {
    val answer = api.request(
      "/api/site-care/requests", ApiMethod.POST,
      jsonValue(mapOf("orgId" to orgId, "hostId" to hostId, "subject" to subject, "body" to body)),
    ) as? JsonObject
    return (answer?.get("dueAt") as? JsonPrimitive)?.takeIf { it.isString }?.content.orEmpty()
  }
}

/** Request a change, with the dialog it opens. Draws nothing until the route has said whether the workspace has Site Care. */
@Composable
fun SiteCareRequestButton(api: ConsoleApiClient, orgId: String, hostId: String?, onAddSiteCare: () -> Unit, modifier: Modifier = Modifier) {
  val care = remember(api, orgId) { SiteCareApi(api, orgId) }
  var siteCare by remember(orgId) { mutableStateOf<Boolean?>(null) }
  var open by remember { mutableStateOf(false) }
  LaunchedEffect(orgId) { siteCare = care.hasSiteCare() }
  val has = siteCare ?: return
  Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1f))) {
    if (has) {
      OutlinedButton(onClick = { open = true }, modifier = Modifier.testTag("site-care-request")) { Text("Request a change") }
    } else {
      WithTooltip(SITE_CARE_MISSING_REASON) {
        OutlinedButton(onClick = {}, enabled = false, modifier = Modifier.testTag("site-care-request")) { Text("Request a change") }
      }
      // A store build takes no payment to Aglyn (the owner's decision of 2026-11-19): the store line, not Add Site Care.
      if (com.aglyn.core.StoreBilling.buying) {
        TextButton(onClick = onAddSiteCare, modifier = Modifier.testTag("site-care-add")) { Text("Add Site Care") }
      } else {
        com.aglyn.ui.StoreBillingLine()
      }
    }
  }
  if (open) SiteCareRequestDialog(care, hostId) { open = false }
}

/** The request: what should change, and the details, sent to the team; then when it will be done. */
@Composable
private fun SiteCareRequestDialog(care: SiteCareApi, hostId: String?, close: () -> Unit) {
  var subject by remember { mutableStateOf("") }
  var details by remember { mutableStateOf("") }
  var busy by remember { mutableStateOf(false) }
  var error by remember { mutableStateOf<String?>(null) }
  var sent by remember { mutableStateOf<String?>(null) }
  val scope = rememberCoroutineScope()
  val done = sent
  if (done != null) {
    ActionDialog("Request a change", "Done", onConfirm = close, onDismiss = close, dismissLabel = "Close") {
      NoticeBanner(siteCareSentText(done), StatusTone.SUCCESS, Modifier.testTag("site-care-sent"))
    }
    return
  }
  ActionDialog(
    "Request a change",
    "Send request",
    onConfirm = {
      busy = true
      error = null
      scope.launch {
        try {
          sent = care.request(hostId, subject, details)
        } catch (refusal: ConsoleApiError) {
          error = refusal.message.ifBlank { "The request could not be sent" }
        } catch (cancel: kotlinx.coroutines.CancellationException) {
          throw cancel
        } catch (failure: Exception) {
          error = "An error has occurred"
        } finally {
          busy = false
        }
      }
    },
    onDismiss = close,
    body = "Tell us what to change, in your own words. Small changes to what your site already has are part of Site Care.",
    busy = busy,
    error = error,
    confirmEnabled = subject.isNotBlank() && details.isNotBlank(),
  ) {
    CountedTextField("What should change?", subject, { subject = it }, max = SITE_CARE_SUBJECT_MAX, required = true, placeholder = "Update our holiday hours")
    CountedTextField(
      "Details", details, { details = it }, max = SITE_CARE_DETAILS_MAX, required = true, multiline = true, minLines = 5,
      placeholder = "Saturday becomes 9 to 2 for December, and add a note that we are closed on the 25th.",
    )
  }
}
