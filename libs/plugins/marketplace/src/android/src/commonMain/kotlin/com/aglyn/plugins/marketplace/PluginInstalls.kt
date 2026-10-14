package com.aglyn.plugins.marketplace

import com.aglyn.contracts.InstallTarget
import com.aglyn.pluginhost.jsString

/*
 * What a plugin's page says about its installs: the version comparison, the update status, the org-wide picture of one
 * listing's pins, which sites an uninstall touches, and the sentences the plugin pages and their dialogs say about them.
 * Ports of marketplace-catalog.ts (the console's own, pure), each replayed from function-cases.generated.json by
 * MarketplaceCasesTest; the Apple plugin's PluginInstalls.swift holds the same ports.
 */

/* ---- Versions ---- */

/** A version as the console's `String(value)` reads it: nothing for a missing or empty one. */
fun versionText(value: Any?): String? = when (value) {
  null -> null
  is String -> value.ifEmpty { null }
  is Boolean -> null
  is Number -> jsString(value)
  else -> null
}

/** Orders two artifact versions (`compareArtifactVersions`): dotted whole numbers, null when either is missing or neither parses. */
fun compareArtifactVersions(a: String?, b: String?): Int? {
  if (a.isNullOrEmpty() || b.isNullOrEmpty()) return null
  if (a == b) return 0
  fun parse(value: String): List<Long>? {
    val numbers = value.split('.').map { part -> if (part.isNotEmpty() && part.all { it in '0'..'9' }) part.toLongOrNull() else null }
    return if (numbers.isEmpty() || numbers.any { it == null }) null else numbers.map { it!! }
  }
  val left = parse(a) ?: return null
  val right = parse(b) ?: return null
  for (index in 0 until maxOf(left.size, right.size)) {
    val one = left.getOrElse(index) { 0L }
    val two = right.getOrElse(index) { 0L }
    if (one < two) return -1
    if (one > two) return 1
  }
  return 0
}

enum class UpdateState(val raw: String) { CURRENT("current"), UPDATE_AVAILABLE("update-available"), AHEAD("ahead"), UNKNOWN("unknown") }

enum class UnknownReason(val raw: String) { NO_PROVENANCE("no-provenance"), NOTHING_PUBLISHED("nothing-published"), INCOMPARABLE("incomparable") }

/** Whether an installed plugin is still what the publisher ships (`UpdateStatus`). */
data class UpdateStatus(val state: UpdateState, val installedVersion: String?, val availableVersion: String?, val unknownReason: UnknownReason? = null) {
  companion object {
    val Unknown = UpdateStatus(UpdateState.UNKNOWN, null, null, UnknownReason.NO_PROVENANCE)
  }
}

/** One sentence describing an update state (`updateStateLabel`). */
fun updateStateLabel(status: UpdateStatus): String = when (status.state) {
  UpdateState.UPDATE_AVAILABLE -> "You have v${status.installedVersion} · v${status.availableVersion} available"
  UpdateState.CURRENT -> "Up to date · v${status.installedVersion}"
  UpdateState.AHEAD -> "You have v${status.installedVersion}, newer than the published v${status.availableVersion}"
  UpdateState.UNKNOWN -> when (status.unknownReason) {
    UnknownReason.NOTHING_PUBLISHED -> "No published version to compare against"
    UnknownReason.INCOMPARABLE -> "You have v${status.installedVersion}; v${status.availableVersion} cannot be ordered against it"
    else -> "Installed before update tracking — version unknown"
  }
}

/** The versions a revocation (`revocations/{listingId}`) stops. */
sealed interface Revoked {
  data object All : Revoked
  data class Versions(val versions: List<String>) : Revoked

  companion object {
    fun from(data: Map<String, Any?>?): Revoked? = when (val versions = data?.get("versions")) {
      is String -> if (versions == "all") All else Versions(emptyList())
      is List<*> -> Versions(versions.filterIsInstance<String>())
      else -> null
    }
  }
}

/** What a listing offers right now (`pluginOfferedVersion`): the newest approved version, unless a revocation has stopped it. */
fun pluginOfferedVersion(latestApprovedVersion: String?, revoked: Revoked?): String? {
  val offered = latestApprovedVersion?.ifEmpty { null } ?: return null
  return when (revoked) {
    Revoked.All -> null
    is Revoked.Versions -> if (offered in revoked.versions) null else offered
    null -> offered
  }
}

/** The pin fields an update comparison reads, in every shape the install routes have written (`UpdateComparablePin`). */
class UpdateComparablePin(data: Map<String, Any?>) {
  class Link(val listingId: String?, val version: String?)

  val version: String? = versionText(data["version"])
  val listingId: String? = data["listingId"] as? String
  val installedFrom: Link? = link(data["installedFrom"])
  val marketplace: Link? = link(data["marketplace"])
  val source: Link? = link(data["source"])

  private fun link(value: Any?): Link? = (value as? Map<*, *>)?.let { Link(it["listingId"] as? String, versionText(it["version"])) }
}

/** Whether the installed plugin is still what the publisher ships (`pluginUpdateStatus`). */
fun pluginUpdateStatus(pin: UpdateComparablePin?, offered: String?): UpdateStatus {
  if (pin == null) return UpdateStatus.Unknown
  val recorded = when {
    !pin.installedFrom?.listingId.isNullOrEmpty() -> pin.installedFrom?.version
    !pin.marketplace?.listingId.isNullOrEmpty() -> pin.marketplace?.version
    !pin.source?.listingId.isNullOrEmpty() -> pin.source?.version
    !pin.listingId.isNullOrEmpty() -> pin.version
    else -> null
  }
  val installed = recorded?.ifEmpty { null } ?: return UpdateStatus.Unknown
  val available = offered?.ifEmpty { null }
    ?: return UpdateStatus(UpdateState.UNKNOWN, installed, null, UnknownReason.NOTHING_PUBLISHED)
  val order = compareArtifactVersions(installed, available)
    ?: return UpdateStatus(UpdateState.UNKNOWN, installed, available, UnknownReason.INCOMPARABLE)
  return UpdateStatus(if (order == 0) UpdateState.CURRENT else if (order < 0) UpdateState.UPDATE_AVAILABLE else UpdateState.AHEAD, installed, available)
}

/* ---- The org-wide picture ---- */

/** A site of the workspace, as the install picture names it. */
data class SiteChoice(val id: String, val label: String)

/** One site's slice of an org-scope install picture (`OrgInstallSite`). */
data class OrgInstallSite(
  val hostId: String,
  val label: String,
  /** The version that actually runs here, from the effective pin. */
  val version: String?,
  /** Where that pin lives: a host pin shadows the org one, as the loader does. */
  val pinnedBy: InstallTarget,
  /** This site has its own pin on top of an org pin. */
  val shadowed: Boolean,
)

/** The whole org's install picture for one listing (`OrgInstallSummary`). */
data class OrgInstallSummary(
  val orgWide: Boolean,
  val orgVersion: String?,
  val sites: List<OrgInstallSite>,
  val hostPinnedIds: List<String>,
  val availableHostIds: List<String>,
  val installedAnywhere: Boolean,
)

/** A pin's version: `hostPins[host]` is absent for a site with no pin, and a pin with or without a version otherwise. */
data class PinVersion(val version: String?)

fun resolveOrgInstallSummary(hosts: List<SiteChoice>, hostPins: Map<String, PinVersion>, orgPin: PinVersion?): OrgInstallSummary {
  val orgVersion = orgPin?.version
  val sites = mutableListOf<OrgInstallSite>()
  val hostPinned = mutableListOf<String>()
  val available = mutableListOf<String>()
  for (host in hosts) {
    val hostPin = hostPins[host.id]
    if (hostPin != null) hostPinned += host.id
    if (hostPin == null && orgPin == null) {
      available += host.id
      continue
    }
    sites += OrgInstallSite(host.id, host.label, hostPin?.version ?: orgVersion, if (hostPin != null) InstallTarget.HOST else InstallTarget.ORG, hostPin != null && orgPin != null)
  }
  return OrgInstallSummary(orgPin != null, orgVersion, sites, hostPinned, available, orgPin != null || hostPinned.isNotEmpty())
}

/** One site an uninstall would touch, and whether it really loses the plugin (`UninstallTarget`). */
data class UninstallTarget(val hostId: String, val label: String, val stillCovered: Boolean)

fun resolveUninstallTargets(install: OrgInstallSummary, scope: InstallTarget, hostId: String? = null): List<UninstallTarget> {
  if (scope == InstallTarget.HOST) {
    val site = install.sites.firstOrNull { it.hostId == hostId } ?: return emptyList()
    return listOf(UninstallTarget(site.hostId, site.label, install.orgWide))
  }
  return install.sites.map { UninstallTarget(it.hostId, it.label, it.pinnedBy == InstallTarget.HOST) }
}

/** The sites whose running version is behind the one on offer (`staleSites`). */
fun staleSites(sites: List<OrgInstallSite>, latestVersion: String?): List<OrgInstallSite> =
  sites.filter { (compareArtifactVersions(it.version, latestVersion) ?: 0) < 0 }

/** What "Where it runs" opens with (`pluginSiteSetSummary`). */
fun pluginSiteSetSummary(install: OrgInstallSummary, siteCount: Int): String =
  if (install.orgWide) "Installed for the whole organization (v${install.orgVersion}) — every site, including ones you add later."
  else "Installed on ${install.sites.size} of $siteCount sites."

/** What the update confirmation says (`pluginUpdatePrompt`). */
data class PluginUpdatePrompt(val title: String, val body: String, val others: String?, val note: String)

fun pluginUpdatePrompt(name: String, latestVersion: String, label: String, singleSite: Boolean) = PluginUpdatePrompt(
  title = "Update to v$latestVersion?",
  body = "$name moves from the version running now to v$latestVersion on $label.",
  others = if (singleSite) "Other sites stay on the version they are running." else null,
  note = "Pins only move forward — there is no going back to the previous version from here.",
)

/** What the bulk update button is called and aims at (`pluginUpdateAll`); [hostIds] is null for the one org-wide pin. */
data class PluginUpdateAll(val label: String, val target: String, val hostIds: List<String>?)

fun pluginUpdateAll(install: OrgInstallSummary, stale: List<OrgInstallSite>, latestVersion: String) = PluginUpdateAll(
  label = if (install.orgWide) "Update to v$latestVersion" else "Update all ${stale.size} to v$latestVersion",
  target = if (install.orgWide) "every site in this organization" else "${stale.size} site${if (stale.size == 1) "" else "s"}",
  hostIds = if (install.orgWide) null else stale.map { it.hostId },
)

/** The notice above an org-wide update (`PLUGIN_ORG_WIDE_UPDATE_NOTE`). */
const val PLUGIN_ORG_WIDE_UPDATE_NOTE =
  "This is one organization-wide pin, so updating moves every site at once. To take a version on one site first, install per site instead."

/* ---- The uninstall dialog ---- */

data class UninstallPlacement(val type: String, val name: String, val count: Int)

data class UninstallImpactSite(val label: String, val stillCovered: Boolean, val placements: List<UninstallPlacement>, val affectedScreens: Int)

/** What `/api/hosts/plugin-impact` answers (`UninstallImpact`). */
data class UninstallImpact(val sites: List<UninstallImpactSite>, val losingSites: Int, val affectedScreens: Int, val truncated: Boolean)

/** The word typed to confirm an uninstall that breaks pages, or whose impact could not be checked. */
const val UNINSTALL_ACKNOWLEDGEMENT = "UNINSTALL"

data class UninstallAlert(val tone: String, val text: String)

data class UninstallSiteView(val label: String, val pages: String, val chips: List<String>)

/** What the uninstall dialog shows (`uninstallImpactView`). */
data class UninstallImpactView(
  val title: String,
  val confirmLabel: String,
  val scanning: Boolean,
  val alerts: List<UninstallAlert>,
  val sites: List<UninstallSiteView>,
  val note: String?,
  val needsAcknowledgement: Boolean,
)

fun uninstallImpactView(
  name: String,
  scope: InstallTarget,
  pluginId: String,
  targets: List<UninstallTarget>,
  impact: UninstallImpact?,
  failed: Boolean,
): UninstallImpactView {
  val losing = targets.filter { !it.stillCovered }
  val covered = targets.filter { it.stillCovered }
  val scanning = pluginId.isNotEmpty() && losing.isNotEmpty() && impact == null && !failed
  val affected = impact?.affectedScreens ?: 0
  val unknown = failed || (pluginId.isEmpty() && losing.isNotEmpty())
  val alerts = mutableListOf<UninstallAlert>()
  if (unknown && !scanning) {
    alerts += UninstallAlert(
      "warning",
      if (pluginId.isNotEmpty()) "The impact check could not run, so this cannot say what would stop working. Nothing here means \"nothing breaks\"."
      else "This listing records no plugin id, so its placements cannot be found. Pages using it may stop rendering it.",
    )
  }
  if (!scanning && !unknown && affected > 0) {
    val sites = impact?.losingSites ?: losing.size
    alerts += UninstallAlert(
      "error",
      "Removes $name from $sites site${if (sites == 1) "" else "s"}; ${if (impact?.truncated == true) "at least " else ""}$affected published page${if (affected == 1) "" else "s"} " +
        "place${if (affected == 1) "s" else ""} it and will stop rendering it.",
    )
  }
  if (!scanning && !unknown && affected == 0 && losing.isNotEmpty()) {
    alerts += UninstallAlert("info", "No published page places this plugin, so nothing visitors can see changes.")
  }
  if (covered.isNotEmpty()) {
    alerts += UninstallAlert(
      "info",
      if (covered.size == targets.size) {
        "The plugin keeps running on ${if (covered.size == 1) "this site" else "all ${covered.size} of these sites"}, " +
          "because another install still covers ${if (covered.size == 1) "it" else "them"}. Only which version is in use changes."
      } else {
        "${covered.size} of these sites keep the plugin — ${covered.joinToString(", ") { it.label }} — because another install still covers them."
      },
    )
  }
  val nouns = mapOf("screen" to "page", "layout" to "layout", "component" to "component")
  val sites = impact?.sites.orEmpty().filter { !it.stillCovered && it.placements.isNotEmpty() }.map { site ->
    UninstallSiteView(
      site.label,
      "${site.affectedScreens} published page${if (site.affectedScreens == 1) "" else "s"} affected",
      site.placements.take(12).map { "${nouns[it.type] ?: it.type}: ${it.name}${if (it.count > 1) " ×${it.count}" else ""}" } +
        if (site.placements.size > 12) listOf("+${site.placements.size - 12} more") else emptyList(),
    )
  }
  return UninstallImpactView(
    title = if (scope == InstallTarget.ORG) "Uninstall $name across the organization?" else "Remove $name from this site?",
    confirmLabel = if (scope == InstallTarget.ORG) "Uninstall org-wide" else "Remove",
    scanning = scanning,
    alerts = alerts,
    sites = sites,
    note = if (!scanning && losing.isNotEmpty()) {
      "Uninstalling removes the install only. The plugin’s settings and any data it stored are kept, and installing it again restores the pages that place it."
    } else {
      null
    },
    needsAcknowledgement = !scanning && (affected > 0 || unknown),
  )
}

/* ---- An install run ---- */

/** What a run of installs says once it is done (`installPlanOutcome`). */
data class InstallPlanOutcome(val tone: String, val text: String)

fun installPlanOutcome(name: String, installed: Int, errors: List<String>, orgWide: Boolean, updating: Boolean, version: String?, saved: Boolean = false): InstallPlanOutcome {
  val noun = if (updating) "Updated" else if (saved) "Saved" else "Installed"
  val toVersion = if (updating && version != null) " to v$version" else ""
  return when {
    installed > 0 && errors.isEmpty() -> InstallPlanOutcome(
      "success",
      if (orgWide) "$noun \"$name\"$toVersion for the whole organization" else "$noun \"$name\"$toVersion on $installed site${if (installed == 1) "" else "s"}",
    )
    installed > 0 -> InstallPlanOutcome("warning", "$noun on $installed site(s); ${errors.size} failed — ${errors[0]}")
    else -> InstallPlanOutcome("error", errors.firstOrNull() ?: "Install failed")
  }
}

/** The row of the plugins list for one install (`installedPluginCaption`). */
fun installedPluginCaption(version: String?, orgWide: Boolean, siteLabels: List<String>): String =
  "v${version ?: "undefined"} · " + (if (orgWide) "every site in this organization" else if (siteLabels.size == 1) siteLabels[0] else "${siteLabels.size} sites")

/** What `/api/hosts/plugin-impact` answered, or null when it did not answer in that shape. */
fun uninstallImpactFrom(answer: kotlinx.serialization.json.JsonElement?): UninstallImpact? {
  val root = answer as? kotlinx.serialization.json.JsonObject ?: return null
  fun text(element: kotlinx.serialization.json.JsonElement?, key: String) = ((element as? kotlinx.serialization.json.JsonObject)?.get(key) as? kotlinx.serialization.json.JsonPrimitive)?.takeIf { it.isString }?.content
  fun number(element: kotlinx.serialization.json.JsonElement?, key: String) = ((element as? kotlinx.serialization.json.JsonObject)?.get(key) as? kotlinx.serialization.json.JsonPrimitive)?.content?.toDoubleOrNull()?.toInt()
  fun flag(element: kotlinx.serialization.json.JsonElement?, key: String) = ((element as? kotlinx.serialization.json.JsonObject)?.get(key) as? kotlinx.serialization.json.JsonPrimitive)?.content == "true"
  val sites = (root["sites"] as? kotlinx.serialization.json.JsonArray).orEmpty().mapNotNull { site ->
    val label = text(site, "label") ?: return@mapNotNull null
    UninstallImpactSite(
      label,
      flag(site, "stillCovered"),
      ((site as kotlinx.serialization.json.JsonObject)["placements"] as? kotlinx.serialization.json.JsonArray).orEmpty().mapNotNull { place ->
        UninstallPlacement(text(place, "type") ?: return@mapNotNull null, text(place, "name") ?: return@mapNotNull null, number(place, "count") ?: 1)
      },
      number(site, "affectedScreens") ?: 0,
    )
  }
  return UninstallImpact(sites, number(root, "losingSites") ?: 0, number(root, "affectedScreens") ?: 0, flag(root, "truncated"))
}

/* ---- A marketplace plugin's settings, from its manifest ---- */

/** A field a manifest declares for the plugin's settings (`ManifestConfigField`). */
data class ManifestSettingsField(
  val key: String,
  val label: String,
  val type: String,
  val description: String?,
  val options: List<Pair<String, String>>?,
  val min: Double?,
  val max: Double?,
)

private const val MANIFEST_CONFIG_FIELD_LIMIT = 50

/** A number as the console's JSON writes it: whole numbers without a fraction. */
private fun jsonNumber(value: Double): kotlinx.serialization.json.JsonPrimitive =
  if (value == kotlin.math.floor(value) && kotlin.math.abs(value) < 1e15) kotlinx.serialization.json.JsonPrimitive(value.toLong()) else kotlinx.serialization.json.JsonPrimitive(value)

private fun kotlinx.serialization.json.JsonElement?.asObject() = this as? kotlinx.serialization.json.JsonObject

private fun kotlinx.serialization.json.JsonElement?.asText(): String? = (this as? kotlinx.serialization.json.JsonPrimitive)?.takeIf { it.isString }?.content

private fun kotlinx.serialization.json.JsonElement?.asNumber(): Double? =
  (this as? kotlinx.serialization.json.JsonPrimitive)?.takeIf { !it.isString }?.content?.toDoubleOrNull()?.takeIf { it.isFinite() }

/** A stored or declared value as its field takes it (`coerceManifestConfigValue`), else [fallback]. */
private fun coerceManifestConfigValue(field: ManifestSettingsField, raw: kotlinx.serialization.json.JsonElement?, fallback: kotlinx.serialization.json.JsonElement): kotlinx.serialization.json.JsonElement =
  when (field.type) {
    "boolean" -> if ((raw as? kotlinx.serialization.json.JsonPrimitive)?.takeIf { !it.isString }?.content in setOf("true", "false")) raw!! else fallback
    "number" -> {
      val value = raw.asNumber()
      when {
        value == null -> fallback
        field.min != null && value < field.min -> jsonNumber(field.min)
        field.max != null && value > field.max -> jsonNumber(field.max)
        else -> jsonNumber(value)
      }
    }
    "select" -> raw.asText()?.takeIf { value -> field.options?.any { it.first == value } == true }?.let { raw!! } ?: fallback
    else -> raw.asText()?.let { raw!! } ?: fallback
  }

/** The fields a plugin's manifest declares for its settings, and the values they start from (`manifestSettingsFields`). */
fun manifestSettingsFields(manifest: kotlinx.serialization.json.JsonElement?): Pair<List<ManifestSettingsField>, Map<String, kotlinx.serialization.json.JsonElement>>? {
  val declared = manifest.asObject()?.get("config")
  val rawFields = declared.asObject()?.get("fields") as? kotlinx.serialization.json.JsonArray ?: return null
  val seen = mutableSetOf<String>()
  val fields = mutableListOf<ManifestSettingsField>()
  for (raw in rawFields) {
    if (fields.size >= MANIFEST_CONFIG_FIELD_LIMIT) break
    val entry = raw.asObject() ?: continue
    val key = entry["key"].asText()?.trim().orEmpty()
    if (key.isEmpty() || key in seen) continue
    val type = when (val declaredType = entry["type"]) {
      null, kotlinx.serialization.json.JsonNull -> "string"
      else -> declaredType.asText() ?: continue
    }
    if (type !in setOf("string", "number", "boolean", "select")) continue
    val options = (entry["options"] as? kotlinx.serialization.json.JsonArray)?.mapNotNull { option ->
      val value = option.asObject()?.get("value").asText()
      val label = option.asObject()?.get("label").asText()
      if (value != null && label != null) value to label else null
    }
    if (type == "select" && options.isNullOrEmpty()) continue
    seen += key
    fields += ManifestSettingsField(
      key,
      entry["label"].asText()?.takeIf { it.isNotBlank() }?.take(120) ?: key,
      type,
      entry["description"].asText()?.take(400),
      options,
      entry["min"].asNumber(),
      entry["max"].asNumber(),
    )
  }
  if (fields.isEmpty()) return null
  val supplied = declared.asObject()?.get("defaults").asObject()
  val defaults = linkedMapOf<String, kotlinx.serialization.json.JsonElement>()
  for (field in fields) {
    val empty: kotlinx.serialization.json.JsonElement = when (field.type) {
      "boolean" -> kotlinx.serialization.json.JsonPrimitive(false)
      "number" -> jsonNumber(field.min ?: 0.0)
      "select" -> kotlinx.serialization.json.JsonPrimitive(field.options?.firstOrNull()?.first ?: "")
      else -> kotlinx.serialization.json.JsonPrimitive("")
    }
    defaults[field.key] = coerceManifestConfigValue(field, supplied?.get(field.key), empty)
  }
  return fields to defaults
}

/** The workspace-settings screen of a marketplace plugin, as a native screen spec (`manifestSettingsScreen`); null for a plugin that declares no settings. */
fun manifestSettingsScreen(pluginId: String, label: String, manifest: kotlinx.serialization.json.JsonElement?): kotlinx.serialization.json.JsonObject? {
  if (pluginId.isEmpty()) return null
  val (fields, defaults) = manifestSettingsFields(manifest) ?: return null
  val kinds = mapOf("string" to "text", "number" to "number", "boolean" to "toggle", "select" to "select")
  fun text(value: String) = kotlinx.serialization.json.JsonPrimitive(value)
  val controls = fields.map { field ->
    val out = linkedMapOf<String, kotlinx.serialization.json.JsonElement>(
      "key" to text(field.key),
      "label" to text(field.label),
      "kind" to text(kinds[field.type] ?: "text"),
      "initial" to text("{item.${field.key} ?? const.defaults.${field.key}}"),
    )
    if (field.type == "select") {
      out["options"] = kotlinx.serialization.json.JsonArray(field.options.orEmpty().map { kotlinx.serialization.json.JsonObject(mapOf("value" to text(it.first), "label" to text(it.second))) })
    }
    val band = if (field.type == "number" && (field.min != null || field.max != null)) "Between ${field.min?.let { com.aglyn.pluginhost.jsNumber(it) } ?: "any"} and ${field.max?.let { com.aglyn.pluginhost.jsNumber(it) } ?: "any"}." else ""
    val help = listOfNotNull(field.description, band).filter { it.isNotEmpty() }.joinToString(" ")
    if (help.isNotEmpty()) out["help"] = text(help)
    kotlinx.serialization.json.JsonObject(out)
  }
  val written = fields.associate { it.key to (text("{form.${it.key}}") as kotlinx.serialization.json.JsonElement) } + ("updatedBy" to text("{user.uid}"))
  val doc = "orgs/{org.id}/pluginSettings/$pluginId"
  return kotlinx.serialization.json.JsonObject(
    mapOf(
      "id" to text("marketplace.pluginSettings.$pluginId"),
      "title" to text("$label settings"),
      "subtitle" to text("How $label behaves for this workspace"),
      "icon" to text("gearshape|settings"),
      "scope" to text("org"),
      "requires" to text("org.manager"),
      "constants" to kotlinx.serialization.json.JsonObject(mapOf("defaults" to kotlinx.serialization.json.JsonObject(defaults))),
      "load" to kotlinx.serialization.json.JsonObject(mapOf("settings" to kotlinx.serialization.json.JsonObject(mapOf("doc" to text(doc), "optional" to kotlinx.serialization.json.JsonPrimitive(true))))),
      "blocks" to kotlinx.serialization.json.JsonArray(
        listOf(
          kotlinx.serialization.json.JsonObject(
            mapOf(
              "type" to text("form"),
              "id" to text("settings"),
              "object" to text("data.settings"),
              "footer" to text("A site can override these on its own plugin page."),
              "fields" to kotlinx.serialization.json.JsonArray(controls),
              "submit" to kotlinx.serialization.json.JsonObject(
                mapOf(
                  "label" to text("Save settings"),
                  "write" to kotlinx.serialization.json.JsonObject(mapOf("doc" to text(doc), "fields" to kotlinx.serialization.json.JsonObject(written))),
                  "success" to text("Settings saved"),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  )
}
