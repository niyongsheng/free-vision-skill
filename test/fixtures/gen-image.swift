#!/usr/bin/env swift
// 生成一张带文字的测试图片，供 smoke 测试使用
// 用法: swift gen-image.swift <output.png>

import AppKit
import Foundation

let width: CGFloat = 800
let height: CGFloat = 300

let image = NSImage(size: NSSize(width: width, height: height))
image.lockFocus()

// 白色背景
NSColor.white.setFill()
NSRect(x: 0, y: 0, width: width, height: height).fill()

// 黑色文字（AppKit 自动处理文字方向）
let attrs: [NSAttributedString.Key: Any] = [
    .font: NSFont.systemFont(ofSize: 60),
    .foregroundColor: NSColor.black,
]
NSAttributedString(string: "Hello Vision 123", attributes: attrs)
    .draw(at: NSPoint(x: 60, y: 100))

image.unlockFocus()

// 写出 PNG
let rep = NSBitmapImageRep(data: image.tiffRepresentation!)!
let data = rep.representation(using: .png, properties: [:])!
try! data.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
