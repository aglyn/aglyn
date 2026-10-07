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
  @ObservationIgnored private var listener: FirestoreListening?

  func start(reader: FirestoreReader?, hostID: String?) {
    listener?.remove()
    loaded = false
    failed = false
    status = nil
    guard let reader, let hostID else { return }
    listener = reader.listenDocument(["hosts", hostID]) { [weak self] result in
      guard let self else { return }
      switch result {
      case .success(let doc): self.status = HostStatus.describe(doc?.data)
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
    case .maintenance: return (status.label, .warning)
    case .suspended: return (status.label, .error)
    }
  }
}
