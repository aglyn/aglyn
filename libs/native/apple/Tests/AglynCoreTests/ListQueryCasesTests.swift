// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import XCTest

@testable import AglynCore

/// Replays libs/native/contracts/list-query-cases.generated.json: the console
/// planner's own normalizations and plans, made in UTC.
final class ListQueryCasesTests: XCTestCase {
  private static let data: Data = {
    let url = URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent()  // AglynCoreTests
      .deletingLastPathComponent()  // Tests
      .deletingLastPathComponent()  // apple
      .deletingLastPathComponent()  // native
      .appendingPathComponent("contracts/list-query-cases.generated.json")
    return try! Data(contentsOf: url)
  }()

  private struct Normalized: Decodable {
    let input: String
    let key: String
    let token: String
    let reversed: String
    let tokens: [String]
  }

  private struct PlanCase: Decodable {
    let declaration: String
    let label: String
    let request: ListQueryRequest
    let plan: ListQueryPlan
  }

  private struct Root: Decodable {
    let timeZone: String
    let normalizers: [Normalized]
    let cases: [PlanCase]
  }

  private static let root: Root = try! JSONDecoder().decode(Root.self, from: data)

  private let utc = TimeZone(identifier: "UTC")!

  /// Every generated value by its export name, so a declaration a lane adds
  /// to `listQueryCases` is replayed here without a hand-kept list.
  private static let values: [String: Any] = {
    let url = URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent()  // AglynCoreTests
      .deletingLastPathComponent()  // Tests
      .deletingLastPathComponent()  // apple
      .deletingLastPathComponent()  // native
      .appendingPathComponent("contracts/contracts.generated.json")
    return try! JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
  }()

  private func declaration(_ name: String) -> ListQueryDeclaration? {
    guard let raw = Self.values[name], let data = try? JSONSerialization.data(withJSONObject: raw) else { return nil }
    return try? JSONDecoder().decode(ListQueryDeclaration.self, from: data)
  }

  func testNamesKeyTokenAndReverseAsTheConsoleStoresThem() {
    XCTAssertFalse(Self.root.normalizers.isEmpty)
    for item in Self.root.normalizers {
      XCTAssertEqual(nameSearchKey(item.input), item.key, item.input)
      XCTAssertEqual(nameSearchToken(item.input), item.token, item.input)
      XCTAssertEqual(nameSearchReversed(item.input), item.reversed, item.input)
      XCTAssertEqual(nameSearchTokens(item.input), item.tokens, item.input)
    }
  }

  func testEveryPlanMatchesTheConsolesPlan() throws {
    XCTAssertEqual(Self.root.timeZone, "UTC")
    XCTAssertGreaterThanOrEqual(Self.root.cases.count, 40)
    // Every key the console writes in a plan is one the Swift plan carries.
    let raw = try JSONSerialization.jsonObject(with: Self.data) as! [String: Any]
    let known: Set<String> = ["filters", "notices", "orderBy", "refused", "searched", "served", "sortFallback"]
    for item in raw["cases"] as! [[String: Any]] {
      XCTAssertTrue(Set((item["plan"] as! [String: Any]).keys).isSubset(of: known), "\(item["label"] ?? "")")
    }
    for item in Self.root.cases {
      let label = "\(item.declaration): \(item.label)"
      guard let declared = declaration(item.declaration) else {
        XCTFail("no declaration for \(label)")
        continue
      }
      let plan = planListQuery(declared, item.request, timeZone: utc)
      XCTAssertEqual(plan.filters, item.plan.filters, "filters — \(label)")
      XCTAssertEqual(plan.orderBy, item.plan.orderBy, "orderBy — \(label)")
      XCTAssertEqual(plan.served, item.plan.served, "served — \(label)")
      XCTAssertEqual(plan.searched, item.plan.searched, "searched — \(label)")
      XCTAssertEqual(plan.refused, item.plan.refused, "refused — \(label)")
      XCTAssertEqual(plan.notices, item.plan.notices, "notices — \(label)")
      XCTAssertEqual(plan.sortFallback, item.plan.sortFallback, "sortFallback — \(label)")
    }
  }

  func testAPlanBecomesFirestoreConstraints() {
    let plan = planListQuery(
      ContractValues.shared.orderListQuery,
      ListQueryRequest(clauses: [ListFilterRequest(field: "createdAtMs", op: "onOrAfter", value: "2026-03-14")]),
      timeZone: utc)
    let constraints = plan.constraints
    XCTAssertEqual(constraints.count, 1)
    XCTAssertEqual(constraints.first?.path, "createdAtMs")
    XCTAssertEqual(constraints.first?.op, .greaterThanOrEqual)
    XCTAssertEqual(constraints.first?.value as? Int64, 1_773_446_400_000)
    XCTAssertEqual(plan.orderBy.path, "createdAtMs")
    XCTAssertEqual(plan.orderBy.direction, .desc)
  }

  func testATimestampBoundBecomesADate() {
    let plan = ListQueryPlan(
      filters: [ListQueryFilter(op: .lessThan, path: "at", value: .object(["$date": .string("2026-03-15T00:00:00.000Z")]))],
      notices: [], orderBy: ListQuerySort(direction: .asc, path: "at"), refused: [], served: [])
    XCTAssertEqual(plan.constraints.first?.value as? Date, Date(timeIntervalSince1970: 1_773_532_800))
  }

  func testADayIsReadInTheGivenZone() throws {
    let chicago = TimeZone(identifier: "America/Chicago")!
    let bounds = try XCTUnwrap(listQueryDayBounds("2026-03-14", timeZone: chicago))
    XCTAssertEqual(bounds.start, 1_773_464_400_000)
    XCTAssertEqual(bounds.end - bounds.start, 24 * 3_600_000)
    XCTAssertNil(listQueryDayBounds("not a day", timeZone: chicago))
  }
}
