// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

@testable import AglynContracts

/// Replays the business profile cases in function-cases.generated.json.
final class BusinessProfileTests: XCTestCase {
  private static let functions: [String: Any] = {
    let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
      .deletingLastPathComponent().deletingLastPathComponent()
      .appendingPathComponent("contracts/function-cases.generated.json")
    let root = try! JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
    return root["functions"] as! [String: Any]
  }()

  private func cases(_ name: String) -> [(args: [Any], result: Any)] {
    let list = ((Self.functions[name] as? [String: Any])?["cases"] as? [[String: Any]]) ?? []
    XCTAssertFalse(list.isEmpty, "no cases for \(name)")
    return list.map { ($0["args"] as? [Any] ?? [], $0["result"] as Any) }
  }

  private func map(_ value: Any?) -> [String: Any]? { value as? [String: Any] }

  /// A value as JSON text with sorted keys, so two plain values compare by content.
  private func canonical(_ value: Any?) -> String {
    guard let value, !(value is NSNull) else { return "null" }
    let data = try! JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed, .sortedKeys])
    return String(data: data, encoding: .utf8)!
  }

  private func field<T: Equatable & Sendable>(_ f: ResolvedBusinessField<T>?) -> Any? { f.map { ["value": $0.value, "origin": $0.origin] as [String: Any] } }

  private func json(_ p: ResolvedBusinessProfile) -> [String: Any?] {
    [
      "name": field(p.name), "whatYouDo": field(p.whatYouDo), "services": field(p.services), "serviceArea": field(p.serviceArea),
      "audience": field(p.audience), "tone": field(p.tone), "toneNotes": field(p.toneNotes), "founded": field(p.founded),
      "businessType": p.businessType,
      "contact": ["email": p.contact.email, "phone": p.contact.phone, "address": p.contact.address, "hours": p.contact.hours] as [String: Any?],
      "profiles": p.profiles, "logo": p.logo,
    ]
  }

  private func plain(_ value: Any?) -> Any {
    switch value {
    case let dict as [String: Any?]: return dict.mapValues { plain($0) }
    case let dict as [String: Any]: return dict.mapValues { plain($0) }
    case let list as [Any?]: return list.map { plain($0) }
    case nil: return NSNull()
    case .some(let other): return other
    }
  }

  func testResolves() {
    for item in cases("resolveBusinessProfile") {
      let input = map(item.args[0]) ?? [:]
      let resolved = resolveBusinessProfile(host: map(input["host"]), site: map(input["site"]), workspace: map(input["workspace"]))
      XCTAssertEqual(canonical(plain(json(resolved))), canonical(item.result), "\(item.args)")
    }
  }

  func testSourcesSanitizesAndOwnerWrites() {
    for item in cases("businessProfileSourceOf") {
      XCTAssertEqual(businessProfileSourceOf(map(item.args[0]), item.args[1] as? String ?? ""), item.result as? String, "\(item.args)")
    }
    for item in cases("sanitizeBusinessProfileValues") {
      XCTAssertEqual(canonical(sanitizeBusinessProfileValues(map(item.args[0]) ?? [:])), canonical(item.result), "\(item.args)")
    }
    for item in cases("businessProfileOwnerWrite") {
      XCTAssertEqual(canonical(businessProfileOwnerWrite(map(item.args[0]), map(item.args[1]) ?? [:])), canonical(item.result), "\(item.args)")
    }
  }

  func testPlacesAndProfileUrls() {
    for item in cases("normalizeAreaServed") { XCTAssertEqual(normalizeAreaServed(item.args[0] is NSNull ? nil : item.args[0]), item.result as? [String], "\(item.args)") }
    for item in cases("siteProfileUrls") { XCTAssertEqual(siteProfileUrls(map(item.args[0])), item.result as? [String], "\(item.args)") }
  }
}
