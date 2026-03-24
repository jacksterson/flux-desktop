# Project Kickoff: Flux

**Date:** 2026-03-23
**Status:** 🟢 ACTIVE (Phase 1: Technical Prototype)

## 1. Core Problem
Desktop customization is fragmented and relies on legacy, Windows-only tech (Rainmeter). There is no high-performance, cross-platform engine that leverages modern GPU rendering (WebGPU) and AI-friendly declarative formats.

## 2. Target User
- **Primary:** Gamers and "Desk-dwellers" who appreciate high-aesthetic, high-performance UI.
- **Hook:** Fans of Hideo Kojima's aesthetic (Metal Gear Solid, Death Stranding).
- **Secondary:** Streamers looking for unique, low-overhead desktop overlays.

## 3. Monetization Model (CRITICAL)
- **Dual License:** Free for personal use. **Paid Commercial License** required for streamers, businesses, or redistributed "Pro" widget packs.
- **Sponsor-Ware:** Early access to the "Kojima Suite" for Ko-fi/GitHub Sponsors.
- **Donation Strategy:** Prominent "Support the Developer" CTA in the app and on the landing page.

## 4. MVP Scope (Max 5 Features)
1. **The Host (Rust/Tauri):** A cross-platform background daemon with system tray control.
2. **Kojima Suite V1:** A set of 3 widgets (Codec-style system monitor, Porter-style network graph, and a health-bar style RAM meter).
3. **Data Binding Engine:** A JSON manifest system to connect system stats (CPU/RAM) to UI elements.
4. **Renderer:** High-performance, click-through webview windows with basic GPU animation support.
5. **Cross-Platform Pipeline:** Automated builds for Windows, macOS, and Linux.

## 5. Success Metrics
- **30 Days:** $100 USD in donations/sponsorships + 100 landing page signups.
- **90 Days:** $500 MRR + first 5 paid Commercial Licenses sold.

## 6. Tech Stack & Directory Structure
**Stack:** Rust + Tauri (Backend), TypeScript + HTML/CSS + WebGPU (Frontend).

**Structure:**
- `flux/app/`: The Tauri host application.
- `flux/widgets/`: Source code for the "Kojima Suite".
- `flux/website/`: The landing page with Donate CTA.
- `flux/docs/`: Technical specs and research.

## 7. Immediate Action
- Create the `flux/website/` landing page with a Ko-fi link and a "Notify me when Kojima Suite drops" signup.
- Initialize the Tauri project.

---
*Note: This doc is mirrored between `bridgegap/flux/docs` and the Obsidian Vault.*