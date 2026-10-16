package com.aglyn.plugins.marketplace

import com.aglyn.contracts.InstallTarget
import com.aglyn.core.FilterOp
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestoreFilter
import com.aglyn.core.FirestoreOrder
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class MarketplaceTest {
  @Test
  fun browseAsksWhatTheWorkspaceMaySeeWithTheSearchFolded() {
    val plain = browseQuery("org1", null, "", BrowseSort.NEWEST)
    assertEquals("marketplaceListings", plain.collectionPath)
    assertEquals(listOf(FirestoreFilter("browseAudience", FilterOp.ARRAY_CONTAINS_ANY, listOf("*", "org1"))), plain.filters)
    assertEquals(listOf(FirestoreOrder("createdAt", descending = true)), plain.orderBy)
    val searched = browseQuery("org1", "seo", "count", BrowseSort.INSTALLED)
    assertTrue(FirestoreFilter("browseTokens", FilterOp.ARRAY_CONTAINS_ANY, listOf("*~count", "org1~count")) in searched.filters, searched.filters.toString())
    assertTrue(FirestoreFilter("category", FilterOp.EQ, "seo") in searched.filters)
    assertEquals(listOf(FirestoreOrder("installCount", descending = true)), searched.orderBy)
  }

  @Test
  fun readsAListingAsBrowseShowsIt() {
    val row = ListingRow.from(
      FirestoreDoc(
        "l1",
        "marketplaceListings/l1",
        mapOf("displayName" to "Promo Countdown", "type" to "plugin", "priceUsd" to 12L, "latestVersion" to "1.1.0", "latestApprovedVersion" to "1.0.0", "ratingAverage" to 4.5, "ratingCount" to 2L),
      ),
    )
    assertEquals("plugin", row.artifactType)
    assertEquals("1.0.0", row.offeredVersion)
    assertEquals("$12", priceLabel(row.priceUsd))
    assertEquals("4.5 ★ (2)", ratingLabel(row))
    assertEquals(listOf(InstallTarget.ORG, InstallTarget.HOST), installTargets("plugin"))
    assertEquals(listOf(InstallTarget.HOST), installTargets("template"))
  }

  @Test
  fun licencesAreTheWorkspacesLivePurchases() {
    val query = licencesQuery("org1")
    assertEquals("marketplacePurchases", query.collectionPath)
    assertTrue(FirestoreFilter("buyerOrgId", FilterOp.EQ, "org1") in query.filters)
    assertTrue(FirestoreFilter("refundedAt", FilterOp.EQ, null) in query.filters)
  }

  @Test
  fun boughtByYouIsYourOwnLivePurchasesNarrowedToTheWorkspaceEachLandedIn() {
    val all = boughtByYouQuery("u1", null)
    assertEquals("marketplacePurchases", all.collectionPath)
    assertTrue(FirestoreFilter("buyerUid", FilterOp.EQ, "u1") in all.filters)
    assertTrue(FirestoreFilter("refundedAt", FilterOp.EQ, null) in all.filters)
    assertTrue(all.filters.none { it.field == "buyerOrgId" })
    assertTrue(FirestoreFilter("buyerOrgId", FilterOp.EQ, "o2") in boughtByYouQuery("u1", "o2").filters)
    // "Every workspace you belong to" is a purchase that names none.
    assertTrue(boughtByYouQuery("u1", EVERY_WORKSPACE).filters.any { it.field == "buyerOrgId" && it.value !is String })

    val mine = LicenceRow.from(FirestoreDoc("p1", "marketplacePurchases/p1", mapOf("listingId" to "l1", "buyerUid" to "u1", "buyerOrgId" to "o1", "amountCents" to 1081L, "taxCents" to 81L)))
    val theirs = LicenceRow.from(FirestoreDoc("p2", "marketplacePurchases/p2", mapOf("listingId" to "l1", "buyerUid" to "u2", "buyerOrgId" to "o2")))
    val legacy = LicenceRow.from(FirestoreDoc("p3", "marketplacePurchases/p3", mapOf("listingId" to "l1", "buyerUid" to "u1", "buyerOrgId" to null)))
    assertEquals(1000L, mine.paidCents, "what the license cost before tax")
    assertEquals(listOf("You", "A colleague"), listOf(boughtByLabel(mine, "u1"), boughtByLabel(theirs, "u1")))
    assertEquals(listOf("This workspace", "Studio", "Every workspace you belong to"), listOf(mine, theirs, legacy).map { licensedToLabel(it, "o1", mapOf("o2" to "Studio")) })
  }
}
