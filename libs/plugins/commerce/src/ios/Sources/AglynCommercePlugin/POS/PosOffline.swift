// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import Foundation
import Observation

/*
 * THE REGISTER, OFFLINE (AGL-3625, AGL-3651, AGL-3652): the console register's
 * offline mode, on the device. The Kotlin app's `PosOffline.kt`, line for line.
 *
 * WHAT SELLS OFFLINE IS CASH, AND ONLY CASH (the console's rule, unchanged).
 * A card needs the reader and Stripe, a gift card's balance and a room charge's
 * stay can only be checked by the server, and a promotion code's cap is counted
 * there. The cashier's own discount, bounded by the site's ceiling, does sell.
 *
 * WHAT IT KEEPS, for ONE signed-in member at ONE site: the KIT (the server's
 * offline rules: the store's in-person tax, the discount ceiling, the shift rule,
 * the registers) refreshed while online, and the QUEUE of cash sales rung
 * offline until the server has recorded them. The basket's prices are the
 * catalog's as the grid priced them; a sale carries its customer only when the
 * cashier attached one.
 *
 * HOW IT SYNCS: when the connection returns and after every offline sale, in
 * batches of `POS_OFFLINE_SYNC_BATCH_MAX`, one sync at a time, through
 * `commerce/pos-offline-sync`. A sale leaves the device only when the server has
 * answered for it, recorded or a replay of a recording, so a connection that
 * drops mid-request leaves it queued and sending it again is safe: the server
 * lands a sale key once. A transient failure stays queued; every other refusal
 * waits for the cashier, still on the device, with the server's sentence.
 */

let posOfflineSyncRoute = "/api/commerce/pos-offline-sync"

/// How often the kit is refreshed while online.
let posOfflineKitRefreshMs: Int64 = 10 * 60 * 1000

/// One sale waiting on the device, with where it stands.
struct PosOfflineQueued: Codable, Equatable, Identifiable {
  enum State: String, Codable { case queued, refused }

  let sale: PosOfflineSale
  var state: State
  let queuedAtMs: Int64
  var attempts: Int
  var error: String?
  var reason: PosOfflineRefusal?

  var id: String { sale.saleKey }
  var totalCents: Int { Int(sale.totals.totalCents ?? 0) }
}

/// A sale the server answered for with something to check.
struct PosOfflineSyncNotice: Equatable, Identifiable {
  let saleKey: String
  let orderID: String
  let number: Int?
  let flags: [PosOfflineFlag]
  let stockConflicts: [PosOfflineStockConflict]
  var id: String { saleKey }

  /// What to check, in the words the console shows.
  var lines: [String] {
    stockConflicts.map { "\(Int($0.shortUnits)) of \(Int($0.requested))× \($0.name) not in stock" }
      + flags.filter { $0 != .stockShort }.map { ContractValues.shared.posOfflineFlagLabels[$0.rawValue] ?? $0.rawValue }
  }
}

/// A cash sale the register just rang offline, for its receipt step.
struct PosOfflineRung: Equatable {
  let sale: PosOfflineSale
  var changeCents: Int { Int(sale.changeCents) }
  var totalCents: Int { Int(sale.totals.totalCents ?? 0) }
  var hasCustomerEmail: Bool { !(sale.customer?.email ?? "").isEmpty }
}

/// The two offline calls, as the signed-in member.
protocol PosOfflineAPI: Sendable {
  func kit() async throws -> PosOfflineKit
  /// Sends one batch; an empty batch only asks whether the route answers.
  func sync(_ sales: [PosOfflineSale]) async throws -> [PosOfflineSaleOutcome]
}

struct ConsolePosOfflineAPI: PosOfflineAPI {
  let api: ConsoleAPIClient
  let hostID: String

  func kit() async throws -> PosOfflineKit {
    let answer = try await api.request(posOfflineSyncRoute, query: [("hostId", hostID)])
    guard let data = try answer?["kit"]?.encoded(), let kit = try? JSONDecoder().decode(PosOfflineKit.self, from: data) else {
      throw ConsoleAPIError(status: 502, message: "The register did not answer with its offline rules.")
    }
    return kit
  }

  func sync(_ sales: [PosOfflineSale]) async throws -> [PosOfflineSaleOutcome] {
    let encoded = try JSONEncoder().encode(sales)
    let body: JSONValue = .object(["hostId": .string(hostID), "sales": JSONValue.decode(encoded) ?? .array([])])
    let answer = try await api.request(posOfflineSyncRoute, method: .post, body: body)
    return try (answer?["results"]?.arrayValue ?? []).map {
      try JSONDecoder().decode(PosOfflineSaleOutcome.self, from: try $0.encoded())
    }
  }
}

/// The offline calls where there is no console to ask: every call finds it unreachable.
struct UnreachablePosOffline: PosOfflineAPI {
  private func unreachable() -> ConsoleAPIError {
    ConsoleAPIError(status: 0, message: "The register is offline. Check the connection and try again.")
  }
  func kit() async throws -> PosOfflineKit { throw unreachable() }
  func sync(_ sales: [PosOfflineSale]) async throws -> [PosOfflineSaleOutcome] { throw unreachable() }
}

/// What the register keeps on the device for one member at one site.
struct PosOfflineDeviceStore {
  let defaults: UserDefaults
  /// `uid:hostId`: another member on the same device, or the same member at another site, never reads these.
  let scope: String

  private var kitKey: String { "commerce.pos.offline.kit.\(scope)" }
  private var queueKey: String { "commerce.pos.offline.queue.\(scope)" }

  func loadKit() -> PosOfflineKit? {
    guard let data = defaults.data(forKey: kitKey) else { return nil }
    return try? JSONDecoder().decode(PosOfflineKit.self, from: data)
  }

  func saveKit(_ kit: PosOfflineKit) {
    if let data = try? JSONEncoder().encode(kit) { defaults.set(data, forKey: kitKey) }
  }

  /// Every sale this member queued at this site, oldest first.
  func queue() -> [PosOfflineQueued] {
    guard let data = defaults.data(forKey: queueKey), let list = try? JSONDecoder().decode([PosOfflineQueued].self, from: data)
    else { return [] }
    return list.sorted { ($0.sale.soldAtMs, $0.queuedAtMs) < ($1.sale.soldAtMs, $1.queuedAtMs) }
  }

  /// Keeps `entry` (replacing the same sale key). False when the device did not hold it.
  @discardableResult
  func put(_ entry: PosOfflineQueued) -> Bool {
    var list = queue().filter { $0.id != entry.id }
    list.append(entry)
    guard let data = try? JSONEncoder().encode(list) else { return false }
    defaults.set(data, forKey: queueKey)
    return queue().contains { $0.id == entry.id }
  }

  func remove(_ saleKey: String) {
    let list = queue().filter { $0.id != saleKey }
    if list.isEmpty {
      defaults.removeObject(forKey: queueKey)
    } else if let data = try? JSONEncoder().encode(list) {
      defaults.set(data, forKey: queueKey)
    }
  }
}

/// A key for one offline sale: the order's id once it syncs. Leading letters keep it from ever reading as an order number.
func newPosOfflineSaleKey() -> String {
  String(("off" + UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()).prefix(40))
}

@MainActor
@Observable
final class PosOfflineModel {
  private(set) var kit: PosOfflineKit?
  /// Sales on this device that have not synced, oldest first.
  private(set) var queue: [PosOfflineQueued]
  private(set) var syncing = false
  /// Why the last sync could not run, when the server refused it outright.
  private(set) var syncError: String?
  /// Synced sales the server flagged, until the cashier dismisses them.
  private(set) var notices: [PosOfflineSyncNotice] = []
  private(set) var kitSavedAtMs: Int64 = 0

  @ObservationIgnored private let api: PosOfflineAPI
  @ObservationIgnored private let store: PosOfflineDeviceStore
  @ObservationIgnored private let uid: String
  @ObservationIgnored private let registerID: () -> String?
  @ObservationIgnored private let locationID: () -> String?
  @ObservationIgnored private let shiftID: () -> String?
  @ObservationIgnored private let assertion: () -> String?
  @ObservationIgnored private let now: () -> Int64
  @ObservationIgnored private let mintKey: () -> String
  @ObservationIgnored private var ringing = false
  @ObservationIgnored private var syncInFlight = false
  /// Told when a sync failed at the network (true) or the console answered it (false).
  @ObservationIgnored var networkSink: ((Bool) -> Void)?

  init(
    api: PosOfflineAPI, store: PosOfflineDeviceStore, uid: String, registerID: @escaping () -> String?,
    locationID: @escaping () -> String?, shiftID: @escaping () -> String?, assertion: @escaping () -> String?,
    now: @escaping () -> Int64 = nowMs, mintKey: @escaping () -> String = newPosOfflineSaleKey
  ) {
    self.api = api
    self.store = store
    self.uid = uid
    self.registerID = registerID
    self.locationID = locationID
    self.shiftID = shiftID
    self.assertion = assertion
    self.now = now
    self.mintKey = mintKey
    kit = store.loadKit()
    queue = store.queue()
  }

  var waiting: [PosOfflineQueued] { queue.filter { $0.state == .queued } }
  var refused: [PosOfflineQueued] { queue.filter { $0.state == .refused } }
  var waitingCents: Int { waiting.reduce(0) { $0 + $1.totalCents } }

  /// The shift open on the register as last seen: the live one, else the kit's.
  private func lastKnownShift() -> String? {
    if let live = shiftID(), !live.isEmpty { return live }
    guard let kit, let id = registerID() else { return nil }
    return kit.registers.first { $0.id == id }?.openShiftId.flatMap { $0.isEmpty ? nil : $0 }
  }

  /// Why this device cannot sell offline, in the cashier's words; nil when it can.
  var unavailableReason: String? {
    guard let kit else { return "Connect once so the register can get ready to sell offline." }
    if !kit.available { return kit.unavailableReason ?? "Offline selling is unavailable for this site." }
    if kit.requireOpenShift && lastKnownShift() == nil {
      return "Open a shift before going offline: this site requires one for every sale."
    }
    return nil
  }

  var ready: Bool { unavailableReason == nil }

  /// The kit is stale or missing: refresh it when online.
  var kitIsStale: Bool { kit == nil || now() - kitSavedAtMs > posOfflineKitRefreshMs }

  /// The totals the basket rings offline, or nil when it cannot.
  func totals(for cart: Cart) -> OrderTotals? {
    guard let kit, kit.available, !cart.isEmpty else { return nil }
    return posOfflineSaleTotals(
      lines: cart.lines.map { PosOfflineTotalsLine(unitAmountCents: Double($0.unitCents), quantity: Double($0.quantity)) },
      discountPct: Double(cart.discountPct), taxPct: kit.tax.pct, pricesIncludeTax: kit.tax.pricesIncludeTax)
  }

  /// The discount is above this site's ceiling.
  func discountOverLimit(_ cart: Cart) -> Bool {
    guard let kit else { return false }
    return Double(cart.discountPct) > kit.maxDiscountPct
  }

  /// Reads the site's offline rules while online.
  func refreshKit() async {
    do {
      let fresh = try await api.kit()
      kit = fresh
      kitSavedAtMs = now()
      store.saveKit(fresh)
    } catch {
      // The kit stays as it was; whether the console answers is the register's own beat to judge.
    }
  }

  /// Queues one cash sale; nil (and nothing taken) when it cannot be kept.
  func ringCashSale(cart: Cart, tenderedCents: Int) -> PosOfflineRung? {
    guard !ringing, let kit, kit.available, !cart.isEmpty, let register = registerID(), !uid.isEmpty,
      let totals = totals(for: cart), !discountOverLimit(cart)
    else { return nil }
    let total = totals.totalCents ?? 0
    guard Double(tenderedCents) >= total else { return nil }
    ringing = true
    defer { ringing = false }
    let sold = now()
    let lines = cart.lines.map { line in
      PosOfflineSaleLine(
        modifiers: line.modifiers.isEmpty ? nil : line.modifiers, name: line.name, productId: line.productID,
        quantity: Double(line.quantity), unitAmountCents: Double(line.unitCents), variantId: line.variantID,
        variantLabel: line.variantLabel)
    }
    let customer = cart.customer.flatMap { attached -> PosOfflineSaleCustomer? in
      let named = attached.kind != "none" && !attached.id.isEmpty
      let made = PosOfflineSaleCustomer(
        email: attached.email, id: named ? attached.id : nil, kind: named ? attached.kind : nil,
        name: attached.name.isEmpty ? nil : attached.name)
      return made.email == nil && made.name == nil && made.id == nil ? nil : made
    }
    let sale = PosOfflineSale(
      cashierAssertion: assertion(), cashTenderedCents: Double(tenderedCents),
      changeCents: Double(posOfflineChangeCents(total: total, tendered: Double(tenderedCents))), customer: customer,
      discountPct: Double(cart.discountPct), hostId: kit.hostId, lines: lines, locationId: locationID(), orgId: kit.orgId,
      registerId: register, saleKey: mintKey(), shiftId: lastKnownShift(), signedInUid: uid, soldAtMs: Double(sold),
      totals: totals, v: 1)
    // The sale is real only once the device holds it: a write that fails answers nil, before any cash is taken.
    guard store.put(PosOfflineQueued(sale: sale, state: .queued, queuedAtMs: sold, attempts: 0)) else { return nil }
    queue = store.queue()
    return PosOfflineRung(sale: sale)
  }

  func dismissNotices() { notices = [] }

  /// Removes a refused sale the server will never take, after the cashier confirms.
  func discard(_ saleKey: String) {
    store.remove(saleKey)
    queue = store.queue()
  }

  /// Sends everything waiting, in batches, one sync at a time.
  func syncNow() async {
    guard !syncInFlight else { return }
    let mine = store.queue().filter { $0.state == .queued && $0.sale.signedInUid == uid }
    guard !mine.isEmpty else { return }
    syncInFlight = true
    syncing = true
    defer {
      queue = store.queue()
      syncing = false
      syncInFlight = false
    }
    var flagged: [PosOfflineSyncNotice] = []
    let batchSize = ContractValues.shared.posOfflineSyncBatchMax
    var start = 0
    while start < mine.count {
      let batch = Array(mine[start..<min(mine.count, start + Int(batchSize))])
      start += batch.count
      let results: [PosOfflineSaleOutcome]
      do {
        results = try await api.sync(batch.map(\.sale))
      } catch let failure as ConsoleAPIError {
        if failure.status == 0 {
          networkSink?(true)
        } else {
          syncError = failure.message
        }
        break
      } catch {
        break
      }
      syncError = nil
      networkSink?(false)
      let byKey = Dictionary(uniqueKeysWithValues: batch.map { ($0.id, $0) })
      for result in results {
        guard var entry = byKey[result.saleKey] else { continue }
        if result.status == .recorded || result.status == .replayed {
          store.remove(entry.id)
          if let flags = result.flags, !flags.isEmpty {
            flagged.append(
              PosOfflineSyncNotice(
                saleKey: result.saleKey, orderID: result.orderId ?? result.saleKey, number: result.number.map { Int($0) },
                flags: flags, stockConflicts: result.stockConflicts ?? []))
          }
          continue
        }
        // A transient failure stays queued; every other refusal waits for the cashier.
        entry.attempts += 1
        entry.state = result.reason == .failed || result.reason == .wrongStaff ? .queued : .refused
        entry.error = result.error
        entry.reason = result.reason
        store.put(entry)
      }
    }
    if !flagged.isEmpty { notices += flagged }
  }
}
