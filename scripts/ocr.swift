#!/usr/bin/env swift

import Foundation
import Vision
import ImageIO

/// Text block info
struct TextBlock {
    let text: String
    let confidence: Float
    /// Normalized coordinates (0~1)
    let minX: Double
    let minY: Double
    let maxX: Double
    let maxY: Double
    /// Center point
    var centerX: Double { (minX + maxX) / 2 }
    var centerY: Double { (minY + maxY) / 2 }
    /// Row index (assigned after layout analysis)
    var row: Int = -1
    /// Column index (assigned after layout analysis)
    var col: Int = -1
}

// MARK: - OCR

func recognizeText(from cgImage: CGImage) -> [TextBlock] {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["zh-Hans", "en-US"]
    request.usesLanguageCorrection = true

    let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
    do {
        try handler.perform([request])
    } catch {
        print("OCR failed: \(error.localizedDescription)")
        return []
    }

    guard let observations = request.results else { return [] }

    return observations.compactMap { obs in
        guard let candidate = obs.topCandidates(1).first else { return nil }
        let box = obs.boundingBox
        return TextBlock(
            text: candidate.string,
            confidence: candidate.confidence,
            minX: Double(box.minX),
            minY: Double(box.minY),
            maxX: Double(box.maxX),
            maxY: Double(box.maxY)
        )
    }
}

func loadCGImage(from path: String) -> CGImage? {
    let url = URL(fileURLWithPath: path)
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
    return CGImageSourceCreateImageAtIndex(source, 0, nil)
}

// MARK: - Image Description (--describe)

/// Normalized coordinates -> nine-grid position description (Vision origin is bottom-left, Y up)
func describePosition(_ box: CGRect) -> String {
    let cx = box.midX
    let cy = box.midY
    if cx < 0.33 && cy > 0.67 { return "top-left" }
    if cx < 0.33 && cy > 0.33 { return "center-left" }
    if cx < 0.33 { return "bottom-left" }
    if cx > 0.67 && cy > 0.67 { return "top-right" }
    if cx > 0.67 && cy > 0.33 { return "center-right" }
    if cx > 0.67 { return "bottom-right" }
    if cy > 0.67 { return "top-center" }
    if cy > 0.33 { return "center" }
    return "bottom-center"
}

/// Perceive image content with macOS Vision, output text friendly to vision-less models
func describeImage(_ cgImage: CGImage) {
    let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
    var lines: [String] = []

    // 1. Image classification (>=0.4 listed directly, 0.2~0.4 flagged as "maybe")
    let classify = VNClassifyImageRequest()
    try? handler.perform([classify])
    if let results = classify.results {
        let confident = results.filter { $0.confidence >= 0.4 }
        let maybe = results.filter { $0.confidence >= 0.2 && $0.confidence < 0.4 }
        if !confident.isEmpty {
            let tags = confident.prefix(6).map { "\($0.identifier)(\(String(format: "%.0f", $0.confidence * 100))%)" }
            lines.append("Scene categories: \(tags.joined(separator: ", "))")
        }
        if !maybe.isEmpty {
            let tags = maybe.prefix(4).map { $0.identifier }
            lines.append("Maybe contains: \(tags.joined(separator: ", ")) (low confidence)")
        }
    }

    // 2. People
    let humans = VNDetectHumanRectanglesRequest()
    try? handler.perform([humans])
    if let results = humans.results, !results.isEmpty {
        let descs = results.map { describePosition($0.boundingBox) }
        lines.append("People (\(results.count)): \(descs.joined(separator: ", "))")
    }

    // 3. Faces
    let faces = VNDetectFaceRectanglesRequest()
    try? handler.perform([faces])
    if let results = faces.results, !results.isEmpty {
        let descs = results.map { describePosition($0.boundingBox) }
        lines.append("Faces (\(results.count)): \(descs.joined(separator: ", "))")
    }

    // 4. Animals
    let animals = VNRecognizeAnimalsRequest()
    try? handler.perform([animals])
    if let results = animals.results, !results.isEmpty {
        let descs = results.map { obs in
            let name = obs.labels.first?.identifier ?? "animal"
            return "\(name) (\(describePosition(obs.boundingBox)))"
        }
        lines.append("Animals (\(results.count)): \(descs.joined(separator: ", "))")
    }

    // 5. Barcodes / QR codes (decoded content output directly)
    let barcodes = VNDetectBarcodesRequest()
    try? handler.perform([barcodes])
    if let results = barcodes.results, !results.isEmpty {
        var descs: [String] = []
        for obs in results {
            if let payload = obs.payloadStringValue {
                descs.append("\(obs.symbology.rawValue): \(payload)")
            }
        }
        if !descs.isEmpty {
            lines.append("Barcodes/QR: \(descs.joined(separator: " | "))")
        }
    }

    // 6. Saliency (image focus)
    let saliency = VNGenerateAttentionBasedSaliencyImageRequest()
    try? handler.perform([saliency])
    if let obs = saliency.results?.first,
       let main = obs.salientObjects?.max(by: { $0.boundingBox.width * $0.boundingBox.height
                                                < $1.boundingBox.width * $1.boundingBox.height }) {
        lines.append("Image focus: main subject at \(describePosition(main.boundingBox))")
    }

    // 7. Aesthetics score (overallScore range -1~1)
    let aesthetic = VNCalculateImageAestheticsScoresRequest()
    try? handler.perform([aesthetic])
    if let obs = aesthetic.results?.first {
        lines.append("Aesthetics: \(String(format: "%.2f", obs.overallScore)) (range -1~1, closer to 1 is more pleasing)")
        if obs.isUtility {
            lines.append("Image nature: ordinary content image (not a striking scene)")
        }
    }

    // 8. Text hint (accurate level so small text is also detected)
    let text = VNRecognizeTextRequest()
    text.recognitionLevel = .accurate
    try? handler.perform([text])
    let textCount = text.results?.count ?? 0

    print("=== Image Description (macOS Vision, fully local) ===")
    print("")
    if lines.isEmpty {
        print("No useful image information found")
    } else {
        for line in lines { print(line) }
    }
    if textCount > 0 {
        print("Text: \(textCount) text region(s) detected; run OCR mode for exact content")
    }
    print("")
    print("Hint: run ocr.swift on this image for exact text content")
}

// MARK: - Layout Analysis

/// Cluster blocks by Y center with 0.02 tolerance (sorted top to bottom)
func groupRows(_ blocks: [TextBlock]) -> [[TextBlock]] {
    let sorted = blocks.sorted { $0.centerY > $1.centerY } // Y descending = top to bottom
    var rows: [[TextBlock]] = []
    var currentRow: [TextBlock] = []
    var lastY: Double = -1

    for block in sorted {
        if lastY < 0 || abs(block.centerY - lastY) > 0.02 {
            if !currentRow.isEmpty {
                rows.append(currentRow)
            }
            currentRow = [block]
            lastY = block.centerY
        } else {
            currentRow.append(block)
        }
    }
    if !currentRow.isEmpty { rows.append(currentRow) }
    return rows
}

/// Detect table structure: check if block counts align across rows
func detectColumns(rows: [[TextBlock]]) -> Int? {
    guard rows.count >= 2 else { return nil }
    // Count text blocks per row
    var colCount: Int? = nil
    for row in rows {
        let cols = row.sorted { $0.minX < $1.minX }
        if colCount == nil {
            colCount = cols.count
        } else if cols.count != colCount {
            return nil // inconsistent column count, not a table
        }
    }
    return colCount
}

/// Format layout output
func formatLayout(_ blocks: [TextBlock]) {
    guard !blocks.isEmpty else {
        print("No text recognized")
        return
    }

    let rows = groupRows(blocks)
    let colCount = detectColumns(rows: rows)

    if let colCount = colCount, colCount > 1 {
        // Table output
        print("Table (\(rows.count) rows × \(colCount) columns):")
        for (i, row) in rows.enumerated() {
            let sorted = row.sorted { $0.minX < $1.minX }
            let cells = sorted.map { $0.text }
            let line = "Row \(i+1) | \(cells.joined(separator: " | "))"
            print(line)
        }
        print("")
    }

    // Coordinate output
    let rowsWithCoords = groupRows(blocks)
    print("---")
    for row in rowsWithCoords {
        let sorted = row.sorted { $0.minX < $1.minX }
        for block in sorted {
            let x1 = String(format: "%.3f", block.minX)
            let y1 = String(format: "%.3f", block.minY)
            let x2 = String(format: "%.3f", block.maxX)
            let y2 = String(format: "%.3f", block.maxY)
            let conf = String(format: "%.2f", block.confidence)
            print("[\(x1),\(y1),\(x2),\(y2)] (confidence:\(conf)) \(block.text)")
        }
    }
}

// MARK: - Main

let args = CommandLine.arguments
let layoutMode = args.contains("--layout")
let describeMode = args.contains("--describe")
let fileArgs = args.dropFirst().filter { !$0.hasPrefix("--") }

var cgImage: CGImage?

if let firstFile = fileArgs.first {
    cgImage = loadCGImage(from: firstFile)
    if cgImage == nil {
        print("Failed to read image: \(firstFile)")
        exit(1)
    }
} else {
    print("Please provide an image path")
    print("Usage: swift <skill-dir>/scripts/ocr.swift [--layout|--describe] <image-path>")
    exit(1)
}

if describeMode {
    describeImage(cgImage!)
    exit(0)
}

let blocks = recognizeText(from: cgImage!)

if blocks.isEmpty {
    print("No text recognized")
    exit(0)
}

if layoutMode {
    formatLayout(blocks)
} else {
    // Sort in reading order: rows top-to-bottom, left-to-right within a row
    let texts = blocks.sorted { a, b in
        if abs(a.centerY - b.centerY) > 0.02 { return a.centerY > b.centerY }
        return a.minX < b.minX
    }.map { $0.text }
    print(texts.joined(separator: "\n"))
}
