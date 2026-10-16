package com.aglyn.plugins.ai

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull

/*
 * SEO by AI (ai-seo.ts): the proposals an `seo` job produces, put back together from its outputs. Every value is a
 * proposal and nothing here writes: a page's listing is staged in its own SEO card, a site audit's content fixes become a
 * new unpublished version only when a person applies them, and the site-wide proposals land in the SEO form unsaved.
 */

/** An AI job's statuses that end it (`AI_JOB_TERMINAL_STATUSES`). */
val AI_JOB_TERMINAL_STATUSES = setOf("done", "failed", "canceled")

/** What each site SEO form field is called where the proposal lists it. */
val AI_SEO_SITE_FIELD_LABELS = linkedMapOf(
  "seo.entity.type" to "Published by",
  "seo.entity.name" to "Name",
  "seo.entity.description" to "Description",
  "seo.entity.email" to "Contact email",
  "seo.entity.telephone" to "Contact phone",
  "seo.entity.contactType" to "Contact is for",
  "seo.agent.whenToUse" to "When to use this site",
  "seo.agent.howToUse" to "How an agent should call you",
)

/** The entity type's stored code, in words. */
val AI_SEO_ENTITY_TYPE_WORDS = mapOf("1" to "An organization", "2" to "A person")

private fun JsonElement?.text(): String? = (this as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull
private fun JsonElement?.strings(): List<String> = (this as? JsonArray).orEmpty().mapNotNull { it.text() }
private fun JsonElement?.obj(): JsonObject? = this as? JsonObject
private fun JsonElement?.int(): Int? = (this as? JsonPrimitive)?.takeIf { !it.isString }?.doubleOrNull?.toInt()

/** A page the audit covered. */
data class AiSeoAuditPage(val screenId: String, val name: String, val path: String, val versionId: String?)

/** Everything proposed for one page: listing values, content fixes (by kind) and guidance a job cannot act on. */
data class AiSeoPageFix(val screenId: String, val values: Map<String, String>, val contentKinds: List<String>, val guidance: List<String>)

/** The site's structured data and agent guidance, and `/llms.txt` as it would read once the guidance is saved. */
data class AiSeoSiteProposal(val values: Map<String, String>, val llmsPreview: String, val notes: List<String>)

/** One site audit, put back together from a job's outputs. */
data class AiSeoAuditView(
  val pages: List<AiSeoAuditPage>,
  /** Pages whose fixes need generated text, in the order the batches take them. */
  val queue: List<String>,
  /** How many pages one batch of fixes carries. */
  val batchSize: Int,
  /** Whether the site-wide proposal is owed. */
  val siteProposal: Boolean,
  val fixes: Map<String, AiSeoPageFix>,
  val site: AiSeoSiteProposal?,
  /** Batches recorded so far. */
  val batches: Int,
) {
  /** Batches the report queued. */
  val owedBatches: Int get() = kotlin.math.ceil(queue.size.toDouble() / maxOf(1, batchSize)).toInt()

  /** Whether every batch the report queued has been recorded. */
  val complete: Boolean get() = batches >= owedBatches && (!siteProposal || site != null)
}

private fun fixOf(entry: JsonObject): AiSeoPageFix? {
  val id = entry["screenId"].text() ?: return null
  val values = entry["values"].obj().orEmpty().mapNotNull { (key, value) -> value.text()?.let { key to it } }.toMap()
  val content = (entry["content"] as? JsonArray).orEmpty().mapNotNull { it.obj()?.get("kind").text() }
  return AiSeoPageFix(id, values, content, entry["guidance"].strings())
}

/** The audit a job's outputs describe, or null when they describe none (`aiSeoAuditView`). */
fun aiSeoAuditView(outputs: JsonElement?): AiSeoAuditView? {
  var report: JsonObject? = null
  var site: AiSeoSiteProposal? = null
  val fixes = LinkedHashMap<String, AiSeoPageFix>()
  var batches = 0
  for (output in (outputs as? JsonArray).orEmpty()) {
    val entry = output.obj() ?: continue
    if (entry["resource"].text() != "seo") continue
    val proposal = entry["proposal"].obj() ?: continue
    when (proposal["kind"].text()) {
      "audit" -> if (proposal["pages"] is JsonArray) report = proposal
      "site" -> proposal["site"].obj()?.let { raw ->
        site = AiSeoSiteProposal(
          raw["values"].obj().orEmpty().mapNotNull { (key, value) -> value.text()?.let { key to it } }.toMap(),
          raw["llmsPreview"].text().orEmpty(),
          raw["notes"].strings(),
        )
      }
      "fixes" -> if (proposal["fixes"] is JsonArray) {
        batches += 1
        for (fix in (proposal["fixes"] as JsonArray)) fix.obj()?.let(::fixOf)?.let { fixes[it.screenId] = it }
      }
    }
  }
  val audit = report ?: return null
  val pages = (audit["pages"] as JsonArray).mapNotNull { page ->
    val entry = page.obj() ?: return@mapNotNull null
    AiSeoAuditPage(entry["screenId"].text() ?: return@mapNotNull null, entry["name"].text().orEmpty(), entry["path"].text().orEmpty(), entry["versionId"].text())
  }
  return AiSeoAuditView(
    pages = pages,
    queue = audit["queue"].strings(),
    batchSize = audit["batchSize"].int() ?: 1,
    siteProposal = (audit["siteProposal"] as? JsonPrimitive)?.contentOrNull == "true",
    fixes = fixes,
    site = site,
    batches = batches,
  )
}

/** The latest SEO audit among a jobs route's answer (newest first) that covers [hostId]: its job and the audit it recorded. */
fun aiLatestSeoAudit(jobs: JsonElement?, hostId: String): Pair<JsonObject, AiSeoAuditView>? {
  for (job in ((jobs.obj()?.get("jobs")) as? JsonArray).orEmpty()) {
    val entry = job.obj() ?: continue
    if (entry["kind"].text() != "seo" || entry["hostId"].text() != hostId) continue
    val view = aiSeoAuditView(entry["outputs"]) ?: continue
    return entry to view
  }
  return null
}

/** One page's proposed fix, in a sentence a row can hold (`fixSummary`). */
fun aiSeoFixSummary(fix: AiSeoPageFix?): String {
  if (fix == null) return ""
  val parts = mutableListOf<String>()
  fix.values["title"]?.let { parts += "Title: $it" }
  fix.values["description"]?.let { parts += "Description: $it" }
  val alts = fix.contentKinds.count { it == "image-alt" }
  if (alts > 0) parts += "$alts image ${if (alts == 1) "description" else "descriptions"}"
  if (fix.contentKinds.any { it != "image-alt" }) parts += "One main heading"
  parts += fix.guidance
  return parts.joinToString(" · ")
}

/** How many pages get content fixes, and how many get a staged listing, if the audit were applied. */
fun aiSeoApplyCounts(view: AiSeoAuditView): Pair<Int, Int> =
  view.fixes.values.count { it.contentKinds.isNotEmpty() } to view.fixes.values.count { it.values.isNotEmpty() }

/** What `/api/ai/seo/apply` answers. */
data class AiSeoApplyResult(
  val versions: List<AppliedVersion>,
  val staged: List<String>,
  val skipped: List<Pair<String, String>>,
) {
  data class AppliedVersion(val screenId: String, val versionId: String, val name: String)
}

fun aiSeoApplyResultOf(answer: JsonElement?): AiSeoApplyResult {
  val body = answer.obj()
  val versions = (body?.get("versions") as? JsonArray).orEmpty().mapNotNull { entry ->
    val raw = entry.obj() ?: return@mapNotNull null
    AiSeoApplyResult.AppliedVersion(raw["screenId"].text() ?: return@mapNotNull null, raw["versionId"].text() ?: return@mapNotNull null, raw["name"].text().orEmpty())
  }
  val skipped = (body?.get("skipped") as? JsonArray).orEmpty().mapNotNull { entry ->
    val raw = entry.obj() ?: return@mapNotNull null
    (raw["screenId"].text() ?: return@mapNotNull null) to raw["reason"].text().orEmpty()
  }
  return AiSeoApplyResult(versions, body?.get("staged").strings(), skipped)
}
