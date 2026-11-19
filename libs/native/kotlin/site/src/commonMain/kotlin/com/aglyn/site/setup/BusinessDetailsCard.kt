package com.aglyn.site.setup

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.KeyboardType
import com.aglyn.contracts.Contracts
import com.aglyn.core.rebased
import com.aglyn.pluginhost.ActionRunner
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.CountedTextField
import com.aglyn.ui.FormCard
import com.aglyn.ui.TextButton
import com.aglyn.ui.WithTooltip
import com.aglyn.ui.space

/**
 * Setup → Business profile's Business details card (`hostBusinessDetails`, AGL-4136): the one place a site's name, slogan,
 * phone, email, postal address and social links are entered, and every reader (the pages' variables, the email footer, the
 * documents, the structured data) takes them from there. The save is the console's: the canonical `seo.entity.*` paths,
 * the email and the formatted address kept in step in the older `business` copies, a cleared field deleted with its copy
 * ([businessDetailsPayload]). The Apple site lib's BusinessDetailsCard.swift.
 */
@Composable
internal fun BusinessDetailsCard(host: Map<String, Any?>, api: HostSettingsApi, canEdit: Boolean, draft: FormDraft) {
  val stored = remember(host) { businessDetailsForm(host) }
  val storedLinks = remember(host) { socialLinksOf(host) }
  val fields = remember { mutableStateMapOf<String, String>().apply { putAll(stored) } }
  val links = remember { mutableStateListOf<SocialLink>().apply { addAll(storedLinks) } }
  // A newer copy of the site keeps what was typed and moves every other field to it (AGL-4047).
  val seeded = remember { mutableStateOf(stored to storedLinks) }
  if (seeded.value != (stored to storedLinks)) {
    val nextFields = rebased(fields.toMap(), seeded.value.first, stored)
    val nextLinks = rebased(links.toList(), seeded.value.second, storedLinks)
    fields.clear()
    fields.putAll(nextFields)
    links.clear()
    links.addAll(nextLinks)
    seeded.value = stored to storedLinks
  }
  // What the SEO zone proposed for a field this card owns lands here as an unsaved edit, once.
  LaunchedEffect(draft.version) { fields.putAll(draft.take(BUSINESS_DETAILS_TEXT_PATHS)) }
  val scope = rememberCoroutineScope()
  val runner = remember { ActionRunner(scope) }
  val emailError = businessDetailsEmailError(fields["seo.entity.email"].orEmpty())
  val siteName = host.text("displayName").trim()
  val legacyAddress = businessDetailsLegacyAddress(fields, host)
  var showTokens by remember { mutableStateOf(false) }
  fun field(path: String) = fields[path].orEmpty()
  FormCard(
    title = "Business details",
    description = "Your business’s name and how to reach it. Your pages, emails, documents and search listings all use what you enter here. " +
      "The business type, opening hours and areas served are under SEO → Local business.",
    dirty = stored.any { (key, value) -> fields[key] != value } || links.toList() != storedLinks,
    canSave = canEdit && emailError == null,
    busy = runner.busy,
    error = runner.error,
    notice = runner.notice,
    onDiscard = {
      fields.putAll(stored)
      links.clear()
      links.addAll(storedLinks)
      runner.clear()
    },
    onSave = {
      val payload = businessDetailsPayload(fields.toMap(), links.toList(), host)
      runner.run("Saved.") { api.save(payload) }
    },
    modifier = Modifier.testTag("business-details"),
  ) {
    CountedTextField(
      "Business name", field("seo.entity.name"), { fields["seo.entity.name"] = it }, max = 200, enabled = canEdit,
      placeholder = siteName.ifEmpty { null },
      supporting = if (siteName.isEmpty()) "As customers know it. Leave it empty to use the site’s name" else "As customers know it. Leave it empty to use the site’s name, $siteName",
    )
    CountedTextField(
      "Slogan", field("seo.entity.slogan"), { fields["seo.entity.slogan"] = it }, max = Contracts.siteSloganMaxLength.toInt(), enabled = canEdit,
      supporting = "A short line about your business, shown wherever a page uses it",
    )
    CountedTextField(
      "Phone", field("seo.entity.telephone"), { fields["seo.entity.telephone"] = it }, max = 64, enabled = canEdit, keyboardType = KeyboardType.Phone,
      supporting = "As customers should dial it, e.g. +1 512-555-0100. A Call button links it with the Phone link variable",
    )
    CountedTextField(
      "Email", field("seo.entity.email"), { fields["seo.entity.email"] = it }, enabled = canEdit, keyboardType = KeyboardType.Email,
      error = emailError, supporting = "Where customers write to you",
    )
    CountedTextField(
      "Street", field("seo.entity.address.streetAddress"), { fields["seo.entity.address.streetAddress"] = it }, enabled = canEdit,
      supporting = legacyAddress?.let { "Your site shows “$it” now. Enter the address here to replace it" },
    )
    CountedTextField("City", field("seo.entity.address.addressLocality"), { fields["seo.entity.address.addressLocality"] = it }, enabled = canEdit)
    CountedTextField("State or region", field("seo.entity.address.addressRegion"), { fields["seo.entity.address.addressRegion"] = it }, enabled = canEdit)
    CountedTextField("Postal code", field("seo.entity.address.postalCode"), { fields["seo.entity.address.postalCode"] = it }, enabled = canEdit)
    CountedTextField(
      "Country", field("seo.entity.address.addressCountry"), { fields["seo.entity.address.addressCountry"] = it }, enabled = canEdit,
      supporting = "A country name, or its two-letter code",
    )
    Text("Social links", style = MaterialTheme.typography.labelLarge)
    links.forEachIndexed { index, link ->
      Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1f))) {
        OutlinedTextField(link.label, { links[index] = link.copy(label = it) }, label = { Text("Label") }, singleLine = true, enabled = canEdit, modifier = Modifier.weight(0.4f))
        OutlinedTextField(link.url, { links[index] = link.copy(url = it) }, label = { Text("URL") }, singleLine = true, enabled = canEdit, modifier = Modifier.weight(0.6f))
        WithTooltip("Remove ${link.label.ifBlank { "this link" }}") {
          IconButton(onClick = { links.removeAt(index) }, enabled = canEdit) {
            Icon(AglynIcons.named("delete"), contentDescription = "Remove ${link.label.ifBlank { "this link" }}")
          }
        }
      }
    }
    TextButton(onClick = { links.add(SocialLink("", "")) }, enabled = canEdit && links.size < SOCIAL_LINKS_MAX, modifier = Modifier.testTag("add-social-link")) {
      Icon(AglynIcons.named("add"), contentDescription = null)
      Text("Add a link", Modifier.padding(start = space(1f)))
    }
    Text(
      "Your pages can link each profile with the Facebook, Instagram, X, LinkedIn, YouTube and TikTok link variables, matched by its address.",
      style = MaterialTheme.typography.bodySmall,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    // What a page, a template or an email can use from this card, with the value it would produce, read from what is on
    // screen (the console's "Show what your pages can use"). A reference, not a field: it saves nothing.
    TextButton(onClick = { showTokens = !showTokens }, modifier = Modifier.testTag("business-tokens-toggle")) {
      Text(if (showTokens) "Hide what your pages can use" else "Show what your pages can use")
    }
    if (showTokens) {
      businessDetailsTokenRows(fields.toMap(), links.toList(), host).forEach { row ->
        Column(Modifier.fillMaxWidth()) {
          Text(row.token, style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace))
          Text(
            row.value ?: "not set on this site",
            style = MaterialTheme.typography.bodyMedium,
            color = if (row.set) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
          )
        }
      }
    }
  }
}
