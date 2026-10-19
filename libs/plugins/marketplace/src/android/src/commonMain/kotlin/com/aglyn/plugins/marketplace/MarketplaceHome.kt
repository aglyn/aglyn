package com.aglyn.plugins.marketplace

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.aglyn.core.FirestoreReader
import com.aglyn.core.mediaPreviewUrl
import com.aglyn.ui.RemoteImage
import com.aglyn.ui.StatusChip
import com.aglyn.ui.StatusTone
import com.aglyn.ui.space
import kotlinx.coroutines.CancellationException

/** How many listings each of the marketplace home's rows shows. */
internal const val HOME_ROW_SIZE = 8

/** The marketplace home's rows: the newest listings and the most installed, each by the browse's own order. */
internal data class MarketplaceHomeRows(val new: List<ListingRow>, val popular: List<ListingRow>)

/** Reads the home's two rows; a row that cannot load is left out rather than failing the page. */
internal suspend fun loadMarketplaceHome(firestore: FirestoreReader, viewerOrgId: String?): MarketplaceHomeRows {
  suspend fun row(sort: BrowseSort): List<ListingRow> = try {
    firestore.page(browseQuery(viewerOrgId, null, "", sort)).docs.map(ListingRow::from).filter(::isListingBrowsable).take(HOME_ROW_SIZE)
  } catch (error: Throwable) {
    if (error is CancellationException) throw error
    emptyList()
  }
  return MarketplaceHomeRows(new = row(BrowseSort.NEWEST), popular = row(BrowseSort.INSTALLED))
}

/** What a card's button says: a plugin is installed; a template, a component or a theme is used. */
internal fun cardActionLabel(artifactType: String): String = if (artifactType == "plugin") "Install" else "Use"

/**
 * The marketplace's home (the browse with no search and no category): "New" and "Popular" as rows of preview cards,
 * each opening its listing, its button opening the listing's own Install.
 */
@Composable
internal fun MarketplaceHome(firestore: FirestoreReader, viewerOrgId: String?, origin: String, onOpen: (String) -> Unit, onInstall: (String) -> Unit) {
  var rows by remember(viewerOrgId) { mutableStateOf<MarketplaceHomeRows?>(null) }
  LaunchedEffect(viewerOrgId, firestore) { rows = loadMarketplaceHome(firestore, viewerOrgId) }
  val loaded = rows ?: return
  Column(Modifier.fillMaxWidth().testTag("marketplace-home"), verticalArrangement = Arrangement.spacedBy(space(2f))) {
    HomeRow("New", "home-new", loaded.new, origin, onOpen, onInstall)
    HomeRow("Popular", "home-popular", loaded.popular, origin, onOpen, onInstall)
    if (loaded.new.isNotEmpty() || loaded.popular.isNotEmpty()) {
      Text("All listings", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(horizontal = space(2f)).semantics { heading() })
    }
  }
}

@Composable
private fun HomeRow(title: String, tag: String, listings: List<ListingRow>, origin: String, onOpen: (String) -> Unit, onInstall: (String) -> Unit) {
  if (listings.isEmpty()) return
  Column(verticalArrangement = Arrangement.spacedBy(space(1f))) {
    Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(horizontal = space(2f)).semantics { heading() })
    LazyRow(Modifier.testTag(tag), contentPadding = PaddingValues(horizontal = space(2f)), horizontalArrangement = Arrangement.spacedBy(space(1.5f))) {
      items(listings, key = { it.id }) { listing -> ListingCard(listing, origin, { onOpen(listing.id) }, { onInstall(listing.id) }) }
    }
  }
}

/** A listing's preview: its picture, its name and kind, its price, and Install or Use. */
@Composable
internal fun ListingCard(listing: ListingRow, origin: String, onOpen: () -> Unit, onInstall: () -> Unit, modifier: Modifier = Modifier.width(220.dp)) {
  Surface(
    shape = MaterialTheme.shapes.medium,
    color = MaterialTheme.colorScheme.surfaceContainerLowest,
    tonalElevation = 0.dp,
    shadowElevation = 1.dp,
    modifier = modifier.clip(MaterialTheme.shapes.medium).clickable(onClick = onOpen).testTag("card-${listing.id}"),
  ) {
    Column {
      RemoteImage(
        mediaPreviewUrl(listing.imageUrl, origin, null, 440),
        contentDescription = null,
        modifier = Modifier.fillMaxWidth().height(120.dp),
        icon = if (listing.artifactType == "plugin") "extension" else "widgets",
      )
      Column(Modifier.padding(space(1.5f)), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(listing.name, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(
          listOfNotNull(artifactLabel(listing.artifactType), listing.category?.let(::listingCategoryLabel)).joinToString(" · "),
          style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
          maxLines = 1,
          overflow = TextOverflow.Ellipsis,
        )
        Row(Modifier.fillMaxWidth().padding(top = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
          StatusChip(priceLabel(listing.priceUsd), if (listing.paid) StatusTone.INFO else StatusTone.SUCCESS)
          FilledTonalButton(onClick = onInstall, modifier = Modifier.testTag("card-install-${listing.id}")) { Text(cardActionLabel(listing.artifactType)) }
        }
      }
    }
  }
}
