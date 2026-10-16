// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

#if canImport(UIKit)
  import UIKit
#elseif canImport(AppKit)
  import AppKit
  import PDFKit
#endif

/*
 * THE DEVICE'S OWN PRINT DIALOG. The console prints a receipt that has no cloud
 * printer through the browser's print dialog (`window.print()` from a hidden
 * frame, `pos-receipt.ts`): the page goes to whatever printers the computer
 * knows. This is that, on the device: AirPrint on an iPhone or iPad, the Mac's
 * print panel on a Mac. No printer driver and no SDK ship in the app; the
 * person picks the printer in the system's own sheet.
 */

/// What the print sheet prints besides a receipt's text.
public enum PrintableDocument: Equatable, Sendable {
  /// A page of markup the console prints from a popup: the packing slip and the invoice. Tables, headings and text, no
  /// script and no style sheet, which every platform's own HTML printing lays out.
  case html(String)
  /// A PDF made elsewhere: a carrier's shipping label.
  case pdf(Data)
  /// Product labels, one label to a page sized to the label.
  case labels(LabelSheet)
}

public enum SystemPrintResult: Equatable, Sendable {
  case printed
  /// The person closed the print sheet.
  case canceled
  case failed(String)
}

@MainActor
public enum SystemPrinter {
  /// Whether this device can show a print sheet at all.
  public static var isAvailable: Bool {
    #if canImport(UIKit)
      return UIPrintInteractionController.isPrintingAvailable
    #elseif canImport(AppKit)
      return true
    #else
      return false
    #endif
  }

  /// Sends `text`, monospaced, to the system's print sheet. The receipt's 48 columns fit an 80 mm roll at this size.
  public static func printText(_ text: String, jobName: String) async -> SystemPrintResult {
    #if canImport(UIKit)
      guard UIPrintInteractionController.isPrintingAvailable else { return .failed("Printing is not available on this device.") }
      let info = UIPrintInfo(dictionary: nil)
      info.outputType = .general
      info.jobName = jobName
      let formatter = UISimpleTextPrintFormatter(text: text)
      formatter.font = UIFont.monospacedSystemFont(ofSize: 7, weight: .regular)
      formatter.perPageContentInsets = UIEdgeInsets(top: 18, left: 18, bottom: 18, right: 18)
      let controller = UIPrintInteractionController.shared
      controller.printInfo = info
      controller.printFormatter = formatter
      return await withCheckedContinuation { continuation in
        let shown = controller.present(animated: true) { _, completed, error in
          if let error {
            continuation.resume(returning: .failed(error.localizedDescription))
          } else {
            continuation.resume(returning: completed ? .printed : .canceled)
          }
        }
        if !shown { continuation.resume(returning: .failed("The print sheet could not be shown.")) }
      }
    #elseif canImport(AppKit)
      let view = NSTextView(frame: NSRect(x: 0, y: 0, width: 260, height: 800))
      view.isEditable = false
      view.font = NSFont.monospacedSystemFont(ofSize: 7, weight: .regular)
      view.string = text
      let operation = NSPrintOperation(view: view, printInfo: (NSPrintInfo.shared.copy() as? NSPrintInfo) ?? NSPrintInfo.shared)
      operation.jobTitle = jobName
      operation.showsPrintPanel = true
      return operation.run() ? .printed : .canceled
    #else
      return .failed("Printing is not available on this device.")
    #endif
  }

  /// Sends `document` to the system's print sheet: the console's `window.print()` of the same page.
  public static func printDocument(_ document: PrintableDocument, jobName: String) async -> SystemPrintResult {
    #if canImport(UIKit)
      guard UIPrintInteractionController.isPrintingAvailable else { return .failed("Printing is not available on this device.") }
      let info = UIPrintInfo(dictionary: nil)
      info.outputType = .general
      info.jobName = jobName
      let controller = UIPrintInteractionController.shared
      controller.printInfo = info
      controller.printFormatter = nil
      controller.printPageRenderer = nil
      controller.printingItem = nil
      controller.delegate = nil
      var paper: LabelPaperChooser?
      switch document {
      case .html(let html):
        let formatter = UIMarkupTextPrintFormatter(markupText: html)
        formatter.perPageContentInsets = UIEdgeInsets(top: 36, left: 36, bottom: 36, right: 36)
        controller.printFormatter = formatter
      case .pdf(let data):
        guard UIPrintInteractionController.canPrint(data) else { return .failed("This file cannot be printed.") }
        controller.printingItem = data
      case .labels(let sheet):
        guard !sheet.labels.isEmpty else { return .failed("There are no labels to print.") }
        info.outputType = .grayscale
        controller.printPageRenderer = LabelPageRenderer(sheet: sheet)
        paper = LabelPaperChooser(size: sheet.pageSize)
        controller.delegate = paper
      }
      let result: SystemPrintResult = await withCheckedContinuation { continuation in
        let shown = controller.present(animated: true) { _, completed, error in
          if let error {
            continuation.resume(returning: .failed(error.localizedDescription))
          } else {
            continuation.resume(returning: completed ? .printed : .canceled)
          }
        }
        if !shown { continuation.resume(returning: .failed("The print sheet could not be shown.")) }
      }
      withExtendedLifetime(paper) {}
      controller.delegate = nil
      return result
    #elseif canImport(AppKit)
      let info = (NSPrintInfo.shared.copy() as? NSPrintInfo) ?? NSPrintInfo.shared
      info.isHorizontallyCentered = false
      info.isVerticallyCentered = false
      let operation: NSPrintOperation
      switch document {
      case .html(let html):
        guard let data = html.data(using: .utf8),
          let text = NSAttributedString(
            html: data, options: [.documentType: NSAttributedString.DocumentType.html, .characterEncoding: String.Encoding.utf8.rawValue],
            documentAttributes: nil)
        else { return .failed("The page could not be laid out.") }
        info.leftMargin = 36
        info.rightMargin = 36
        info.topMargin = 36
        info.bottomMargin = 36
        info.horizontalPagination = .fit
        info.verticalPagination = .automatic
        let width = max(200, info.paperSize.width - info.leftMargin - info.rightMargin)
        let view = NSTextView(frame: NSRect(x: 0, y: 0, width: width, height: 1))
        view.isEditable = false
        view.textStorage?.setAttributedString(text)
        view.sizeToFit()
        operation = NSPrintOperation(view: view, printInfo: info)
      case .pdf(let data):
        guard let pdf = PDFDocument(data: data), let made = pdf.printOperation(for: info, scalingMode: .pageScaleToFit, autoRotate: true)
        else { return .failed("This file cannot be printed.") }
        operation = made
      case .labels(let sheet):
        guard !sheet.labels.isEmpty else { return .failed("There are no labels to print.") }
        info.paperSize = sheet.pageSize
        info.leftMargin = 0
        info.rightMargin = 0
        info.topMargin = 0
        info.bottomMargin = 0
        info.horizontalPagination = .clip
        info.verticalPagination = .clip
        operation = NSPrintOperation(view: LabelSheetView(sheet: sheet), printInfo: info)
      }
      operation.jobTitle = jobName
      operation.showsPrintPanel = true
      operation.showsProgressPanel = true
      return operation.run() ? .printed : .canceled
    #else
      return .failed("Printing is not available on this device.")
    #endif
  }
}

#if canImport(UIKit)
  /// Each label on a page of its own, at the paper's top left.
  final class LabelPageRenderer: UIPrintPageRenderer {
    let sheet: LabelSheet

    init(sheet: LabelSheet) {
      self.sheet = sheet
      super.init()
    }

    override var numberOfPages: Int { sheet.labels.count }

    override func drawPage(at pageIndex: Int, in printableRect: CGRect) {
      guard sheet.labels.indices.contains(pageIndex), let context = UIGraphicsGetCurrentContext() else { return }
      drawLabel(sheet.labels[pageIndex], size: sheet.pageSize, origin: paperRect.origin, in: context)
    }
  }

  /// Picks the printer's paper nearest the label, as a label printer's driver offers its label stock.
  final class LabelPaperChooser: NSObject, UIPrintInteractionControllerDelegate {
    let size: CGSize

    init(size: CGSize) { self.size = size }

    func printInteractionController(_ controller: UIPrintInteractionController, choosePaper paperList: [UIPrintPaper]) -> UIPrintPaper {
      UIPrintPaper.bestPaper(forPageSize: size, withPapersFrom: paperList)
    }
  }
#elseif canImport(AppKit)
  /// The labels stacked one under another, a page each.
  final class LabelSheetView: NSView {
    let sheet: LabelSheet

    init(sheet: LabelSheet) {
      self.sheet = sheet
      super.init(frame: NSRect(x: 0, y: 0, width: sheet.widthPoints, height: sheet.heightPoints * Double(sheet.labels.count)))
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { nil }

    override var isFlipped: Bool { true }

    override func knowsPageRange(_ range: NSRangePointer) -> Bool {
      range.pointee = NSRange(location: 1, length: sheet.labels.count)
      return true
    }

    override func rectForPage(_ page: Int) -> NSRect {
      NSRect(x: 0, y: sheet.heightPoints * Double(page - 1), width: sheet.widthPoints, height: sheet.heightPoints)
    }

    override func draw(_ dirtyRect: NSRect) {
      guard let context = NSGraphicsContext.current?.cgContext else { return }
      for (index, label) in sheet.labels.enumerated() {
        let origin = CGPoint(x: 0, y: sheet.heightPoints * Double(index))
        guard CGRect(origin: origin, size: sheet.pageSize).intersects(dirtyRect) else { continue }
        drawLabel(label, size: sheet.pageSize, origin: origin, in: context)
      }
    }
  }
#endif
