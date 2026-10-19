// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynUI
import Foundation
import XCTest

@testable import AglynCrmPlugin

/// The console's own answers, recorded by `generate-native-contracts.mjs`.
private func functionCases(_ name: String) throws -> [(args: [Any], result: Any)] {
  var url = URL(fileURLWithPath: #filePath)
  for _ in 0..<7 { url.deleteLastPathComponent() }
  url.appendPathComponent("native/contracts/function-cases.generated.json")
  let root = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any]
  let function = (root?["functions"] as? [String: Any])?[name] as? [String: Any]
  let cases = try XCTUnwrap(function?["cases"] as? [[String: Any]], "no cases for \(name)")
  return cases.map { ($0["args"] as? [Any] ?? [], $0["result"] ?? NSNull()) }
}

private func group(_ value: Any) -> ConsentGroup {
  let o = value as! [String: Any]
  return ConsentGroup(
    hostID: o["hostId"] as! String, groupID: o["groupId"] as! String, name: o["name"] as? String, hostIDs: o["hostIds"] as! [String],
    declared: (o["declared"] as? Bool) == true)
}

final class CrmTests: XCTestCase {
  func testConsentGroupsResolveAsTheConsoleResolvesThem() throws {
    for (index, item) in try functionCases("consentGroupForHost").enumerated() {
      XCTAssertEqual(consentGroupForHost(item.args[0] as? [String: Any], item.args[1] as! String), group(item.result), "case \(index)")
    }
  }

  func testScopeTokensAreTheConsoles() throws {
    for (index, item) in try functionCases("crmScopeTokens").enumerated() {
      XCTAssertEqual(crmScopeTokens(item.args[0] as? [String: Any], group(item.args[1])), item.result as? [String], "case \(index)")
    }
    for (index, item) in try functionCases("crmReadTokens").enumerated() {
      XCTAssertEqual(crmReadTokens(group(item.args[0])), item.result as? [String], "case \(index)")
    }
  }

  /// A currency field (AGL-3971) shows and stores its own currency's minor units: USD cents, whole yen, BHD fils. A
  /// JPY value stored as 1500 reads ¥1,500, never ¥15.
  func testCurrencyFieldsUseTheirOwnCurrencysMinorUnit() {
    func field(_ code: String?) -> CrmField {
      customFieldsOf(.contact, [
        CustomFieldDefinition(
          id: "f", key: "budget", label: "Budget", type: "currency", options: [], required: false, order: 0, retired: false,
          object: "contact", currency: code)
      ])[0]
    }
    let usd = field("usd")
    let jpy = field("jpy")
    let bhd = field("bhd")
    XCTAssertEqual(usd.stored, .minor)
    XCTAssertEqual(jpy.spec.currency, FieldCurrency(code: "JPY", digits: 0))
    XCTAssertEqual(bhd.spec.currency, FieldCurrency(code: "BHD", digits: 3))
    XCTAssertEqual(field(nil).spec.currency?.code, "USD")

    XCTAssertEqual(displayValue(usd, NSNumber(value: 125050)), "1250.50")
    XCTAssertEqual(displayValue(jpy, NSNumber(value: 1500)), "1500")
    XCTAssertEqual(displayValue(bhd, NSNumber(value: 1250)), "1.250")

    XCTAssertEqual(AglynCrmPlugin.storedValue(usd, "$1,250.50") as? Int64, 125050)
    XCTAssertEqual(AglynCrmPlugin.storedValue(jpy, "¥1,500") as? Int64, 1500)
    XCTAssertEqual(AglynCrmPlugin.storedValue(bhd, "1.25") as? Int64, 1250)
    XCTAssertNil(AglynCrmPlugin.storedValue(usd, "abc"))

    let us = Locale(identifier: "en_US")
    XCTAssertEqual(formatCurrencyFieldValue(1500, "jpy", locale: us), "¥1,500")
    XCTAssertEqual(fieldDisplay(jpy.spec, "1500"), 1500.0.formatted(.currency(code: "JPY").precision(.fractionLength(0))))
    XCTAssertEqual(fieldDisplay(usd.spec, "1250.50"), 1250.5.formatted(.currency(code: "USD").precision(.fractionLength(2))))
    XCTAssertTrue(fieldProblems([jpy.spec], [jpy.spec.key: "¥1,500"]).isEmpty)
    XCTAssertEqual(fieldProblems([jpy.spec], [jpy.spec.key: "lots"])[jpy.spec.key], "Enter an amount")
  }

  /// The field drawer's types and currencies are the console's (`CONTACT_FIELD_TYPES`, the deal currencies).
  func testTheFieldEditorOffersTheConsolesTypesAndCurrencies() {
    let values = ContractValues.shared
    XCTAssertEqual(values.nativeCrmFieldTypes.last, "currency")
    XCTAssertEqual(values.nativeCrmFieldTypeLabels["currency"], "Currency")
    XCTAssertTrue(values.nativeCrmFieldCurrencies.contains("jpy"))
    XCTAssertEqual(values.nativeCrmFieldDefaultCurrency, "usd")
    let def = CustomFieldDefinition(
      id: "f", key: "budget", label: "Budget", type: "currency", options: [], required: true, order: 0, retired: false,
      object: "contact", currency: "jpy")
    XCTAssertEqual(fieldSubtitle(def), "budget · Currency · JPY · Required")
  }

  func testFieldListFieldsAreTheConsoles() throws {
    for (index, item) in try functionCases("crmFieldListFields").enumerated() {
      let def = item.args[0] as! [String: Any]
      let got = fieldListFields(
        key: def["key"] as! String, label: def["label"] as! String, required: def["required"] as? Bool == true,
        object: def["object"] as? String ?? "contact")
      let want = item.result as! [String: Any]
      XCTAssertEqual(got["searchTokens"] as? [String], want["searchTokens"] as? [String], "case \(index)")
      XCTAssertEqual(got["object"] as? String, want["object"] as? String, "case \(index)")
    }
  }

  func testPipelineTotalsAreTheConsoles() throws {
    for (index, item) in try functionCases("pipelineTotals").enumerated() {
      let stages = ((item.args[1] as! [String: Any])["stages"] as! [[String: Any]]).map {
        Stage(
          id: $0["id"] as! String, name: $0["name"] as! String, order: ($0["order"] as! NSNumber).intValue,
          probability: ($0["probability"] as! NSNumber).intValue, kind: $0["kind"] as! String, forecastCategory: nil)
      }
      let got = pipelineTotals(item.args[0] as! [[String: Any]], Pipeline(id: "p", name: "P", stages: stages, isDefault: false, archived: false))
      let want = item.result as! [String: Any]
      XCTAssertEqual(got.count, (want["count"] as! NSNumber).intValue, "case \(index)")
      XCTAssertEqual(got.amountCents, (want["amountCents"] as! NSNumber).int64Value, "case \(index)")
      XCTAssertEqual(got.weightedCents, (want["weightedCents"] as! NSNumber).int64Value, "case \(index)")
      XCTAssertEqual(got.stages.map(\.count), (want["stages"] as! [[String: Any]]).map { ($0["count"] as! NSNumber).intValue })
    }
  }

  func testTheLeadFunnelIsTheConsoles() throws {
    for (index, item) in try functionCases("leadFunnel").enumerated() {
      let got = leadFunnel(item.args[0] as! [[String: Any]])
      let want = item.result as! [String: Any]
      XCTAssertEqual(got.total, (want["total"] as! NSNumber).intValue, "case \(index)")
      XCTAssertEqual(got.open, (want["open"] as! NSNumber).intValue, "case \(index)")
      XCTAssertEqual(got.reasons.map(\.label), (want["reasons"] as! [[String: Any]]).map { $0["label"] as! String }, "case \(index)")
    }
  }

  func testAnEditWritesOnlyWhatChanged() {
    let fields = [
      CrmField(.init("name", "Name")), CrmField(.init("amount", "Amount", kind: .money), path: "amountCents", stored: .cents),
      CrmField(.init("custom.size", "Size"), path: "custom.size"), CrmField(.init("phone", "Phone")),
    ]
    let before = formValues(fields, ["name": "A", "amountCents": 1250, "custom": ["size": "M"], "phone": "1"])
    XCTAssertEqual(before["amount"], "12.5")
    let changes = changedFields(fields, before: before, after: before.merging(["amount": "20", "custom.size": "L", "phone": ""]) { $1 })
    XCTAssertEqual(changes["amountCents"] as? Int64, 2000)
    XCTAssertEqual((changes["custom"] as? [String: Any])?["size"] as? String, "L")
    XCTAssertTrue(changes["phone"] is FirestoreSentinel)
    XCTAssertNil(changes["name"])
  }

  func testTheSuiteFollowsTheRules() {
    XCTAssertTrue(crmSuiteCarried(["plan": "pro"]))
    XCTAssertFalse(crmSuiteCarried(["plan": "pro", "billingStatus": "canceled"]))
    XCTAssertFalse(crmSuiteCarried(["plan": "free"]))
    XCTAssertTrue(crmSuiteCarried(["entitlements": ["features": ["crm": true]]]))
  }
}

/// The Contacts list asked to open one person by address (`contactsListSeed`, `?email=`).
final class CrmContactByEmailTests: XCTestCase {
  func testTheAddressNarrowsTheListToThatOnePerson() {
    let filter = contactEmailFilter("  Jane@Example.com ")
    XCTAssertEqual(filter?.id, contactEmailFilterID)
    XCTAssertEqual(filter?.clauses, [ListFilterRequest(field: "email", op: "equals", value: "jane@example.com")])
    XCTAssertNil(contactEmailFilter(nil))
    XCTAssertNil(contactEmailFilter("not an address"))
  }
}
