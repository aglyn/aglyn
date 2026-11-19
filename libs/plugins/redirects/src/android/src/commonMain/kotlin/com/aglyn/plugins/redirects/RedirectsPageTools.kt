package com.aglyn.plugins.redirects

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.KeyboardType
import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.ConsoleApiError
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.pluginhost.rememberMemberPermissions
import com.aglyn.ui.space
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull

/*
 * THE REDIRECTS PAGE'S OTHER TOOLS, as the console's page has them
 * (`redirects-console-page.tsx`): Import and Export in its head (Import for
 * "Manage data", Export for whoever reads the rules), the plan's cap as a
 * standing readout under the list (`3/25 redirects on your plan`) with Add
 * redirect refused at it in the page's words, and "Test a path", answered by
 * the console's own matcher (`redirects/test`), whose pattern half is the
 * server's engine. The Apple kit's `RedirectsPageTools.swift` is the same contract.
 */

const val REDIRECT_TEST_ROUTE = "/api/redirects/test"

/** The data transfer hub's import screen (core), which the page's Import opens. */
const val CORE_DATA_IMPORT_SCREEN = "core.settings.data.import"

/** The transfer resource the page's Import and Export name (`REDIRECTS_TRANSFER_KEY`). */
const val REDIRECTS_TRANSFER_RESOURCE = "redirects"

/** The export dialog's own title for the resource ("Export <label>"). */
const val REDIRECTS_EXPORT_TITLE = "Export Redirects"

/** The page's Export: every rule of the site (`openExport(target)` names no filter). */
val REDIRECTS_EXPORT_SCOPE: Map<String, Any?> = mapOf("kind" to "all")

/** The import screen's parameters for this site's rules, as the hub's Redirects row names its target. */
fun redirectsImportParams(hostId: String?): Map<String, String> =
  buildMap {
    put("resource", REDIRECTS_TRANSFER_RESOURCE)
    if (hostId != null) put("hostId", hostId)
  }

/** Who sees Import: "Manage data" on the site, as the console offers it only to whom the transfer route takes it from. */
@Composable
fun canImportRedirects(context: NativePluginContext): Boolean =
  context.hostId != null && rememberMemberPermissions(context).can("data.manage")

/**
 * Add redirect's refusal at the cap, in the page's words, once the plan is known; null lets the add through (the route
 * counts again). An unread count counts as none, as the page's does.
 */
fun redirectLimitRefusal(planReady: Boolean, used: Long?, limit: Double?): String? {
  if (!planReady || limit == null || !limit.isFinite() || (used ?: 0L).toDouble() < limit) return null
  return "Redirect limit reached (${limit.toLong()}) — upgrade in Billing"
}

/** `3/25 redirects on your plan`, `∞` for unlimited, and the count with a checking line until both are in (`QuotaReadout`). */
fun redirectQuotaReadout(used: Long, limit: Double?, ready: Boolean): String {
  if (!ready) return "$used ${if (used == 1L) "redirect" else "redirects"} · checking your plan…"
  val cap = limit?.takeIf { it.isFinite() }?.toLong()?.toString() ?: "∞"
  return "$used/$cap redirects on your plan"
}

/** The plan's redirect cap, as `/api/orgs/entitlements` answers it: null is unlimited. */
suspend fun redirectsPerHostLimit(api: ConsoleApiClient, hostId: String): Double? {
  val answer = api.request("/api/orgs/entitlements", ApiMethod.GET, query = mapOf("hostId" to hostId)) as? JsonObject
  return ((answer?.get("quotas") as? JsonObject)?.get("redirectsPerHost") as? JsonPrimitive)?.doubleOrNull
}

/** The tester's request: the site and the path as typed. */
fun redirectTestBody(hostId: String, path: String) = JsonObject(mapOf("hostId" to JsonPrimitive(hostId), "path" to JsonPrimitive(path)))

/** The tester's line from the route's answer: `→ /new-page (301)` or `No rule matches`. */
fun redirectTestText(answer: JsonElement?): String? = ((answer as? JsonObject)?.get("text") as? JsonPrimitive)?.contentOrNull

/** Under the list, as on the page: the plan's readout, then "Test a path". */
@Composable
fun RedirectsPageFooter(context: NativePluginContext, used: Long?, limit: Double?, planReady: Boolean, modifier: Modifier = Modifier) {
  Column(modifier.fillMaxWidth().padding(horizontal = space(2f), vertical = space(1f)), verticalArrangement = Arrangement.spacedBy(space(1f))) {
    Text(
      redirectQuotaReadout(used ?: 0L, limit, planReady && used != null),
      style = MaterialTheme.typography.bodySmall,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
      modifier = Modifier.testTag("redirects-quota"),
    )
    RedirectPathTester(context)
  }
}

/** "Test a path": what the site's rules do with a path as it is typed, by the serve path's own matcher. */
@Composable
fun RedirectPathTester(context: NativePluginContext) {
  val hostId = context.hostId ?: return
  var path by remember(hostId) { mutableStateOf("") }
  var answer by remember(hostId) { mutableStateOf<String?>(null) }
  LaunchedEffect(hostId, path) {
    val typed = path
    if (typed.isBlank()) {
      answer = null
      return@LaunchedEffect
    }
    // Asked once typing pauses; a newer keystroke restarts this.
    delay(300)
    answer = try {
      redirectTestText(context.api.request(REDIRECT_TEST_ROUTE, ApiMethod.POST, redirectTestBody(hostId, typed))) ?: "The path could not be tested"
    } catch (error: CancellationException) {
      throw error
    } catch (error: ConsoleApiError) {
      if (error.status != 0) error.message.ifEmpty { "The path could not be tested" } else "The path could not be tested"
    } catch (_: Throwable) {
      "The path could not be tested"
    }
  }
  Column(verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
    OutlinedTextField(
      path,
      { path = it },
      label = { Text("Test a path") },
      placeholder = { Text("/old-page") },
      singleLine = true,
      keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
      modifier = Modifier.fillMaxWidth().testTag("redirects-test-path"),
    )
    val line = answer
    if (path.isNotBlank() && line != null) {
      Text(line, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.testTag("redirects-test-answer"))
    }
  }
}
