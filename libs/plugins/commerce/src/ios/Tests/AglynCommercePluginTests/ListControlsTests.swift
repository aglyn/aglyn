// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import XCTest

@testable import AglynCommercePlugin

/// The Orders and Products lists' filters and header sorts (AGL-3841), and the order's link to its customer in the CRM.
final class ListControlsTests: XCTestCase {
  func testTheOrdersPlanCarriesTheAddedFiltersBesideTheChip() {
    let channel = ListFilterRequest(field: "channelKey", op: "equals", value: "pos")
    let plan = ordersPlan(.pending, search: "", clauses: [channel])
    XCTAssertTrue(plan.served.contains(channel))
    XCTAssertTrue(plan.served.contains(ListFilterRequest(field: "statusKey", op: "equals", value: "pending")))
  }

  func testAHeaderSortOrdersTheListWithNothingElseOn() {
    let sorts = ContractValues.shared.orderListQuery.sorts
    let customer = sorts.first { $0.path == "customerEmailLower" && $0.direction == .asc }!
    XCTAssertEqual(ordersPlan(.all, search: "", sort: customer).orderBy.path, "customerEmailLower")
    XCTAssertEqual(ordersPlan(.all, search: "").orderBy.path, "createdAtMs", "newest first by default")
    let price = ContractValues.shared.productListQuery.sorts.first { $0.path == "priceFromCents" }!
    XCTAssertEqual(productsPlan(status: nil, search: "", sort: price).orderBy.path, "priceFromCents")
  }

  func testTheProductsPlanCarriesTheAddedFilters() {
    let type = ListFilterRequest(field: "type", op: "equals", value: "physical")
    XCTAssertTrue(productsPlan(status: "active", search: "", clauses: [type]).served.contains(type))
  }

  func testARefusalIsMatchedBackToTheClauseThePersonAdded() {
    let clause = ListFilterRequest(field: "productIds", op: "contains", value: "p1")
    let sort = ContractValues.shared.orderListQuery.sorts[0]
    let plan = ListQueryPlan(
      filters: [], notices: [], orderBy: sort,
      refused: [
        ListQueryRefusal(clause: .object(["field": .string("productIds"), "op": .string("contains"), "value": .string("p1")]), reason: "one list clause"),
        ListQueryRefusal(clause: .string("search"), reason: "the search"),
      ],
      served: [])
    XCTAssertEqual(filterRefusals(plan, clauses: [clause]), [
      FilterRefusal(clause: clause, reason: "one list clause"), FilterRefusal(clause: nil, reason: "the search"),
    ])
  }

  func testTheSelectFieldsOfferTheConsolesValues() {
    let choices = orderFilterChoices()
    XCTAssertEqual(choices["statusKey"]?.count, ContractValues.shared.orderStatusOptions.count)
    XCTAssertEqual(choices["channelKey"]?.first?.label, ContractValues.shared.orderChannelOptions.first?.label)
    XCTAssertNotNil(choices["disputeKey"])
  }

  func testASortReadsAsItsHeaderAndDirection() {
    XCTAssertEqual(sortLabel(ListQuerySort(direction: .desc, label: "Date", path: "createdAtMs")), "Date, descending")
    XCTAssertEqual(sortLabel(ListQuerySort(direction: .asc, path: "status")), "status, ascending")
  }

  func testTheCustomerLinkIsTheConsolesContactsByEmail() {
    XCTAssertEqual(
      customerCrmLink(orgSlug: "acme", hostSlug: "shop", email: " jane+shop@example.com "),
      "/acme/hosts/shop/crm/contacts?email=jane%2Bshop%40example.com")
    XCTAssertNil(customerCrmLink(orgSlug: "acme", hostSlug: "shop", email: nil), "a guest with no address has no link")
    XCTAssertNil(customerCrmLink(orgSlug: "acme", hostSlug: "shop", email: "  "))
    XCTAssertNil(customerCrmLink(orgSlug: nil, hostSlug: "shop", email: "jane@example.com"), "not before the slugs settle")
  }
}
