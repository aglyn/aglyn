// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/// The release a build was cut from: the repo's version (the root package.json, e.g. "1.0.0-beta.266"), the
/// same one the web names. tools/scripts/native-release.mjs stamps it into Info.plist as `AGLYN_VERSION`;
/// `CFBundleShortVersionString` takes only up to three integers ("1.0.0"), so it is the answer for a local
/// build that was not stamped.
public enum AppVersion {
  public static var current: String { resolve(Bundle.main.infoDictionary ?? [:]) }

  public static func resolve(_ info: [String: Any]) -> String {
    if let stamped = (info["AGLYN_VERSION"] as? String)?.trimmingCharacters(in: .whitespaces), !stamped.isEmpty,
      !stamped.hasPrefix("$(")
    {
      return stamped
    }
    return info["CFBundleShortVersionString"] as? String ?? "0"
  }
}
