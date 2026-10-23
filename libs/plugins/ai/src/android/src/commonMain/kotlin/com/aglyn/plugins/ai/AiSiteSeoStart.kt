package com.aglyn.plugins.ai

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import com.aglyn.core.ApiMethod
import com.aglyn.pluginhost.LocalSeoZone
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.OutlinedButton
import com.aglyn.ui.SectionCard
import com.aglyn.ui.StatusTone
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/** How many recent jobs the card reads to find this site's guided start (`RECENT_JOBS_READ`). */
const val AI_RECENT_JOBS_READ = 20

/** The SEO form's field names the listing fills (`AI_SITE_SEO_FORM_FIELDS`). */
const val AI_SITE_SEO_TITLE_FIELD = "seo.title"
const val AI_SITE_SEO_DESCRIPTION_FIELD = "seo.description"

/** The site's own search listing a guided start proposed: the title and description, and where the words came from. */
data class AiSiteSeoProposal(val title: String, val description: String, val notes: List<String>) {
  /** The values for the site SEO form, by field name. */
  val values: Map<String, String> get() = mapOf(AI_SITE_SEO_TITLE_FIELD to title, AI_SITE_SEO_DESCRIPTION_FIELD to description)
}

private fun JsonElement?.text(): String? = (this as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull

/**
 * The site listing a job's outputs carry, or null when they carry none (`aiSiteSeoProposalOf`). Read defensively: an output
 * is whatever a past release wrote, so a proposal whose values are not two words is no proposal, rather than staged into
 * somebody's live SEO form.
 */
fun aiSiteSeoProposalOf(outputs: JsonElement?): AiSiteSeoProposal? {
  for (output in (outputs as? JsonArray).orEmpty()) {
    val entry = output as? JsonObject ?: continue
    if (entry["resource"].text() != "seo") continue
    val proposal = entry["proposal"] as? JsonObject ?: continue
    if (proposal["kind"].text() != "site-listing") continue
    val values = proposal["values"] as? JsonObject ?: JsonObject(emptyMap())
    val title = values[AI_SITE_SEO_TITLE_FIELD].text() ?: continue
    val description = values[AI_SITE_SEO_DESCRIPTION_FIELD].text() ?: continue
    if (title.isBlank() || description.isBlank()) continue
    val notes = (proposal["notes"] as? JsonArray).orEmpty().mapNotNull { it.text() }
    return AiSiteSeoProposal(title, description, notes)
  }
  return null
}

/** The latest guided-start job for [hostId] that reported a listing, among a jobs route's answer (newest first). */
fun aiLatestSiteListing(jobs: JsonElement?, hostId: String): Pair<String, AiSiteSeoProposal>? {
  for (job in (((jobs as? JsonObject)?.get("jobs")) as? JsonArray).orEmpty()) {
    val entry = job as? JsonObject ?: continue
    if (entry["kind"].text() != "site" || entry["hostId"].text() != hostId) continue
    val proposal = aiSiteSeoProposalOf(entry["outputs"]) ?: continue
    return (entry["id"].text() ?: continue) to proposal
  }
  return null
}

private fun storedSeo(seo: Map<String, Any?>?, field: String): String = ((seo?.get(field.removePrefix("seo.")) as? String)?.trim()).orEmpty()

/**
 * Whether the site's settings already say what the proposal says. Both values have to match: a site whose title was applied
 * and whose description was then rewritten still has something to take (`aiSiteSeoAlreadySaid`).
 */
fun aiSiteSeoAlreadySaid(proposal: AiSiteSeoProposal, seo: Map<String, Any?>?): Boolean =
  proposal.values.all { (field, value) -> storedSeo(seo, field) == value.trim() }

/**
 * The site's own search listing, from the guided start's answers, on the site's SEO page (the console's `hostSeo` widget).
 * The two answers the guided start asks (what kind of site, and who it is for) are the site-wide search title and
 * description every page without its own falls back to. It writes nothing and asks no model anything: "Put in the form"
 * stages the two values in the SEO form below as unsaved edits and the form's Save is the write. Absent unless a guided start
 * ran here and its listing is not already saved.
 */
@Composable
fun AiSiteSeoStartCard(context: NativePluginContext) {
  val zone = LocalSeoZone.current ?: return
  val hostId = context.hostId ?: return
  val orgId = context.orgId ?: return
  var staged by remember(hostId) { mutableStateOf(false) }
  val found by produceState<Pair<String, AiSiteSeoProposal>?>(null, orgId, hostId) {
    value = try {
      aiLatestSiteListing(context.api.request("/api/ai/jobs", ApiMethod.GET, query = mapOf("orgId" to orgId, "limit" to AI_RECENT_JOBS_READ)), hostId)
    } catch (_: Throwable) {
      null
    }
  }
  val (jobId, proposal) = found ?: return
  if (!staged && aiSiteSeoAlreadySaid(proposal, zone.seo)) return

  SectionCard("The listing your answers describe", Modifier.fillMaxWidth().testTag("ai-site-seo-start")) {
    Text(
      "What you said this site is, and who it is for, as the title and description every page without its own falls back to. Nothing is saved until you press Save below.",
      style = MaterialTheme.typography.bodySmall,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    Column {
      Text("Title", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
      Text(proposal.title, style = MaterialTheme.typography.bodyMedium)
    }
    Column {
      Text("Description", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
      Text(proposal.description, style = MaterialTheme.typography.bodyMedium)
    }
    proposal.notes.forEach { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
    OutlinedButton(
      onClick = {
        zone.proposeDraft(proposal.values, "$jobId:site-listing")
        staged = true
      },
      enabled = !staged,
      modifier = Modifier.testTag("ai-seo-stage"),
    ) { Text("Put in the form") }
    if (staged) NoticeBanner("In the SEO form below as unsaved changes. Read them, then press Save.", StatusTone.SUCCESS)
  }
}
