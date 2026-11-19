package com.aglyn.plugins.ai

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiError
import com.aglyn.pluginhost.LocalRecordInsightsZone
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.pluginhost.ProposedTask
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.OutlinedButton
import com.aglyn.ui.SectionCard
import com.aglyn.ui.StatusTone
import com.aglyn.ui.space
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.put

/*
 * The AI summary on a CRM record's page (AGL-2917), the console's `AiCrmRecordCard` and `useAiCrmAnswer`: a short summary of
 * the record and a suggested next step, from its timeline, by a `crm` job through the console's own door (`POST /api/ai/jobs`),
 * the answer read back through `/api/ai/crm/{jobId}`, which asks the CRM again whether this member may read it. Nothing is
 * saved: "Create task" opens the record's task dialog filled in, "Move to" asks before the deal moves. The Apple plugin's
 * AiCrmRecord.swift.
 */

/** The CRM record kinds an AI summary is written for (`AI_CRM_RECORD_KINDS`). */
val AI_CRM_RECORD_KINDS = listOf("contact", "company", "deal", "lead")

const val AI_CRM_LOAD_FAILED_COPY = "AI suggestions could not be loaded."
const val AI_CRM_START_FAILED_COPY = "AI could not be started. Try again."
const val AI_CRM_ANSWER_GONE_COPY = "This suggestion is no longer available. Ask again."

private fun JsonElement?.str(key: String): String? = ((this as? JsonObject)?.get(key) as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull
private fun JsonElement?.obj(key: String): JsonObject? = (this as? JsonObject)?.get(key) as? JsonObject

/** A suggested next step (`AiCrmNextStep`). */
data class AiCrmNextStep(val title: String, val kind: String, val priority: String, val dueInDays: Int, val reason: String)

/** A record's summary (`AiCrmRecordProposal`). */
data class AiCrmRecordProposal(
  val summary: String,
  val standing: String?,
  val asOf: String,
  val nextStep: AiCrmNextStep?,
  val stageId: String?,
  val stageReason: String,
) {
  companion object {
    /** `readAiCrmProposal` for a `record` answer: null for any other shape. */
    fun from(raw: JsonElement?): AiCrmRecordProposal? {
      if (raw.str("kind") != "record") return null
      val record = raw.obj("record") ?: return null
      if (record.str("kind") !in AI_CRM_RECORD_KINDS || record.str("id") == null) return null
      val summary = raw.str("summary") ?: return null
      val step = raw.obj("nextStep")?.let { step ->
        step.str("title")?.let { title ->
          AiCrmNextStep(
            title, step.str("kind") ?: "todo", step.str("priority") ?: "normal",
            (step["dueInDays"] as? JsonPrimitive)?.intOrNull ?: (step["dueInDays"] as? JsonPrimitive)?.contentOrNull?.toDoubleOrNull()?.toInt() ?: 0,
            step.str("reason").orEmpty(),
          )
        }
      }
      val stage = raw.obj("stage")
      return AiCrmRecordProposal(summary, raw.str("standing"), raw.str("asOf").orEmpty(), step, stage.str("stageId"), stage.str("reason").orEmpty())
    }
  }
}

/** Whether a `crm` job answers a summary of this record (`aiCrmJobAnswers`). */
fun aiCrmJobAnswersRecord(job: JsonElement?, kind: String, id: String): Boolean {
  if (job.str("kind") != "crm") return false
  return ((job as? JsonObject)?.get("outputs") as? JsonArray).orEmpty().any { output ->
    val proposal = output.obj("proposal")
    output.str("resource") == "crm" && proposal.str("kind") == "record" && proposal.obj("record").str("kind") == kind &&
      proposal.obj("record").str("id") == id
  }
}

/** When a step is due, in words (`aiCrmDueWords`). */
fun aiCrmDueWords(dueInDays: Int): String = when {
  dueInDays <= 0 -> "due today"
  dueInDays == 1 -> "due tomorrow"
  else -> "due in $dueInDays days"
}

/** A task kind as a person reads it (`TASK_KIND_WORDS`). */
fun aiCrmTaskKindWords(kind: String): String = mapOf("call" to "Call", "email" to "Email", "meeting" to "Meeting", "todo" to "To-do")[kind] ?: kind

/** The suggested next step in one line, as the card says it. */
fun aiCrmNextStepLine(step: AiCrmNextStep): String =
  "${step.title} (${aiCrmTaskKindWords(step.kind)}, ${step.priority} priority, ${aiCrmDueWords(step.dueInDays)})"

/** The AI summary card in a CRM record's `recordInsights` zone. */
@Composable
fun AiCrmRecordCard(context: NativePluginContext) {
  val zone = LocalRecordInsightsZone.current ?: return
  val kind = zone.recordKind.takeIf { it in AI_CRM_RECORD_KINDS } ?: return
  val orgId = zone.orgId ?: context.orgId ?: return
  // The shell's gate on the console widget (`permission: 'ai.generate'`): a member who may not generate sees no card.
  if (!com.aglyn.pluginhost.rememberMemberPermissions(context).can("ai.generate")) return
  val key = "$kind/${zone.recordId}/$orgId"
  val scope = rememberCoroutineScope()
  var verdict by remember(key) { mutableStateOf("checking") }
  var job by remember(key) { mutableStateOf<JsonObject?>(null) }
  var jobId by remember(key) { mutableStateOf("") }
  var proposal by remember(key) { mutableStateOf<AiCrmRecordProposal?>(null) }
  var notice by remember(key) { mutableStateOf<String?>(null) }
  var busy by remember(key) { mutableStateOf(false) }
  var watching by remember(key) { mutableStateOf<Job?>(null) }
  DisposableEffect(key) { onDispose { watching?.cancel() } }

  suspend fun jobs(): JsonElement? = context.api.request("/api/ai/jobs", ApiMethod.GET, query = mapOf("orgId" to orgId, "limit" to AI_RECENT_JOBS_READ))
  suspend fun readAnswer(id: String): AiCrmRecordProposal? =
    runCatching { context.api.request("/api/ai/crm/$id", ApiMethod.GET, query = mapOf("orgId" to orgId)) }.getOrNull()
      ?.let { AiCrmRecordProposal.from(it.obj("answer")?.get("proposal")) }

  /** Follows a job until it settles, then reads its answer. */
  fun watch(id: String) {
    watching?.cancel()
    watching = scope.launch {
      while (true) {
        delay(AI_SEO_POLL_MILLIS)
        val next = try { aiJobById(jobs(), id) } catch (error: Throwable) {
          if (error is CancellationException) throw error
          null
        } ?: continue
        job = next
        if (!aiJobIsTerminal(next)) continue
        if (next.str("status") == "done") {
          proposal = readAnswer(id)
          if (proposal == null) notice = AI_CRM_ANSWER_GONE_COPY
        }
        break
      }
    }
  }

  // The summary another member already asked for, if any (`recall: 'any'`); the flag off or a plan without generation
  // (404, 403) leaves the card off the page.
  LaunchedEffect(key) {
    try {
      val found = ((jobs() as? JsonObject)?.get("jobs") as? JsonArray).orEmpty().firstOrNull {
        it.str("hostId") == zone.hostId && aiCrmJobAnswersRecord(it, kind, zone.recordId)
      } as? JsonObject
      verdict = "ready"
      if (found != null) {
        job = found
        jobId = found.str("id").orEmpty()
        if (!aiJobIsTerminal(found)) watch(jobId) else if (found.str("status") == "done") proposal = readAnswer(jobId)
      }
    } catch (error: Throwable) {
      if (error is CancellationException) throw error
      if (error is ConsoleApiError && (error.status == 403 || error.status == 404)) {
        verdict = "hidden"
      } else {
        notice = (error as? ConsoleApiError)?.takeIf { it.status != 0 }?.message ?: AI_CRM_LOAD_FAILED_COPY
        verdict = "ready"
      }
    }
  }
  if (verdict != "ready") return

  val running = job != null && !aiJobIsTerminal(job)
  fun ask() {
    busy = true
    notice = null
    scope.launch {
      try {
        val body = buildJsonObject {
          put("orgId", orgId)
          if (zone.hostId != null) put("hostId", zone.hostId) else put("hostId", JsonNull)
          put("kind", "crm")
          put("brief", "Summarize this $kind")
          put("inputs", buildJsonObject { put("task", "record"); put("record", kind); put("recordId", zone.recordId) })
        }
        val started = context.api.request("/api/ai/jobs", ApiMethod.POST, body).obj("job")
        if (started != null) {
          proposal = null
          job = started
          jobId = started.str("id").orEmpty()
          if (!aiJobIsTerminal(started)) watch(jobId) else if (started.str("status") == "done") proposal = readAnswer(jobId)
        }
      } catch (error: Throwable) {
        if (error is CancellationException) throw error
        notice = (error as? ConsoleApiError)?.takeIf { it.status != 0 }?.message ?: AI_CRM_START_FAILED_COPY
      } finally {
        busy = false
      }
    }
  }

  SectionCard(null, Modifier.fillMaxWidth().testTag("ai-crm-record")) {
    Column(verticalArrangement = Arrangement.spacedBy(space(1.5f))) {
      Text("AI summary", Modifier.semantics { heading() }, style = MaterialTheme.typography.titleSmall)
      proposal?.let { found ->
        Column(verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
          Text(found.summary, style = MaterialTheme.typography.bodyMedium)
          found.standing?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
          Text("Written from the timeline on ${found.asOf}.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        val proposeTask = zone.proposeTask
        val step = found.nextStep
        if (step != null && proposeTask != null) {
          Column(verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
            Text("Suggested next step", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(aiCrmNextStepLine(step), style = MaterialTheme.typography.bodyMedium)
            Text(step.reason, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Button(
              onClick = { proposeTask(ProposedTask(step.title, step.reason, step.kind, step.priority, step.dueInDays), jobId) },
              modifier = Modifier.testTag("ai-crm-create-task"),
            ) { Text("Create task") }
          }
        }
        val proposeStage = zone.proposeStage
        val offered = zone.stages?.firstOrNull { it.id == found.stageId }?.takeIf { it.id != zone.stageId }
        if (offered != null && proposeStage != null) {
          Column(verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
            Text("Suggested stage", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(offered.name, style = MaterialTheme.typography.bodyMedium)
            Text(found.stageReason, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            OutlinedButton(onClick = { proposeStage(offered.id, jobId) }) { Text("Move to ${offered.name}") }
          }
        }
      }
      Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1f))) {
        OutlinedButton(onClick = ::ask, enabled = !busy && !running, modifier = Modifier.testTag("ai-crm-summarize")) {
          Text(if (proposal == null) "Summarize this $kind" else "Summarize again")
        }
        if (busy || running) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
      }
      notice?.let { NoticeBanner(it, StatusTone.WARNING) }
      val error = job.str("error")
      if (proposal == null && error != null) NoticeBanner(error, if (job.str("status") == "failed") StatusTone.ERROR else StatusTone.WARNING)
    }
  }
}
