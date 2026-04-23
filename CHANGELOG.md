# Changelog

All notable changes to this project will be documented in this file.

## [0.3.1] - 2026-04-23

### Added
- Added fallback source-session discovery so a new session can still recover the newest pending staged `/fxxk` prompt from an earlier same-directory session when an explicit session link is missing.
- Added integration coverage for choosing the most recent eligible same-directory source session during fallback prompt recovery.

### Fixed
- Preserved compatibility with legacy handoff state entries, including historic `fuck-state` custom entries and typeless custom entries that still carry recognized `/fxxk` state kinds.
- Normalized `/fxxk` state writes to always use the configured custom entry type, preventing mixed state-entry formats during staging, consumption, and source-session link cleanup.

## [0.3.0] - 2026-04-22

### Added
- Added richer continuation handoff contracts so staged `/fxxk` prompts preserve completed work, remaining work, key files, verification state, constraints, and completion criteria when that evidence exists.
- Added better fallback handoff generation that keeps workflow context and the natural response language implied by recent session evidence.

### Changed
- Improved `/fxxk` staging and consumption behavior to better preserve explicit handoff prompts and structured progress from the source session.
- Updated the handoff prompt flow to prefer stronger continuation contracts over minimal next-step recaps.

### Fixed
- Prevented staged prompts from being consumed in a different working directory than the source session.
- Fixed a runtime `ReferenceError` caused by a missing `getLatestPendingStagedPrompt` import when exiting the staged prompt review with `Esc`.
