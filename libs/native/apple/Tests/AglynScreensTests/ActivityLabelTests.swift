// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import Foundation
import XCTest

@testable import AglynScreens

/// An Activity row's action reads in words, never as the stored code (`activityActionLabel`). The Kotlin renderer's
/// `ActivityLabelTest` holds the same cases.
final class ActivityLabelTests: XCTestCase {
  private func shown(_ action: String) -> String { ScreenValues.render("{item.action:activity}", in: ["item": ["action": .string(action)]]) }

  func testAnActivityActionReadsInWords() {
    XCTAssertEqual(shown("component.duplicated"), "Duplicated a component")
    XCTAssertEqual(shown("emailDesign.duplicated"), "Duplicated an email design")
    XCTAssertEqual(shown("billing.invoice.paid"), "Billing: invoice paid")
    XCTAssertEqual(shown("host.reattach-domain"), "Site: reattach domain")
    XCTAssertEqual(shown("Saved the screen"), "Saved the screen")
  }
}

/// A list row's line made of parts leaves out a part that holds nothing, so it never ends on a dangling `set by `.
final class RowLineTests: XCTestCase {
  func testARowLineLeavesOutThePartsThatHoldNothing() {
    let line: JSONValue = ["{item.reason}", ["text": "set by {item.actorUid}", "when": "item.actorUid"]]
    XCTAssertEqual(rowLine(line, in: ["item": ["reason": "Abuse", "actorUid": "u1"]]), "Abuse · set by u1")
    XCTAssertEqual(rowLine(line, in: ["item": ["reason": "Abuse"]]), "Abuse")
    XCTAssertNil(rowLine(line, in: ["item": [:]]))
    XCTAssertEqual(rowLine("{item.reason}", in: ["item": ["reason": "Plain"]]), "Plain")
  }
}
