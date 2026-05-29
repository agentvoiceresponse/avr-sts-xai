# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-05-29

### Added

- Initial xAI Grok Voice Agent STS connector for AVR (`wss://api.x.ai/v1/realtime`).
- AVR WebSocket protocol: `init`, `audio`, `transcript`, `interruption`, `error`.
- 8 kHz ↔ 24 kHz PCM resampling with per-session resamplers (safe for concurrent calls).
- Custom function tools via `avr_tools/` and `tools/` (`avr_transfer`, `avr_hangup`).
- Optional built-in xAI tools (`web_search`, `x_search`, `file_search`) via `XAI_BUILTIN_TOOLS`.
- Instruction loading via `XAI_INSTRUCTIONS`, `XAI_URL_INSTRUCTIONS`, or `XAI_FILE_INSTRUCTIONS`.
- Input audio transcription config for user transcript events.
- Upstream connection timeout (`XAI_CONNECT_TIMEOUT_MS`, default 15s).

### Fixed

- Ignore duplicate `init` messages; prevent orphaned xAI WebSocket sessions.
- Idempotent session cleanup to avoid double-close races.
- Validate URL/file instruction payloads; fall back to default when invalid.
- Skip non-finite VAD numeric environment values in `session.update`.
