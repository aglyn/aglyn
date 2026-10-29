// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynUI
import Observation

/// The picked site's own document (`hosts/{hostId}`), live, and what the
/// console's Sites list says about it.
@MainActor
@Observable
final class SiteStatus {
  private(set) var loaded = false
  private(set) var failed = false
  private(set) var status: HostStatus?
  /// The site's own custom domain (`cname`), once read.
  private(set) var cname: String?
  @ObservationIgnored private var listener: FirestoreListening?

  func start(reader: FirestoreReader?, hostID: String?) {
    listener?.remove()
    loaded = false
    failed = false
    status = nil
    cname = nil
    guard let reader, let hostID else { return }
    listener = reader.listenDocument(["hosts", hostID]) { [weak self] result in
      guard let self else { return }
      switch result {
      case .success(let doc):
        self.status = HostStatus.describe(doc?.data)
        self.cname = doc?.string("cname")
      case .failure: self.failed = true
      }
      self.loaded = true
    }
  }

  var chip: (text: String, tone: AglynTone)? {
    guard let status else { return nil }
    switch status.kind {
    case .live: return (status.label, .success)
    case .draft: return (status.label, .neutral)
    // In preview (AGL-4086): only the site's team sees it, the same tone the sites list gives it.
    case .preview: return (status.label, .neutral)
    case .maintenance: return (status.label, .warning)
    case .suspended: return (status.label, .error)
    }
  }
}
