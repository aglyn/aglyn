// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

package com.aglyn.plugins.commerce.lists

import com.aglyn.contracts.Contracts
import com.aglyn.contracts.ListFilterRequest
import com.aglyn.contracts.ListQueryPlan
import com.aglyn.contracts.ListQueryRefusal
import com.aglyn.contracts.ListQuerySort
import com.aglyn.contracts.ListQuerySortDirection
import com.aglyn.core.listquery.planListQuery
import com.aglyn.pluginhost.FilterRefusal
import com.aglyn.plugins.commerce.orders.OrderFilter
import com.aglyn.plugins.commerce.orders.customerCrmLink
import com.aglyn.plugins.commerce.orders.ordersListRequest
import com.aglyn.plugins.commerce.products.ProductFilter
import com.aglyn.plugins.commerce.products.productsListRequest
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The Orders and Products lists' filters and header sorts (AGL-3841), and the order's link to its customer in the CRM. */
class ListControlsTest {
  @Test
  fun theOrdersPlanCarriesTheAddedFiltersBesideTheChip() {
    val channel = ListFilterRequest("channelKey", "equals", "pos")
    val plan = planListQuery(Contracts.orderListQuery, ordersListRequest(OrderFilter.PENDING, "", listOf(channel)))
    assertTrue(channel in plan.served)
    assertTrue(ListFilterRequest("statusKey", "equals", "pending") in plan.served)
  }

  @Test
  fun aHeaderSortOrdersTheListWithNothingElseOn() {
    val customer = Contracts.orderListQuery.sorts.first { it.path == "customerEmailLower" && it.direction == ListQuerySortDirection.ASC }
    assertEquals("customerEmailLower", planListQuery(Contracts.orderListQuery, ordersListRequest(OrderFilter.ALL, sort = customer)).orderBy.path)
    assertEquals("createdAtMs", planListQuery(Contracts.orderListQuery, ordersListRequest(OrderFilter.ALL)).orderBy.path)
    val price = Contracts.productListQuery.sorts.first { it.path == "priceFromCents" }
    assertEquals("priceFromCents", planListQuery(Contracts.productListQuery, productsListRequest(ProductFilter.ALL, sort = price)).orderBy.path)
  }

  @Test
  fun theProductsPlanCarriesTheAddedFilters() {
    val type = ListFilterRequest("type", "equals", "physical")
    assertTrue(type in planListQuery(Contracts.productListQuery, productsListRequest(ProductFilter.ACTIVE, clauses = listOf(type))).served)
  }

  @Test
  fun aRefusalIsMatchedBackToTheClauseThePersonAdded() {
    val clause = ListFilterRequest("productIds", "contains", "p1")
    val plan = ListQueryPlan(
      filters = emptyList(),
      notices = emptyList(),
      orderBy = Contracts.orderListQuery.sorts.first(),
      refused = listOf(
        ListQueryRefusal(
          buildJsonObject {
            put("field", JsonPrimitive("productIds"))
            put("op", JsonPrimitive("contains"))
            put("value", JsonPrimitive("p1"))
          },
          "one list clause",
        ),
        ListQueryRefusal(JsonPrimitive("search"), "the search"),
      ),
      served = emptyList(),
    )
    assertEquals(listOf(FilterRefusal(clause, "one list clause"), FilterRefusal(null, "the search")), filterRefusals(plan, listOf(clause)))
  }

  @Test
  fun theSelectFieldsOfferTheConsolesValues() {
    val choices = orderFilterChoices()
    assertEquals(Contracts.orderStatusOptions.size, choices["statusKey"]?.size)
    assertEquals(Contracts.orderChannelOptions.first().label, choices["channelKey"]?.first()?.label)
    assertNotNull(choices["disputeKey"])
  }

  @Test
  fun aSortReadsAsItsHeaderAndDirection() {
    assertEquals("Date, descending", sortLabel(ListQuerySort(direction = ListQuerySortDirection.DESC, label = "Date", path = "createdAtMs")))
    assertEquals("status, ascending", sortLabel(ListQuerySort(direction = ListQuerySortDirection.ASC, path = "status")))
  }

  @Test
  fun theCustomerLinkIsTheConsolesContactsByEmail() {
    assertEquals("/acme/hosts/shop/crm/contacts?email=jane%2Bshop%40example.com", customerCrmLink("acme", "shop", " jane+shop@example.com "))
    assertNull(customerCrmLink("acme", "shop", null))
    assertNull(customerCrmLink("acme", "shop", "  "))
    assertNull(customerCrmLink(null, "shop", "jane@example.com"))
  }
}
