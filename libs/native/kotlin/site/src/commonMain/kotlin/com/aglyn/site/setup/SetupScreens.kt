package com.aglyn.site.setup

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshots.SnapshotStateMap
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.aglyn.contracts.Contracts
import com.aglyn.contracts.TenantEmailControl
import com.aglyn.contracts.TenantEmailEntry
import com.aglyn.core.FirestoreDelete
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestoreOrder
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.Live
import com.aglyn.pluginhost.ActionRunner
import com.aglyn.pluginhost.ConsoleScope
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.ui.ActionDialog
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.AglynListDetail
import com.aglyn.ui.AglynListItem
import com.aglyn.ui.ChipOption
import com.aglyn.ui.ChoiceChipRow
import com.aglyn.ui.ColorField
import com.aglyn.ui.CountedTextField
import com.aglyn.ui.EmptyState
import com.aglyn.ui.FormCard
import com.aglyn.ui.ListHeader
import com.aglyn.ui.Load
import com.aglyn.ui.LoadContent
import com.aglyn.ui.MenuAction
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.OverflowMenu
import com.aglyn.ui.RemoteImage
import com.aglyn.ui.SectionCard
import com.aglyn.ui.SelectField
import com.aglyn.ui.SelectOption
import com.aglyn.ui.SkeletonList
import com.aglyn.ui.StatusChip
import com.aglyn.ui.StatusTone
import com.aglyn.ui.SwitchRow
import com.aglyn.ui.space
import kotlinx.coroutines.CancellationException

const val SITE_SETUP_SCREEN = "site.setup"

/** The site's theme page (`/theme`): the Theme section on its own. */
const val SITE_THEME_SCREEN = "site.theme"

/** Roles the rules let change the host document's settings (admin, editor, author). */
private val SETTINGS_ROLES = setOf("admin", "editor", "author")

/** The theme library's actions are an admin's or an editor's (`/api/hosts/theme`). */
private val THEME_LIBRARY_ROLES = setOf("admin", "editor")

/**
 * The site's setup as the console's Setup pages show it, the section beside
 * the list on wide windows: basic details, SEO, tracking, the theme and the
 * site's emails, every field saved the way the console saves it.
 */
@Composable
fun SetupScreen(context: NativePluginContext, initialSection: String? = null) {
  val hostId = context.hostId ?: return
  val host by remember(hostId, context.firestore) { context.firestore.observeDoc("hosts/$hostId") }.collectAsState(Live.Loading)
  val api = remember(hostId, context.api, context.writer) { HostSettingsApi(context.api, context.writer, hostId) }
  AglynListDetail(
    initialSelected = initialSection?.let { SetupSection.of(it).id },
    list = { selected, onSelect ->
      Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        ListHeader("Setup")
        SetupSection.entries.forEach { section ->
          AglynListItem(
            title = section.title,
            supporting = section.supporting,
            icon = AglynIcons.named(section.icon),
            selected = section.id == selected,
            onClick = { onSelect(section.id) },
            modifier = Modifier.testTag("setup-${section.id}"),
          )
        }
      }
    },
    detail = { selected ->
      if (selected == null) {
        EmptyState("Pick a section to set it up", icon = AglynIcons.named("settings"))
      } else {
        when (val live = host) {
          Live.Loading -> SkeletonList(rows = 8, modifier = Modifier.padding(space(2f)))
          is Live.Failed -> EmptyState("Could not load this site's setup", body = "Check the connection and try again.", icon = AglynIcons.named("error"))
          is Live.Ready -> {
            val doc = live.value ?: return@AglynListDetail EmptyState("This site is gone", icon = AglynIcons.named("public"))
            val canEdit = context.siteRole in SETTINGS_ROLES
            Column(
              Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(space(2f)).testTag("setup-detail-$selected"),
              verticalArrangement = Arrangement.spacedBy(space(2f)),
            ) {
              val section = SetupSection.of(selected)
              Text(section.title, Modifier.semantics { heading() }, style = MaterialTheme.typography.headlineSmall)
              if (!canEdit) NoticeBanner("You can view this site's setup. Changing it needs the author, editor or admin role.", StatusTone.INFO)
              when (section) {
                SetupSection.DETAILS -> DetailsSection(context, hostId, doc.data, api, canEdit)
                SetupSection.SEO -> SeoSection(doc.data, api, canEdit)
                SetupSection.TRACKING -> TrackingSection(doc.data, api, canEdit)
                SetupSection.THEME -> ThemeSection(context, hostId, doc.data, api, canEdit)
                SetupSection.EMAILS -> EmailsSection(context, hostId, api, canEdit)
              }
            }
          }
        }
      }
    },
  )
}

/** A card's fields, as text, re-read whenever what is stored changes. */
@Composable
private fun rememberFields(stored: Map<String, String>): SnapshotStateMap<String, String> =
  remember(stored) { mutableStateMapOf<String, String>().apply { putAll(stored) } }

private fun SnapshotStateMap<String, String>.dirty(stored: Map<String, String>) = stored.any { (key, value) -> this[key] != value }

@Composable
private fun rememberRunner(): ActionRunner {
  val scope = rememberCoroutineScope()
  return remember { ActionRunner(scope, roleHint = "an author, editor or admin") }
}

/** A text card over host fields: each path's text, saved through [settingsPayload]. */
@Composable
private fun HostTextCard(
  title: String,
  host: Map<String, Any?>,
  paths: List<String>,
  api: HostSettingsApi,
  canEdit: Boolean,
  description: String? = null,
  clearable: Set<String> = emptySet(),
  validate: (Map<String, String>) -> Boolean = { true },
  transform: (Map<String, String>) -> Map<String, Any?> = { it },
  content: @Composable (SnapshotStateMap<String, String>) -> Unit,
) {
  val stored = remember(host) { paths.associateWith { host.text(it) } }
  val fields = rememberFields(stored)
  val runner = rememberRunner()
  FormCard(
    title = title,
    description = description,
    dirty = fields.dirty(stored),
    canSave = canEdit && validate(fields),
    busy = runner.busy,
    error = runner.error,
    notice = runner.notice,
    onDiscard = { fields.putAll(stored); runner.clear() },
    onSave = { runner.run("Saved.") { api.save(settingsPayload(transform(fields.toMap()), host, clearable)) } },
  ) { content(fields) }
}

// --- Basic details --------------------------------------------------------

@Composable
private fun DetailsSection(context: NativePluginContext, hostId: String, host: Map<String, Any?>, api: HostSettingsApi, canEdit: Boolean) {
  HostTextCard(
    "Logo",
    host,
    listOf("logoUrl", "logoDarkUrl"),
    api,
    canEdit,
    description = "The brand mark your navigation and error pages show. Paste the address of an image from your media library.",
    clearable = setOf("logoUrl", "logoDarkUrl"),
  ) { fields ->
    for ((path, label) in listOf("logoUrl" to "Light mode logo", "logoDarkUrl" to "Dark mode logo")) {
      Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1.5f))) {
        RemoteImage(fields[path]?.takeIf { it.startsWith("http") }, null, Modifier.size(48.dp).clip(RoundedCornerShape(8.dp)), icon = "image")
        CountedTextField(label, fields[path].orEmpty(), { fields[path] = it }, Modifier.weight(1f), enabled = canEdit, keyboardType = KeyboardType.Uri, placeholder = "https://…")
      }
    }
  }
  BusinessDetailsCard(host, api, canEdit)
  BuiltInLayoutCard(context, hostId, host, api, canEdit)
  LanguagesCard(host, api, canEdit)
}

@Composable
private fun BusinessDetailsCard(host: Map<String, Any?>, api: HostSettingsApi, canEdit: Boolean) {
  val storedLinks = remember(host) { socialLinksOf(host) }
  val stored = remember(host) { mapOf("supportEmail" to host.text("business.supportEmail"), "address" to host.text("business.address")) }
  val fields = rememberFields(stored)
  val links = remember(storedLinks) { mutableStateListOf<SocialLink>().apply { addAll(storedLinks) } }
  val runner = rememberRunner()
  FormCard(
    title = "Business details",
    description = "The support email, address and social links your pages and footers show.",
    dirty = fields.dirty(stored) || links.toList() != storedLinks,
    canSave = canEdit,
    busy = runner.busy,
    error = runner.error,
    notice = runner.notice,
    onDiscard = { fields.putAll(stored); links.clear(); links.addAll(storedLinks); runner.clear() },
    onSave = {
      runner.run("Saved.") {
        api.replace(
          mapOf(
            "business" to mapOf(
              "supportEmail" to fields["supportEmail"].orEmpty().trim(),
              "address" to fields["address"].orEmpty().trim(),
              "socialLinks" to links.filter { it.url.isNotBlank() }.map { mapOf("label" to it.label.trim(), "url" to it.url.trim()) },
            ),
          ),
        )
      }
    },
  ) {
    CountedTextField("Support email", fields["supportEmail"].orEmpty(), { fields["supportEmail"] = it }, enabled = canEdit, keyboardType = KeyboardType.Email)
    CountedTextField("Postal address", fields["address"].orEmpty(), { fields["address"] = it }, enabled = canEdit, multiline = true)
    Text("Social links", style = MaterialTheme.typography.labelLarge)
    links.forEachIndexed { index, link ->
      Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1f))) {
        OutlinedTextField(link.label, { links[index] = link.copy(label = it) }, label = { Text("Label") }, singleLine = true, enabled = canEdit, modifier = Modifier.weight(0.4f))
        OutlinedTextField(link.url, { links[index] = link.copy(url = it) }, label = { Text("URL") }, singleLine = true, enabled = canEdit, modifier = Modifier.weight(0.6f))
        IconButton(onClick = { links.removeAt(index) }, enabled = canEdit) { Icon(AglynIcons.named("delete"), contentDescription = "Remove ${link.label.ifBlank { "this link" }}") }
      }
    }
    TextButton(onClick = { links.add(SocialLink("", "")) }, enabled = canEdit && links.size < SOCIAL_LINKS_MAX, modifier = Modifier.testTag("add-social-link")) {
      Icon(AglynIcons.named("add"), contentDescription = null)
      Text("Add a link", Modifier.padding(start = space(1f)))
    }
  }
}

@Composable
private fun BuiltInLayoutCard(context: NativePluginContext, hostId: String, host: Map<String, Any?>, api: HostSettingsApi, canEdit: Boolean) {
  val layouts by remember(hostId, context.firestore) {
    context.firestore.observe(FirestoreQuery("hosts/$hostId/layouts", limit = 50))
  }.collectAsState(Live.Loading)
  val options = (layouts as? Live.Ready)?.value.orEmpty()
    .filter { it.data["deletedAt"] == null }
    .map { SelectOption(it.id, it.string("displayName")?.ifBlank { null } ?: "Untitled layout") }
    .sortedBy { it.label.lowercase() }
  val runner = rememberRunner()
  SectionCard("Built-in pages") {
    Text("The layout your site's own pages (search, error fallbacks) wear.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    SelectField(
      "Layout",
      options,
      host.text("builtInPageLayoutId").ifEmpty { null },
      { picked -> runner.run("Saved.") { api.replace(mapOf("builtInPageLayoutId" to (picked ?: FirestoreDelete))) } },
      enabled = canEdit && !runner.busy,
      noneLabel = "Same as the home page",
    )
    runner.error?.let { NoticeBanner(it, StatusTone.ERROR) }
  }
}

@Composable
private fun LanguagesCard(host: Map<String, Any?>, api: HostSettingsApi, canEdit: Boolean) {
  val storedLocales = remember(host) { (host["locales"] as? List<*>)?.filterIsInstance<String>().orEmpty() }
  val storedDefault = host.text("defaultLocale")
  var text by remember(storedLocales) { mutableStateOf(storedLocales.joinToString(", ")) }
  var chosen by remember(storedDefault) { mutableStateOf(storedDefault.ifEmpty { null }) }
  val (parsed, error) = parseLocales(text)
  val runner = rememberRunner()
  FormCard(
    title = "Languages",
    description = "The languages your site serves. Each one gets its own addresses (/fr/…); the default answers the plain ones. More than one language needs the Business plan.",
    dirty = parsed != storedLocales || (chosen ?: "") != storedDefault,
    canSave = canEdit && error == null,
    busy = runner.busy,
    error = runner.error,
    notice = runner.notice,
    onDiscard = { text = storedLocales.joinToString(", "); chosen = storedDefault.ifEmpty { null }; runner.clear() },
    onSave = {
      runner.run("Saved.") {
        val default = chosen?.takeIf { it in parsed } ?: parsed.firstOrNull()
        api.replace(mapOf("locales" to parsed.ifEmpty { null } ?: FirestoreDelete, "defaultLocale" to (default ?: FirestoreDelete)))
      }
    },
  ) {
    CountedTextField("Languages", text, { text = it }, enabled = canEdit, error = error, supporting = "Comma separated, like en, fr, pt-BR", placeholder = "en")
    SelectField("Default", parsed.map { SelectOption(it, it) }, chosen?.takeIf { it in parsed } ?: parsed.firstOrNull(), { chosen = it }, enabled = canEdit && parsed.isNotEmpty())
  }
}

// --- SEO ------------------------------------------------------------------

@Composable
private fun SeoSection(host: Map<String, Any?>, api: HostSettingsApi, canEdit: Boolean) {
  val c = Contracts
  HostTextCard(
    "Search appearance",
    host,
    listOf("seo.title", "seo.description", "seo.separator", "seo.titlePattern"),
    api,
    canEdit,
    description = "How your site reads in search results and link previews.",
    clearable = setOf("seo.titlePattern"),
    validate = { f -> listOf("seo.title", "seo.description", "seo.separator").all { !f[it].isNullOrBlank() } },
  ) { f ->
    CountedTextField("Title", f["seo.title"].orEmpty(), { f["seo.title"] = it }, max = SeoLimits.TITLE, required = true, enabled = canEdit)
    CountedTextField("Description", f["seo.description"].orEmpty(), { f["seo.description"] = it }, max = SeoLimits.DESCRIPTION, required = true, multiline = true, minLines = 2, enabled = canEdit)
    CountedTextField("Separator", f["seo.separator"].orEmpty(), { f["seo.separator"] = it }, max = SeoLimits.SEPARATOR, required = true, enabled = canEdit)
    CountedTextField(
      "Page title pattern",
      f["seo.titlePattern"].orEmpty(),
      { f["seo.titlePattern"] = it },
      max = SeoLimits.TITLE_PATTERN,
      enabled = canEdit,
      placeholder = c.defaultTitlePattern,
      supporting = "Empty uses ${c.defaultTitlePattern}",
    )
  }
  HostTextCard(
    "Icons and social image",
    host,
    listOf("seo.favicon", "seo.appIcon", "seo.image", "seo.imageAlt"),
    api,
    canEdit,
    description = "Paste the address of each image from your media library.",
  ) { f ->
    for ((path, label) in listOf("seo.favicon" to "Favicon", "seo.appIcon" to "App icon", "seo.image" to "Social image")) {
      Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1.5f))) {
        RemoteImage(f[path]?.takeIf { it.startsWith("http") }, null, Modifier.size(40.dp).clip(RoundedCornerShape(8.dp)), icon = "image")
        CountedTextField(label, f[path].orEmpty(), { f[path] = it }, Modifier.weight(1f), enabled = canEdit, keyboardType = KeyboardType.Uri, placeholder = "https://…")
      }
    }
    CountedTextField("Image description", f["seo.imageAlt"].orEmpty(), { f["seo.imageAlt"] = it }, max = SeoLimits.IMAGE_ALT, enabled = canEdit, supporting = "What the social image shows, for screen readers")
  }
  val entityPaths = listOf("seo.entity.type", "seo.entity.name", "seo.entity.description", "seo.entity.url", "seo.entity.email", "seo.entity.telephone", "seo.entity.contactType", "seo.entity.logo")
  HostTextCard("Business profile", host, entityPaths, api, canEdit, description = "Who runs the site, as search engines read it.") { f ->
    SelectField("This site is run by", ENTITY_TYPES.map { SelectOption(it.first, it.second) }, f["seo.entity.type"]?.ifEmpty { null }, { f["seo.entity.type"] = it.orEmpty() }, enabled = canEdit, noneLabel = "Not set")
    CountedTextField("Name", f["seo.entity.name"].orEmpty(), { f["seo.entity.name"] = it }, enabled = canEdit)
    CountedTextField("Description", f["seo.entity.description"].orEmpty(), { f["seo.entity.description"] = it }, max = SeoLimits.ENTITY_DESCRIPTION, multiline = true, enabled = canEdit)
    CountedTextField("Website", f["seo.entity.url"].orEmpty(), { f["seo.entity.url"] = it }, enabled = canEdit, keyboardType = KeyboardType.Uri)
    CountedTextField("Email", f["seo.entity.email"].orEmpty(), { f["seo.entity.email"] = it }, enabled = canEdit, keyboardType = KeyboardType.Email)
    CountedTextField("Telephone", f["seo.entity.telephone"].orEmpty(), { f["seo.entity.telephone"] = it }, enabled = canEdit, keyboardType = KeyboardType.Phone)
    CountedTextField("Contact type", f["seo.entity.contactType"].orEmpty(), { f["seo.entity.contactType"] = it }, enabled = canEdit, placeholder = "customer service")
    CountedTextField("Logo", f["seo.entity.logo"].orEmpty(), { f["seo.entity.logo"] = it }, enabled = canEdit, keyboardType = KeyboardType.Uri, placeholder = "https://…")
  }
  val addressPaths = listOf("streetAddress" to "Street", "addressLocality" to "City", "addressRegion" to "Region", "postalCode" to "Postal code", "addressCountry" to "Country")
  HostTextCard("Business address", host, addressPaths.map { "seo.entity.address.${it.first}" }, api, canEdit) { f ->
    for ((key, label) in addressPaths) {
      val path = "seo.entity.address.$key"
      CountedTextField(label, f[path].orEmpty(), { f[path] = it }, enabled = canEdit)
    }
  }
  LocalBusinessCard(host, api, canEdit)
  HostTextCard(
    "AI agents",
    host,
    listOf("seo.agent.whenToUse", "seo.agent.howToUse"),
    api,
    canEdit,
    description = "What AI assistants read about when and how to send people to your site (llms.txt).",
  ) { f ->
    CountedTextField("When to use this site", f["seo.agent.whenToUse"].orEmpty(), { f["seo.agent.whenToUse"] = it }, max = SeoLimits.AGENT, multiline = true, enabled = canEdit)
    CountedTextField("How to use this site", f["seo.agent.howToUse"].orEmpty(), { f["seo.agent.howToUse"] = it }, max = SeoLimits.AGENT, multiline = true, enabled = canEdit)
  }
  VerificationCard(host, api, canEdit)
  val discourage = host.at("seo.discourageSearchEngines") == true
  val runner = rememberRunner()
  SectionCard("Search indexing") {
    SwitchRow(
      "Discourage search engines from indexing this site",
      discourage,
      { on -> runner.run { api.save(mapOf("seo" to mapOf("discourageSearchEngines" to if (on) true else FirestoreDelete))) } },
      supporting = "Search engines may still index it; most respect the request.",
      enabled = canEdit && !runner.busy,
      modifier = Modifier.testTag("seo-discourage"),
    )
    runner.error?.let { NoticeBanner(it, StatusTone.ERROR) }
  }
}

@Composable
private fun LocalBusinessCard(host: Map<String, Any?>, api: HostSettingsApi, canEdit: Boolean) {
  val c = Contracts
  val storedArea = remember(host) { (host.at("seo.entity.areaServed") as? List<*>)?.filterIsInstance<String>().orEmpty() }
  val stored = remember(host) {
    mapOf(
      "seo.entity.businessType" to host.text("seo.entity.businessType"),
      "areaServed" to storedArea.joinToString("\n"),
      "seo.entity.openingHours" to host.text("seo.entity.openingHours"),
      "seo.entity.priceRange" to host.text("seo.entity.priceRange"),
      "seo.entity.paymentAccepted" to host.text("seo.entity.paymentAccepted"),
    )
  }
  val f = rememberFields(stored)
  val runner = rememberRunner()
  val area = f["areaServed"].orEmpty().lines().map { it.trim() }.filter { it.isNotEmpty() }
  FormCard(
    title = "Local business",
    description = "For a business customers visit or that serves an area: its kind, where it works and when it is open.",
    dirty = f.dirty(stored),
    canSave = canEdit && area.size <= c.areaServedMax,
    busy = runner.busy,
    error = runner.error,
    notice = runner.notice,
    onDiscard = { f.putAll(stored); runner.clear() },
    onSave = {
      runner.run("Saved.") { api.save(settingsPayload(f.toMap() - "areaServed" + ("seo.entity.areaServed" to area), host)) }
    },
  ) {
    SelectField(
      "Kind of business",
      c.localBusinessTypeOptions.map { SelectOption(it.value, it.label) },
      f["seo.entity.businessType"]?.ifEmpty { null },
      { f["seo.entity.businessType"] = it.orEmpty() },
      enabled = canEdit,
      noneLabel = "Not a local business",
    )
    if (!f["seo.entity.businessType"].isNullOrEmpty()) {
      CountedTextField(
        "Areas served",
        f["areaServed"].orEmpty(),
        { f["areaServed"] = it },
        multiline = true,
        enabled = canEdit,
        supporting = "One place per line, up to ${c.areaServedMax}",
        error = if (area.size > c.areaServedMax) "At most ${c.areaServedMax} places" else null,
      )
      CountedTextField("Opening hours", f["seo.entity.openingHours"].orEmpty(), { f["seo.entity.openingHours"] = it }, multiline = true, enabled = canEdit, supporting = "One line per day or range, like Mo-Fr 09:00-17:00")
      CountedTextField("Price range", f["seo.entity.priceRange"].orEmpty(), { f["seo.entity.priceRange"] = it }, max = c.priceRangeMaxLength.toInt(), enabled = canEdit, placeholder = "$$")
      CountedTextField("Payment accepted", f["seo.entity.paymentAccepted"].orEmpty(), { f["seo.entity.paymentAccepted"] = it }, max = c.paymentAcceptedMaxLength.toInt(), enabled = canEdit, placeholder = "Cash, Credit Card")
    }
  }
}

@Composable
private fun VerificationCard(host: Map<String, Any?>, api: HostSettingsApi, canEdit: Boolean) {
  val c = Contracts
  val engines = listOf("google", "bing")
  HostTextCard(
    "Search engine verification",
    host,
    engines.map { "seo.verification.$it" },
    api,
    canEdit,
    description = "Paste the verification code, or the whole meta tag, from each tool.",
    clearable = engines.map { "seo.verification.$it" }.toSet(),
    validate = { f -> engines.all { verificationError(it, f["seo.verification.$it"], c.searchEngineVerificationMetaNames, c.searchEngineVerificationLabels) == null } },
    transform = { f -> f.mapValues { (_, value) -> extractVerificationToken(value) } },
  ) { f ->
    for (engine in engines) {
      val path = "seo.verification.$engine"
      CountedTextField(
        c.searchEngineVerificationLabels[engine] ?: engine,
        f[path].orEmpty(),
        { f[path] = it },
        enabled = canEdit,
        error = verificationError(engine, f[path], c.searchEngineVerificationMetaNames, c.searchEngineVerificationLabels),
      )
    }
  }
}

// --- Tracking -------------------------------------------------------------

@Composable
private fun TrackingSection(host: Map<String, Any?>, api: HostSettingsApi, canEdit: Boolean) {
  HostTextCard(
    "Analytics and ad tags",
    host,
    TRACKING_FIELDS.map { it.path },
    api,
    canEdit,
    description = "The IDs your pages load analytics and ad tags with, after a visitor allows it.",
    clearable = TRACKING_FIELDS.map { it.path }.toSet(),
    validate = { f -> TRACKING_FIELDS.all { trackingError(it, f[it.path].orEmpty()) == null } },
  ) { f ->
    for (field in TRACKING_FIELDS) {
      CountedTextField(field.label, f[field.path].orEmpty(), { f[field.path] = it }, enabled = canEdit, placeholder = field.example, error = trackingError(field, f[field.path].orEmpty()))
    }
  }
  val runner = rememberRunner()
  val asks = host.at("consent.disabled") != true
  val mode = consentMode(host)
  val advertising = host.at("consent.advertising") == true
  val hasAnalytics = host.text("analytics.gaMeasurementId").isNotBlank()
  SectionCard("Consent banner") {
    SwitchRow(
      "Ask visitors for consent before loading analytics",
      asks,
      { on -> runner.run { api.save(mapOf("consent" to mapOf("disabled" to if (on) FirestoreDelete else true))) } },
      enabled = canEdit && !runner.busy,
      modifier = Modifier.testTag("consent-asks"),
    )
    if (asks) {
      Text("Who is asked", style = MaterialTheme.typography.labelLarge)
      for ((value, label, supporting) in listOf(
        Triple("geo", "Where the law requires it", "Visitors from regions with consent laws are asked; others are not."),
        Triple("strict", "Everyone", "Every visitor is asked before anything loads."),
      )) {
        AglynListItem(
          title = label,
          supporting = supporting,
          trailing = { RadioButton(selected = mode == value, onClick = null) },
          onClick = if (canEdit && !runner.busy && mode != value) ({ runner.run { api.save(mapOf("consent" to mapOf("mode" to value))) } }) else null,
          modifier = Modifier.testTag("consent-mode-$value"),
        )
      }
      SwitchRow(
        "Ask about advertising too",
        advertising,
        { on -> runner.run { api.save(mapOf("consent" to mapOf("advertising" to if (on) true else FirestoreDelete))) } },
        supporting = if (hasAnalytics) "Adds an advertising choice for Google's ad features." else "Set a Google Analytics ID first.",
        enabled = canEdit && hasAnalytics && !runner.busy,
      )
    }
    runner.error?.let { NoticeBanner(it, StatusTone.ERROR) }
  }
}

// --- Theme ----------------------------------------------------------------

@Composable
private fun ThemeSection(context: NativePluginContext, hostId: String, host: Map<String, Any?>, api: HostSettingsApi, canEdit: Boolean) {
  ThemeLibraryCard(context, hostId, host, api, context.siteRole in THEME_LIBRARY_ROLES)
  ThemeEditorCard(api, canEdit, hostVersion = host["themeOverride"])
}

@Composable
private fun ThemeLibraryCard(context: NativePluginContext, hostId: String, host: Map<String, Any?>, api: HostSettingsApi, canManage: Boolean) {
  val selection = themeSelectionOf(host)
  val edited = hasThemeEdits(host)
  val saved by remember(hostId, context.firestore) {
    context.firestore.observe(FirestoreQuery("hosts/$hostId/themes", orderBy = listOf(FirestoreOrder("__name__")), limit = THEME_LIBRARY_MAX_CUSTOM + 1))
  }.collectAsState(Live.Loading)
  val runner = rememberRunner()
  var naming by remember { mutableStateOf<Pair<String?, String>?>(null) }
  var deleting by remember { mutableStateOf<SavedTheme?>(null) }
  SectionCard("Your theme") {
    Row(verticalAlignment = Alignment.CenterVertically) {
      Column(Modifier.weight(1f)) {
        Text(selection.name ?: if (selection.kind == "default") "Default theme" else "Custom theme", style = MaterialTheme.typography.titleMedium)
        Text(
          when (selection.kind) {
            "preset" -> "A built-in theme"
            "custom" -> "One of your saved themes"
            "installed" -> "Installed from the marketplace"
            else -> "The platform's own theme"
          } + if (edited) " · with your edits" else "",
          style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
      }
      OverflowMenu(
        listOf(
          MenuAction("save-as", "Save as a custom theme", "content_copy", enabled = canManage) { naming = null to "" },
          MenuAction("update", "Update the saved theme", "check", enabled = canManage && edited && selection.kind == "custom") { runner.run("The saved theme now has your edits.") { api.updateSavedTheme() } },
          MenuAction("restore", "Undo all edits", "undo", enabled = canManage && edited) { runner.run("Edits undone.") { api.restoreTheme() } },
          MenuAction("default", "Use the default theme", "refresh", enabled = canManage && selection.kind != "default") { runner.run("Switched to the default theme.") { api.selectTheme("default") } },
        ),
      )
    }
    runner.error?.let { NoticeBanner(it, StatusTone.ERROR) }
    runner.notice?.let { NoticeBanner(it, StatusTone.SUCCESS) }
    Text("Saved themes", style = MaterialTheme.typography.labelLarge)
    when (val live = saved) {
      Live.Loading -> SkeletonList(rows = 2)
      is Live.Failed -> Text("Saved themes could not be loaded.", color = MaterialTheme.colorScheme.onSurfaceVariant)
      is Live.Ready -> {
        val themes = live.value.map(::savedThemeOf)
        if (themes.isEmpty()) Text("None yet. Save your theme to switch back to it later.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        themes.forEachIndexed { index, theme ->
          if (index > 0) HorizontalDivider()
          val current = selection.kind == "custom" && selection.id == theme.id
          AglynListItem(
            title = theme.name,
            icon = AglynIcons.named("palette"),
            trailing = {
              Row(verticalAlignment = Alignment.CenterVertically) {
                if (current) StatusChip("In use", StatusTone.SUCCESS)
                else TextButton(onClick = { runner.run("Switched to ${theme.name}.") { api.selectTheme("custom", theme.id) } }, enabled = canManage && !runner.busy) { Text("Use") }
                OverflowMenu(
                  listOf(
                    MenuAction("rename", "Rename", "edit", enabled = canManage) { naming = theme.id to theme.name },
                    MenuAction("delete", "Delete", "delete", destructive = true, enabled = canManage && !current) { deleting = theme },
                  ),
                )
              }
            },
            modifier = Modifier.testTag("saved-theme-${theme.id}"),
          )
        }
      }
    }
  }
  naming?.let { (id, initial) ->
    var name by remember(naming) { mutableStateOf(initial) }
    ActionDialog(
      title = if (id == null) "Save as a custom theme" else "Rename theme",
      icon = "palette",
      confirmLabel = "Save",
      confirmEnabled = name.isNotBlank(),
      busy = runner.busy,
      error = runner.error,
      onDismiss = { naming = null },
      onConfirm = { runner.run("Saved.", onDone = { naming = null }) { if (id == null) api.saveThemeAs(name) else api.renameTheme(id, name) } },
    ) {
      OutlinedTextField(name, { name = it.take(THEME_NAME_MAX) }, label = { Text("Name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
    }
  }
  deleting?.let { theme ->
    ActionDialog(
      title = "Delete ${theme.name}?",
      body = "Your site keeps its current look.",
      icon = "delete",
      confirmLabel = "Delete",
      destructive = true,
      busy = runner.busy,
      error = runner.error,
      onDismiss = { deleting = null },
      onConfirm = { runner.run("Deleted.", onDone = { deleting = null }) { api.deleteTheme(theme.id) } },
    )
  }
}

@Composable
private fun ThemeEditorCard(api: HostSettingsApi, canEdit: Boolean, hostVersion: Any?) {
  var load by remember { mutableStateOf<Load<Pair<ThemeCatalog, ThemeValues>>>(Load.Loading) }
  var attempt by remember { mutableStateOf(0) }
  LaunchedEffect(attempt, hostVersion) {
    load = try {
      Load.Ready(api.themeEditor())
    } catch (error: Throwable) {
      if (error is CancellationException) throw error
      Load.Failed(error.message ?: "The theme could not be loaded.")
    }
  }
  LoadContent(load, onRetry = { attempt++ }, failedTitle = "Could not load the theme", modifier = Modifier.fillMaxWidth()) { (catalog, stored) ->
    var draft by remember(stored) { mutableStateOf(stored) }
    var scheme by remember { mutableStateOf(catalog.schemes.firstOrNull() ?: "light") }
    val runner = rememberRunner()
    val edits = themeEdits(stored, draft)
    val colorErrors = draft.colors.values.flatMap { it.values }.any { value -> !value.isNullOrBlank() && com.aglyn.ui.parseHexColor(value) == null }
    FormCard(
      title = "Theme editor",
      description = "Changes apply to every page once saved. Clear a color to use the theme's own.",
      dirty = edits.isNotEmpty(),
      canSave = canEdit && !colorErrors,
      busy = runner.busy,
      error = runner.error,
      notice = runner.notice,
      onDiscard = { draft = stored; runner.clear() },
      onSave = { runner.run("Theme saved.") { api.saveTheme(edits) } },
    ) {
      ChoiceChipRow(catalog.schemes.map { ChipOption(it, it.replaceFirstChar { c -> c.uppercase() }) }, scheme, { scheme = it })
      val groups = linkedMapOf("palette" to "Colors", "surface" to "Background and text", "tint" to "Tints", "divider" to "Lines")
      for ((group, label) in groups) {
        val controls = catalog.colors.filter { it.group == group }
        if (controls.isEmpty()) continue
        Text(label, style = MaterialTheme.typography.labelLarge)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
          for (control in controls) {
            ColorField(
              control.label,
              draft.colors[scheme]?.get(control.token).orEmpty(),
              { hex ->
                val schemeColors = (draft.colors[scheme] ?: emptyMap()) + (control.token to hex.ifBlank { null })
                draft = draft.copy(colors = draft.colors + (scheme to schemeColors))
              },
              Modifier.fillMaxWidth(),
              enabled = canEdit,
            )
          }
        }
      }
      HorizontalDivider()
      SelectField(catalog.darkSchemeLabel, catalog.darkSchemeOptions.map { SelectOption(it.first, it.second) }, draft.darkScheme, { draft = draft.copy(darkScheme = it ?: "auto") }, enabled = canEdit)
      SelectField(
        "Font family",
        listOf(SelectOption(catalog.systemFont, "The theme's own")) + catalog.fonts.map { SelectOption(it.family, it.family, it.category) },
        draft.fontFamily,
        { draft = draft.copy(fontFamily = it ?: catalog.systemFont) },
        enabled = canEdit,
      )
      NumberField(catalog.borderRadius, draft.borderRadius, canEdit) { draft = draft.copy(borderRadius = it) }
      NumberField(catalog.spacing, draft.spacing, canEdit) { draft = draft.copy(spacing = it) }
      NumberField(catalog.navHeightXs, draft.navHeightXs, canEdit) { draft = draft.copy(navHeightXs = it) }
      NumberField(catalog.navHeightSm, draft.navHeightSm, canEdit) { draft = draft.copy(navHeightSm = it) }
    }
  }
}

private fun formatNumber(value: Double?): String = value?.let { if (it == it.toLong().toDouble()) it.toLong().toString() else it.toString() }.orEmpty()

@Composable
private fun NumberField(range: ThemeRange, value: Double?, enabled: Boolean, onValue: (Double?) -> Unit) {
  var text by remember(value) { mutableStateOf(formatNumber(value)) }
  val parsed = text.trim().toDoubleOrNull()
  val error = when {
    text.isBlank() -> null
    parsed == null -> "Use a number"
    parsed < range.min || parsed > range.max -> "From ${range.min} to ${range.max}"
    else -> null
  }
  CountedTextField(
    range.label,
    text,
    { next ->
      text = next
      val number = next.trim().toDoubleOrNull()
      if (next.isBlank()) onValue(null) else if (number != null && number >= range.min && number <= range.max) onValue(number)
    },
    enabled = enabled,
    error = error,
    supporting = "${range.min}–${range.max}; empty uses the theme's own",
    keyboardType = KeyboardType.Number,
  )
}

// --- Emails ---------------------------------------------------------------

@Composable
private fun EmailsSection(context: NativePluginContext, hostId: String, api: HostSettingsApi, canEdit: Boolean) {
  val templates by remember(hostId, context.firestore) {
    context.firestore.observe(FirestoreQuery("hosts/$hostId/${Contracts.tenantEmailCollection}", limit = 100))
  }.collectAsState(Live.Loading)
  val org by remember(context.orgId, context.firestore) { context.firestore.observeDoc("orgs/${context.orgId}") }.collectAsState(Live.Loading)
  val enabled = ((org as? Live.Ready)?.value?.data?.get("enabledPlugins") as? List<*>)?.filterIsInstance<String>()
  val stored: Map<String, FirestoreDoc> = (templates as? Live.Ready)?.value.orEmpty().associateBy { it.id }
  val runner = rememberRunner()
  var resetting by remember { mutableStateOf<TenantEmailEntry?>(null) }
  Text(
    "The emails your site sends customers. A customized email uses your design; the rest send their default.",
    style = MaterialTheme.typography.bodyMedium,
    color = MaterialTheme.colorScheme.onSurfaceVariant,
  )
  runner.error?.let { NoticeBanner(it, StatusTone.ERROR) }
  runner.notice?.let { NoticeBanner(it, StatusTone.SUCCESS) }
  for ((plugin, rows) in Contracts.tenantEmails.groupBy { it.plugin ?: "Other" }) {
    val pluginOn = enabled == null || rows.first().pluginId in enabled
    SectionCard(plugin) {
      if (!pluginOn) Text("Turn on the $plugin plugin to send these.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
      rows.forEachIndexed { index, entry ->
        if (index > 0) HorizontalDivider()
        val doc = stored[entry.key]
        val versionId = doc?.string("versionId")?.ifBlank { null }
        AglynListItem(
          title = entry.name ?: entry.key.orEmpty(),
          supporting = entry.description,
          icon = AglynIcons.named("mail"),
          trailing = {
            Row(verticalAlignment = Alignment.CenterVertically) {
              when {
                entry.control == TenantEmailControl.EXTERNAL -> StatusChip("Edited in ${entry.authoredIn ?: "its plugin"}", StatusTone.NEUTRAL)
                entry.control == TenantEmailControl.FIXED -> StatusChip("Not customizable yet", StatusTone.NEUTRAL)
                versionId != null -> {
                  StatusChip("Customized", StatusTone.SUCCESS)
                  TextButton(
                    onClick = { context.openBesigner("/emails/${entry.key}/versions/$versionId/besigner", ConsoleScope.SITE) },
                    enabled = pluginOn,
                  ) { Text("Edit") }
                  OverflowMenu(listOf(MenuAction("reset", "Reset to default", "undo", destructive = true, enabled = canEdit && pluginOn) { resetting = entry }))
                }
                else -> StatusChip("Default", StatusTone.NEUTRAL)
              }
            }
          },
          modifier = Modifier.testTag("email-${entry.key}"),
        )
      }
    }
  }
  resetting?.let { entry ->
    ActionDialog(
      title = "Reset ${entry.name}?",
      body = "It sends the default design again. Your design stays in its version history.",
      icon = "undo",
      confirmLabel = "Reset",
      destructive = true,
      busy = runner.busy,
      error = runner.error,
      onDismiss = { resetting = null },
      onConfirm = { runner.run("${entry.name} sends its default again.", onDone = { resetting = null }) { api.resetEmail(entry.key.orEmpty()) } },
    )
  }
}
