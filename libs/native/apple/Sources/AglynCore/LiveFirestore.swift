// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation
import Observation

/// A live read's state: loading, its value, or why it failed.
public enum LiveValue<Value> {
  case loading
  case ready(Value)
  case failed(String)

  public var value: Value? {
    if case .ready(let value) = self { return value }
    return nil
  }

  public var isLoading: Bool {
    if case .loading = self { return true }
    return false
  }
}

/// Waits until the calling task is cancelled: a view's `.task` holding a listener open.
private func untilCancelled() async {
  while !Task.isCancelled {
    try? await Task.sleep(nanoseconds: 3_600 * 1_000_000_000)
  }
}

/// One document, live, for as long as the view's task runs (the Kotlin kit's
/// `observeDoc`): `.task(id: path) { await doc.bind(reader, path) }`.
@MainActor
@Observable
public final class LiveDocument {
  public private(set) var state: LiveValue<FirestoreDocument?> = .loading
  @ObservationIgnored private var listener: FirestoreListening?

  public init() {}

  public func start(_ reader: FirestoreReader, _ path: [String]) {
    listener?.remove()
    state = .loading
    listener = reader.listenDocument(path) { [weak self] result in
      switch result {
      case .success(let doc): self?.state = .ready(doc)
      case .failure(let error): self?.state = .failed(error.localizedDescription)
      }
    }
  }

  public func stop() {
    listener?.remove()
    listener = nil
  }

  /// Listens until the calling task is cancelled.
  public func bind(_ reader: FirestoreReader, _ path: [String]) async {
    start(reader, path)
    await untilCancelled()
    stop()
  }
}

/// One query, live, for as long as the view's task runs (the Kotlin kit's `observe`).
@MainActor
@Observable
public final class LiveQuery {
  public private(set) var state: LiveValue<[FirestoreDocument]> = .loading
  @ObservationIgnored private var listener: FirestoreListening?

  public init() {}

  public func start(_ reader: FirestoreReader, _ query: FirestoreQuery) {
    listener?.remove()
    state = .loading
    listener = reader.listen(query) { [weak self] result in
      switch result {
      case .success(let docs): self?.state = .ready(docs)
      case .failure(let error): self?.state = .failed(error.localizedDescription)
      }
    }
  }

  public func stop() {
    listener?.remove()
    listener = nil
  }

  public func bind(_ reader: FirestoreReader, _ query: FirestoreQuery) async {
    start(reader, query)
    await untilCancelled()
    stop()
  }
}
