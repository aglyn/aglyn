// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

package com.aglyn.plugins.marketplace

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import com.aglyn.contracts.Contracts
import com.aglyn.core.ApiMethod
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.Live
import com.aglyn.core.jsonBody
import com.aglyn.contracts.ListQueryRequest
import com.aglyn.core.listquery.planListQuery
import com.aglyn.core.listquery.toFirestoreQuery
import com.aglyn.core.mediaPreviewUrl
import com.aglyn.core.numberField
import com.aglyn.pluginhost.ActionRunner
import com.aglyn.pluginhost.LocalTemplateGalleryZone
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.pluginhost.TemplateGalleryShelfState
import com.aglyn.pluginhost.TemplateGalleryZone
import com.aglyn.ui.MediaThumb
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.OutlinedButton
import com.aglyn.ui.StatusChip
import com.aglyn.ui.StatusTone
import com.aglyn.ui.space

/*
 * Marketplace site templates in the template gallery (the console's `TemplateGalleryShelf`, the `templateGallery` zone,
 * AGL-137 and AGL-3080): published bundles with previews, searched by the gallery's search word, only where the gallery picks
 * pages (a five-page site on the components list would install pages nobody asked for). "Use template" installs through
 * `marketplace/install-template`, which lands the bundle in the site's library and publishes nothing. The Swift plugin's
 * TemplateGalleryShelf.swift draws the same.
 */

/** The name this shelf reports itself by to the gallery (`SHELF_ID`). */
internal const val TEMPLATE_SHELF_ID = "marketplace-site-templates"

/** The console route that installs a site template into a site's library. */
internal const val INSTALL_TEMPLATE_ROUTE = "/api/marketplace/install-template"

/** The shelf's query (`SITE_TEMPLATE_SHELF_QUERY` over `SITE_TEMPLATE_SHELF_BASE`), the gallery's search word folded in. */
fun templateShelfQuery(search: String, limit: Int): FirestoreQuery = planListQuery(
  Contracts.siteTemplateShelfQuery,
  ListQueryRequest(
    base = Contracts.siteTemplateShelfBase,
    clauses = emptyList(),
    search = search.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }.ifEmpty { null },
  ),
).toFirestoreQuery(LISTINGS, limit)

/** The facts under a template's name, as the console's card says them: its pages, its version, its price. */
fun templateShelfFacts(screenCount: Double?, version: String?, priceUsd: Double, buying: Boolean = true): String {
  val pages = screenCount?.let { com.aglyn.pluginhost.jsNumber(it) } ?: "?"
  // A build that may not take a payment ([com.aglyn.core.StoreBilling.buying] off: the store builds) says a paid template
  // is paid, not its price.
  val price = when {
    priceUsd <= 0 -> " · free"
    buying -> " · \$" + com.aglyn.pluginhost.jsNumber(priceUsd)
    else -> " · paid"
  }
  return "$pages pages · v${version.orEmpty()}$price"
}

/**
 * Whether the card offers "Use template": a paid template starts a purchase, which a build that may not take a payment
 * never offers (the owner's decision of 2026-11-19, [com.aglyn.core.StoreBilling]).
 */
fun templateShelfOffersUse(priceUsd: Double, buying: Boolean): Boolean = priceUsd <= 0 || buying

/** What a successful install says: the bundle went to the library, and nothing was published. */
fun templateInstalledMessage(added: Int, name: String): String =
  "Saved $added template${if (added == 1) "" else "s"} from \"$name\" to your library — open Templates to create pages from them."

/** How the shelf stands for the gallery, as the console's reports it. */
fun templateShelfState(offered: Boolean, loading: Boolean, visible: Boolean): TemplateGalleryShelfState = when {
  !offered -> TemplateGalleryShelfState.EMPTY
  loading -> TemplateGalleryShelfState.LOADING
  visible -> TemplateGalleryShelfState.SHOWN
  else -> TemplateGalleryShelfState.EMPTY
}

@Composable
internal fun TemplateGalleryShelf(context: NativePluginContext) {
  val zone = LocalTemplateGalleryZone.current ?: return
  val offered = zone.kind == "page"
  var limit by remember(zone.search) { mutableIntStateOf(BROWSE_PAGE_SIZE) }
  val live by remember(offered, zone.search, limit, context.firestore) {
    if (offered) context.firestore.observe(templateShelfQuery(zone.search, limit)) else kotlinx.coroutines.flow.flowOf(Live.Ready(emptyList()))
  }.collectAsState(Live.Loading)
  val docs = (live as? Live.Ready)?.value.orEmpty()
  // An unpublished listing keeps its document (`deletedAt`); it is dropped from the page it falls in.
  val rows = docs.filter { it.data["deletedAt"] == null }
  val hasMore = docs.size >= limit
  val state = templateShelfState(offered, live is Live.Loading, rows.isNotEmpty() || hasMore)
  LaunchedEffect(state) { zone.reportShelf(TEMPLATE_SHELF_ID, state) }
  if (!offered || state != TemplateGalleryShelfState.SHOWN) return
  val scope = rememberCoroutineScope()
  val runner = remember { ActionRunner(scope) }
  var installing by remember { mutableStateOf<String?>(null) }
  Column(Modifier.fillMaxWidth().padding(space(2f)).testTag("marketplace-template-shelf"), verticalArrangement = Arrangement.spacedBy(space(1.5f))) {
    Text("Marketplace templates", Modifier.semantics { heading() }, style = MaterialTheme.typography.titleMedium)
    runner.error?.let { NoticeBanner(it, StatusTone.ERROR) }
    rows.forEachIndexed { index, doc ->
      if (index > 0) HorizontalDivider()
      TemplateCard(context, doc, zone, installing, runner) { installing = it }
    }
    if (hasMore) OutlinedButton(onClick = { limit += BROWSE_PAGE_SIZE }) { Text("Show more templates") }
  }
}

@Composable
private fun TemplateCard(
  context: NativePluginContext,
  doc: FirestoreDoc,
  zone: TemplateGalleryZone,
  installing: String?,
  runner: ActionRunner,
  setInstalling: (String?) -> Unit,
) {
  val name = doc.string("displayName") ?: doc.id
  val version = doc.string("latestVersion") ?: (doc.data["latestVersion"] as? Number)?.let { com.aglyn.pluginhost.jsNumber(it.toDouble()) }
  Column(Modifier.fillMaxWidth().testTag("marketplace-template-${doc.id}"), verticalArrangement = Arrangement.spacedBy(space(1f))) {
    MediaThumb(
      mediaPreviewUrl(doc.string("previewImageUrl"), context.api.origin, null, 480),
      contentDescription = "$name preview",
      icon = "widgets",
      modifier = Modifier.fillMaxWidth().height(space(15f)),
    )
    Text(name, style = MaterialTheme.typography.titleMedium)
    doc.string("category")?.let { StatusChip(it, StatusTone.NEUTRAL) }
    doc.string("description")?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
    val price = (doc.data["priceUsd"] as? Number)?.toDouble() ?: 0.0
    val buying = com.aglyn.core.StoreBilling.buying
    Text(
      templateShelfFacts((doc.data["screenCount"] as? Number)?.toDouble(), version, price, buying),
      style = MaterialTheme.typography.bodySmall,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    if (templateShelfOffersUse(price, buying)) {
      Button(
        onClick = {
          setInstalling(doc.id)
          runner.run {
            try {
              val answer = context.api.request(INSTALL_TEMPLATE_ROUTE, ApiMethod.POST, jsonBody("listingId" to doc.id, "hostId" to zone.hostId))
              zone.onInstalled(templateInstalledMessage(answer.numberField("templates")?.toInt() ?: 0, name))
            } finally {
              setInstalling(null)
            }
          }
        },
        enabled = installing == null,
        modifier = Modifier.testTag("marketplace-template-use-${doc.id}"),
      ) { Text(if (installing == doc.id) "Installing…" else "Use template") }
    }
  }
}
