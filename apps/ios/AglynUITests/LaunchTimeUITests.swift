// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import XCTest

/// Cold launch, signed out, against the seeded emulator stack: the system's launch metric (until the app's first frame
/// is drawn and it answers input), and the wall-clock time until the sign-in form takes a tap, which is what a person
/// waits for. Each is printed as `AGLYN-LAUNCH <name> <ms>` for the comparison in AGL-3934.
final class LaunchTimeUITests: XCTestCase {
  func testLaunchUntilResponsive() {
    let options = XCTMeasureOptions()
    options.iterationCount = 5
    measure(metrics: [XCTApplicationLaunchMetric(waitUntilResponsive: true)], options: options) {
      XCUIApplication().launch()
    }
  }

  func testLaunchUntilSignInTakesATap() {
    var samples: [Double] = []
    for _ in 0..<5 {
      let app = XCUIApplication()
      app.terminate()
      let start = Date()
      app.launch()
      let field = app.descendants(matching: .any)["sign-in-email"]
      XCTAssertTrue(field.waitForExistence(timeout: 20), "The sign-in form never appeared")
      while !field.isHittable && Date().timeIntervalSince(start) < 20 { usleep(10_000) }
      samples.append(Date().timeIntervalSince(start) * 1000)
    }
    let sorted = samples.sorted()
    print("AGLYN-LAUNCH sign-in-hittable median \(Int(sorted[sorted.count / 2])) samples \(samples.map { Int($0) })")
  }
}
