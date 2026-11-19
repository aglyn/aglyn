package com.aglyn.site.setup

import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.ui.text.input.KeyboardType
import com.aglyn.contracts.Contracts
import com.aglyn.contracts.ResolvedBusinessProfile
import com.aglyn.contracts.businessProfileFoundedProblem
import com.aglyn.contracts.businessProfileOwnerWrite
import com.aglyn.contracts.businessProfileSourceOf
import com.aglyn.contracts.resolveBusinessProfile
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.Live
import com.aglyn.core.firestoreNow
import com.aglyn.core.nowMillis
import com.aglyn.pluginhost.ActionRunner
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.ui.CountedTextField
import com.aglyn.ui.FormCard
import com.aglyn.ui.SelectField
import com.aglyn.ui.SelectOption

/** The services are one per line in a text box; everything else is its own field. */
private val BOX_FIELDS = listOf("whatYouDo", "services", "audience", "tone", "toneNotes", "founded")

/** The form's text for what is stored: the services one per line, a missing value empty. No area served: a site's is SEO → Local business's Areas served (AGL-4136). */
internal fun businessProfileForm(stored: Map<String, Any?>?): Map<String, String> = mapOf(
  "whatYouDo" to (stored?.get("whatYouDo") as? String).orEmpty(),
  "services" to ((stored?.get("services") as? List<*>)?.filterIsInstance<String>().orEmpty()).joinToString("\n"),
  "audience" to (stored?.get("audience") as? String).orEmpty(),
  "tone" to (stored?.get("tone") as? String).orEmpty(),
  "toneNotes" to (stored?.get("toneNotes") as? String).orEmpty(),
  "founded" to (stored?.get("founded") as? String).orEmpty(),
)

/** What the owner's save carries: every field the form shows, as typed; the owner's write sanitizes it. */
internal fun businessProfileValues(form: Map<String, String>): Map<String, Any?> = mapOf(
  "whatYouDo" to form["whatYouDo"].orEmpty(),
  "services" to form["services"].orEmpty().split('\n'),
  "audience" to form["audience"].orEmpty(),
  "tone" to form["tone"]?.takeIf { it in Contracts.businessToneOrder },
  "toneNotes" to form["toneNotes"].orEmpty(),
  "founded" to form["founded"].orEmpty(),
)

/** Why the year founded the form holds cannot be saved, in the console's words (AGL-4102), or null when it can. */
internal fun businessFoundedError(form: Map<String, String>): String? = businessProfileFoundedProblem(form["founded"], nowMillis())

/**
 * One line under a field saying where the value Aglyn AI reads comes from: a suggestion is shown as a suggestion, and an
 * empty box that is not empty to the AI says what fills it.
 */
internal fun businessOriginLine(field: String, stored: Map<String, Any?>?, resolved: ResolvedBusinessProfile?, fallback: String): String {
  val source = businessProfileSourceOf(stored, field)
  if (source == "start" || source == "ai") return "${Contracts.businessProfileOriginLabels[source]}. Edit it and it becomes yours."
  if (source == "owner") return fallback
  val used: Pair<String, String>? = when (field) {
    "whatYouDo" -> resolved?.whatYouDo?.let { it.value to it.origin }
    "services" -> resolved?.services?.let { it.value.joinToString(", ") to it.origin }
    "serviceArea" -> resolved?.serviceArea?.let { it.value to it.origin }
    "audience" -> resolved?.audience?.let { it.value to it.origin }
    "tone" -> resolved?.tone?.let { (Contracts.businessToneLabels[it.value] ?: it.value) to it.origin }
    "toneNotes" -> resolved?.toneNotes?.let { it.value to it.origin }
    "founded" -> resolved?.founded?.let { it.value to it.origin }
    else -> null
  }
  if (used != null && (used.second == "site" || used.second == "workspace")) {
    val shown = if (used.first.length > 80) used.first.take(79) + "…" else used.first
    return "Empty here, so Aglyn AI uses “$shown” from ${if (used.second == "site") "your SEO settings" else "the workspace defaults"}."
  }
  return fallback
}

/**
 * Setup → Business profile (AGL-3661, AGL-4136): first the Business details, the one place the site's name and how to reach
 * it are entered; then the business profile, the services, audience and tone every AI job for the site reads. That save is
 * the OWNER's write, so every field they changed becomes theirs and a field they left as it was keeps the source it had.
 */
@Composable
internal fun BusinessSection(context: NativePluginContext, hostId: String, host: Map<String, Any?>, api: HostSettingsApi, canEdit: Boolean) {
  val orgId = context.orgId
  val path = "hosts/$hostId/${Contracts.businessProfileSubcollection}/${Contracts.businessProfileSiteDoc}"
  val live by remember(path, context.firestore) { context.firestore.observeDoc(path) }.collectAsState(Live.Loading)
  val workspaceLive by remember(orgId, context.firestore) {
    if (orgId != null) context.firestore.observeDoc("orgs/$orgId/${Contracts.businessProfileSubcollection}/${Contracts.businessProfileWorkspaceDoc}") else kotlinx.coroutines.flow.flowOf(Live.Ready(null))
  }.collectAsState(Live.Loading)
  val readable = live is Live.Ready
  val stored: FirestoreDoc? = (live as? Live.Ready)?.value
  val workspace: FirestoreDoc? = (workspaceLive as? Live.Ready)?.value
  val resolved = remember(host, stored, workspace) { resolveBusinessProfile(host, stored?.data, workspace?.data) }
  val initial = remember(stored) { businessProfileForm(stored?.data) }
  // A newer copy keeps what was typed and moves every other field to it (AGL-4047).
  val form = remember(hostId) { mutableStateMapOf<String, String>().apply { putAll(initial) } }
  val seeded = remember(hostId) { androidx.compose.runtime.mutableStateOf(initial) }
  if (seeded.value != initial) {
    val next = com.aglyn.core.rebased(form.toMap(), seeded.value, initial)
    form.clear()
    form.putAll(next)
    seeded.value = initial
  }
  val scope = androidx.compose.runtime.rememberCoroutineScope()
  val runner = remember(hostId) { ActionRunner(scope) }
  fun line(field: String, fallback: String) = businessOriginLine(field, stored?.data, resolved, fallback)
  val foundedError = businessFoundedError(form)

  BusinessDetailsCard(host, api, canEdit, remember(hostId) { FormDraft.forSite(hostId) })
  // Its own document, so its own hold: Save waits while the profile is only the device cache's copy (AGL-4047).
  val profileChecking = if ((live as? Live.Ready)?.fromCache == true) com.aglyn.ui.FormHold.of("business profile") else null
  androidx.compose.runtime.CompositionLocalProvider(com.aglyn.ui.LocalFormChecking provides profileChecking) {
  FormCard(
    title = "Business profile",
    description = "What this business does and how it speaks. Aglyn AI reads it on every job for this site, and never replaces what you write here. " +
      "The area you serve is in SEO → Local business.",
    dirty = BOX_FIELDS.any { form[it] != initial[it] },
    canSave = canEdit && readable && foundedError == null,
    busy = runner.busy,
    error = runner.error,
    notice = runner.notice,
    onDiscard = { form.putAll(initial); runner.clear() },
    onSave = {
      runner.run("Business profile saved") {
        val next = businessProfileOwnerWrite(stored?.data, businessProfileValues(form)) + mapOf("updatedAt" to firestoreNow(), "updatedBy" to context.uid)
        // The sources are replaced whole, so a field's source never outlives its value; a first save creates the document.
        if (stored != null) context.writer.update(path, next) else context.writer.merge(path, next)
      }
    },
  ) {
    CountedTextField(
      "What the business does", form["whatYouDo"].orEmpty(), { form["whatYouDo"] = it },
      max = (Contracts.businessProfileMaxChars["whatYouDo"] ?: 200.0).toInt(), multiline = true, minLines = 2, enabled = canEdit,
      placeholder = "Mobile dog grooming for busy owners in north Austin", supporting = line("whatYouDo", "One sentence, as you would say it to a new customer"),
    )
    CountedTextField(
      "Services", form["services"].orEmpty(), { form["services"] = it }, multiline = true, minLines = 4, enabled = canEdit,
      placeholder = "Full groom\nBath and brush\nNail trim", supporting = line("services", "One per line, up to ${Contracts.businessProfileMaxServices}"),
    )
    CountedTextField(
      "Who it is for", form["audience"].orEmpty(), { form["audience"] = it },
      max = (Contracts.businessProfileMaxChars["audience"] ?: 160.0).toInt(), multiline = true, minLines = 2, enabled = canEdit,
      placeholder = "Dog owners who work long hours", supporting = line("audience", "The customers you want more of"),
    )
    SelectField(
      "Tone of voice",
      Contracts.businessToneOrder.map { SelectOption(it, Contracts.businessToneLabels[it] ?: it) },
      form["tone"]?.ifEmpty { null },
      { form["tone"] = it.orEmpty() },
      enabled = canEdit,
      noneLabel = "Not set",
      supporting = line("tone", "How the copy should sound"),
    )
    CountedTextField(
      "Notes on tone", form["toneNotes"].orEmpty(), { form["toneNotes"] = it },
      max = (Contracts.businessProfileMaxChars["toneNotes"] ?: 200.0).toInt(), enabled = canEdit,
      placeholder = "Say “pups”, never “pets”. No exclamation marks.", supporting = line("toneNotes", "Words to use or avoid, in your own words"),
    )
    // The year the business started (AGL-4102), as the console's card has it: checked by the console's own rule.
    CountedTextField(
      "Year founded", form["founded"].orEmpty(), { form["founded"] = it }, enabled = canEdit, error = foundedError,
      placeholder = "2015", supporting = line("founded", "Four digits, such as 2015"), keyboardType = KeyboardType.Number,
    )
  }
  }
  // The `hostBusinessProfile` zone: what a plugin adds to the profile (what Aglyn AI learned from the site's edits).
  SlotCards(context, "hostBusinessProfile")
}
