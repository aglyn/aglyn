// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import XCTest

@testable import AglynScreens

/// A plan or add-on refusal is an upsell on a spec screen, never "This did not load".
final class PlanRefusalTests: XCTestCase {
  func testPaymentRequiredAndEntitlementRefusalsAreUpsells() {
    XCTAssertTrue(ScreenModel.isPlanRefusal(ConsoleAPIError(status: 402, message: "Add AI credits")))
    XCTAssertTrue(
      ScreenModel.isPlanRefusal(
        ConsoleAPIError(status: 403, message: "Not on your plan", body: .object(["code": .string("entitlement")]))))
    XCTAssertTrue(
      ScreenModel.isPlanRefusal(
        ConsoleAPIError(status: 403, message: "Not on your plan", body: .object(["error": .string("entitlement-required")]))))
  }

  func testOtherRefusalsStayFailures() {
    XCTAssertFalse(ScreenModel.isPlanRefusal(ConsoleAPIError(status: 403, message: "Not allowed")))
    XCTAssertFalse(
      ScreenModel.isPlanRefusal(
        ConsoleAPIError(status: 403, message: "Sign in again", body: .object(["code": .string("reauth-required")]))))
    XCTAssertFalse(ScreenModel.isPlanRefusal(ConsoleAPIError(status: 500, message: "Server error")))
  }
}

/// The Activity specs read the route's own words first (`actionLabel`) and fall back to the stored action.
final class ActivityActionLabelFallbackTests: XCTestCase {
  func testTheRoutesLabelWinsAndTheStoredActionIsTheFallback() {
    let template = "{item.actionLabel|item.action:title}"
    XCTAssertEqual(
      ScreenValues.render(
        template, in: ["item": ["actionLabel": "Duplicated a component", "action": "component.duplicated"]]),
      "Duplicated a component")
    XCTAssertEqual(ScreenValues.render(template, in: ["item": ["action": "form_submitted"]]), "Form submitted")
  }
}
