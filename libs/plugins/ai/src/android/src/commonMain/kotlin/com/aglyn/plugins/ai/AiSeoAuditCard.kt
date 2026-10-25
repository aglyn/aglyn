package com.aglyn.plugins.ai

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.aglyn.core.ApiMethod
import com.aglyn.pluginhost.ActionRunner
import com.aglyn.pluginhost.LocalSeoZone
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.OutlinedButton
import com.aglyn.ui.SectionCard
import com.aglyn.ui.StatusTone
import com.aglyn.ui.TextButton
import com.aglyn.ui.space
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.put

/** How often a running audit is read again; the console follows the job's event stream, which the apps poll instead. */
const val AI_SEO_POLL_MILLIS = 2500L

/** Pages of fixes shown before "Show more". */
private const val FIX_ROWS_SHOWN = 10

private fun JsonElement?.text(): String? = (this as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull

/** Whether a job (the jobs route's row) has ended. */
fun aiJobIsTerminal(job: JsonObject?): Boolean = job?.get("status").text() in AI_JOB_TERMINAL_STATUSES

/** The job with [id] among a jobs route's answer. */
fun aiJobById(jobs: JsonElement?, id: String): JsonObject? =
  ((jobs as? JsonObject)?.get("jobs") as? JsonArray).orEmpty().firstOrNull { (it as? JsonObject)?.get("id").text() == id } as? JsonObject

/**
 * SEO fixes, on the site's SEO page under the SEO check (the console's `hostSeo` widget). The check lists what is wrong; this
 * card adds what only a model can: a person asks, and an `seo` job audits the same pages through the same check, proposes a
 * fix per finding, and drafts the structured data and the agent guidance `/llms.txt` leads with. The findings are never listed
 * here, only the fixes, page by page. Nothing it shows is saved: "Put in the form" stages the site-wide proposal in the SEO
 * form below as unsaved edits, and "Apply all as drafts" opens a new unpublished version for each page's content fixes and
 * stages each page's listing for its SEO card.
 */
@Composable
fun AiSeoAuditCard(context: NativePluginContext) {
  val zone = LocalSeoZone.current ?: return
  val hostId = context.hostId ?: return
  val orgId = context.orgId ?: return
  val scope = rememberCoroutineScope()
  val runner = remember(hostId) { ActionRunner(scope, roleHint = "an author, editor or admin") }
  var verdict by remember(hostId) { mutableStateOf("checking") }
  var job by remember(hostId) { mutableStateOf<JsonObject?>(null) }
  var notice by remember(hostId) { mutableStateOf<String?>(null) }
  var busy by remember(hostId) { mutableStateOf(false) }
  var applying by remember(hostId) { mutableStateOf(false) }
  var applied by remember(hostId) { mutableStateOf<AiSeoApplyResult?>(null) }
  var siteStaged by remember(hostId) { mutableStateOf<String?>(null) }
  var previewOpen by remember(hostId) { mutableStateOf(false) }
  var shown by remember(hostId) { mutableStateOf(FIX_ROWS_SHOWN) }
  var watching by remember(hostId) { mutableStateOf<Job?>(null) }
  DisposableEffect(hostId) { onDispose { watching?.cancel() } }

  suspend fun jobs(): JsonElement? = context.api.request("/api/ai/jobs", ApiMethod.GET, query = mapOf("orgId" to orgId, "limit" to AI_RECENT_JOBS_READ))

  /** Follows a job until it settles, reading the jobs route on a short beat. */
  fun watch(id: String) {
    watching?.cancel()
    watching = scope.launch {
      while (true) {
        delay(AI_SEO_POLL_MILLIS)
        val next = try { aiJobById(jobs(), id) } catch (error: Throwable) {
          if (error is kotlinx.coroutines.CancellationException) throw error
          null
        }
        if (next != null) job = next
        if (next != null && aiJobIsTerminal(next)) break
      }
    }
  }

  LaunchedEffect(hostId, orgId) {
    try {
      val latest = aiLatestSeoAudit(jobs(), hostId)?.first
      if (latest != null) {
        job = latest
        if (!aiJobIsTerminal(latest)) watch(latest["id"].text().orEmpty())
      }
      verdict = "ready"
    } catch (error: Throwable) {
      if (error is kotlinx.coroutines.CancellationException) throw error
      // A workspace the jobs route turns away has no SEO fixes to offer, so the card is not drawn at all.
      if (error is com.aglyn.core.ConsoleApiError && (error.status == 403 || error.status == 404)) {
        verdict = "hidden"
      } else {
        notice = "The last SEO audit could not be loaded."
        verdict = "ready"
      }
    }
  }
  if (verdict != "ready") return

  val view = job?.get("outputs")?.let(::aiSeoAuditView)
  val running = job != null && !aiJobIsTerminal(job)
  val keywords = zone.keywords.trim()
  val siteValues = view?.site?.values.orEmpty()
  val siteFields = AI_SEO_SITE_FIELD_LABELS.keys.filter { it in siteValues }
  val jobId = job?.get("id").text()

  fun stageSite() {
    val id = jobId ?: return
    if (siteFields.isEmpty()) return
    zone.proposeDraft(siteValues, "$id:site")
    siteStaged = id
  }

  SectionCard("SEO fixes", Modifier.fillMaxWidth().testTag("ai-seo-audit")) {
    Text(
      if (keywords.isNotEmpty()) {
        "Proposes a fix for each finding of the SEO check above, using the target keywords it was run with. Nothing changes on your live site until you save or publish it."
      } else {
        "Proposes a fix for each finding of the SEO check above. Nothing changes on your live site until you save or publish it."
      },
      style = MaterialTheme.typography.bodySmall,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1f))) {
      Button(
        onClick = {
          busy = true
          notice = null
          applied = null
          siteStaged = null
          shown = FIX_ROWS_SHOWN
          scope.launch {
            try {
              val answer = context.api.request(
                "/api/ai/jobs",
                ApiMethod.POST,
                buildJsonObject {
                  put("orgId", orgId)
                  put("hostId", hostId)
                  put("kind", "seo")
                  put("brief", "Propose fixes for the SEO of this site")
                  put("inputs", buildJsonObject { put("target", "site"); put("keywords", keywords) })
                },
              )
              val started = (answer as? JsonObject)?.get("job") as? JsonObject
              if (started != null) {
                job = started
                if (!aiJobIsTerminal(started)) watch(started["id"].text().orEmpty())
              }
            } catch (error: Throwable) {
              if (error is kotlinx.coroutines.CancellationException) throw error
              notice = runner.describe(error).takeIf { it.isNotBlank() } ?: "The SEO audit could not be started — try again."
            } finally {
              busy = false
            }
          }
        },
        enabled = !busy && !running,
        modifier = Modifier.testTag("ai-seo-propose"),
      ) { Text(if (view != null) "Propose fixes again" else "Propose fixes") }
      if (running) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
      if (running && view != null) {
        Text("Proposing fixes: ${view.batches} of ${view.owedBatches} batches", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
    }
    notice?.let { NoticeBanner(it, StatusTone.WARNING) }
    (job?.get("error").text())?.takeIf { it.isNotBlank() }?.let { NoticeBanner(it, if (job?.get("status").text() == "failed") StatusTone.ERROR else StatusTone.WARNING) }

    if (view != null && job != null) {
      val credits = (job?.get("creditsSpent") as? JsonPrimitive)?.contentOrNull?.toDoubleOrNull()?.toInt() ?: 0
      if (credits > 0) {
        Text("These fixes used $credits ${if (credits == 1) "credit" else "credits"}.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
      view.site?.let { site ->
        HorizontalDivider()
        Text("Structured data and AI agent guidance", style = MaterialTheme.typography.titleSmall)
        if (siteFields.isEmpty()) {
          Text("Nothing to add: the site’s structured data and guidance are already filled in.", style = MaterialTheme.typography.bodyMedium)
        } else {
          siteFields.forEach { field ->
            Column {
              Text(AI_SEO_SITE_FIELD_LABELS.getValue(field), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
              val value = siteValues.getValue(field)
              Text(if (field == "seo.entity.type") AI_SEO_ENTITY_TYPE_WORDS[value] ?: value else value, style = MaterialTheme.typography.bodyMedium)
            }
          }
        }
        site.notes.forEach { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        TextButton(onClick = { previewOpen = !previewOpen }, modifier = Modifier.testTag("ai-seo-preview")) { Text(if (previewOpen) "Hide the /llms.txt preview" else "Preview /llms.txt") }
        if (previewOpen) {
          Surface(Modifier.fillMaxWidth(), shape = RoundedCornerShape(8.dp), color = MaterialTheme.colorScheme.surfaceVariant) {
            Text(site.llmsPreview, Modifier.padding(space(1.5f)), style = MaterialTheme.typography.bodySmall)
          }
        }
        OutlinedButton(onClick = ::stageSite, enabled = siteFields.isNotEmpty() && siteStaged != jobId, modifier = Modifier.testTag("ai-seo-stage-site")) { Text("Put in the form") }
        if (siteStaged == jobId) NoticeBanner("In the SEO form below as unsaved changes. Review them, then press Save.", StatusTone.SUCCESS)
      }

      // The pages a fix was proposed for, or is still owed to; the check above lists the rest.
      val fixRows = view.pages.filter { view.fixes.containsKey(it.screenId) || it.screenId in view.queue }
      HorizontalDivider()
      if (fixRows.isEmpty()) {
        Text(if (view.pages.isNotEmpty()) "No page needs a written fix." else "This site has no published public pages to fix.", style = MaterialTheme.typography.bodyMedium)
      } else {
        Text("Proposed fixes", style = MaterialTheme.typography.titleSmall)
        fixRows.take(shown).forEach { row ->
          Column(Modifier.fillMaxWidth().testTag("ai-seo-fix-${row.screenId}")) {
            Text(row.name, style = MaterialTheme.typography.bodyMedium)
            Text(row.path, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(aiSeoFixSummary(view.fixes[row.screenId]).ifEmpty { if (running) "Being proposed…" else "" }, style = MaterialTheme.typography.bodySmall)
          }
        }
        if (fixRows.size > shown) TextButton(onClick = { shown += FIX_ROWS_SHOWN }) { Text("Show more (${fixRows.size - shown} left)") }
      }

      val (withContent, withValues) = aiSeoApplyCounts(view)
      val somethingToApply = withContent + withValues + siteFields.size > 0
      Text(
        "Apply all opens a new draft version of each page with content fixes, puts proposed titles and descriptions in each page’s SEO card, and puts the structured data and guidance in the form below. You review and save or publish each of them.",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
      Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1f))) {
        Button(
          onClick = {
            applying = true
            notice = null
            stageSite()
            scope.launch {
              try {
                val answer = context.api.request(
                  "/api/ai/seo/apply",
                  ApiMethod.POST,
                  buildJsonObject { put("orgId", orgId); put("hostId", hostId); put("jobId", jobId.orEmpty()) },
                )
                ((answer as? JsonObject)?.get("job") as? JsonObject)?.let { job = it }
                applied = aiSeoApplyResultOf(answer)
              } catch (error: Throwable) {
                if (error is kotlinx.coroutines.CancellationException) throw error
                notice = runner.describe(error).takeIf { it.isNotBlank() } ?: "The fixes could not be applied — try again."
              } finally {
                applying = false
              }
            }
          },
          enabled = !applying && !running && job?.get("status").text() == "done" && view.complete && somethingToApply,
          modifier = Modifier.testTag("ai-seo-apply"),
        ) { Text("Apply all as drafts") }
        if (applying) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
      }
      applied?.let { result ->
        val names = view.pages.associateBy { it.screenId }
        Column(Modifier.testTag("ai-seo-applied"), verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
          result.versions.forEach { version ->
            TextButton(
              onClick = {
                if (!context.openBesigner("/screens/${version.screenId}/versions/${version.versionId}/besigner")) notice = "That page does not open in the app."
              },
            ) { Text("Open the draft of ${version.name}") }
          }
          result.staged.forEach { id -> Text("A listing for ${names[id]?.name ?: id} waits in its SEO card.", style = MaterialTheme.typography.bodySmall) }
          result.skipped.forEach { (id, reason) ->
            Text("${names[id]?.name ?: id}: $reason", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
          }
        }
      }
    }
  }
}
