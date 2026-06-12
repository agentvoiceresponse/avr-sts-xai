# Agent Voice Response - xAI Grok Voice Agent Speech-to-Speech Integration

[![Discord](https://img.shields.io/discord/1347239846632226998?label=Discord&logo=discord)](https://discord.gg/DFTU69Hg74)
[![GitHub Repo stars](https://img.shields.io/github/stars/agentvoiceresponse/avr-sts-xai?style=social)](https://github.com/agentvoiceresponse/avr-sts-xai)
[![Docker Pulls](https://img.shields.io/docker/pulls/agentvoiceresponse/avr-sts-xai?label=Docker%20Pulls&logo=docker)](https://hub.docker.com/r/agentvoiceresponse/avr-sts-xai)
[![Ko-fi](https://img.shields.io/badge/Support%20us%20on-Ko--fi-ff5e5b.svg)](https://ko-fi.com/agentvoiceresponse)

## Overview

This repository integrates **Agent Voice Response** with the **xAI Grok Voice Agent API** for real-time speech-to-speech conversations over WebSocket.

The connector exposes the standard AVR STS WebSocket protocol on port **6041** (default), bridges 8 kHz telephony PCM from AVR to 24 kHz for xAI, and streams agent audio back as 20 ms frames.

## Features

- **Realtime STS**: Bidirectional audio via `wss://api.x.ai/v1/realtime`
- **Grok voice models**: `grok-voice-latest`, `grok-voice-think-fast-1.0`, and versioned model names
- **Built-in voices**: `eve`, `ara`, `rex`, `sal`, `leo`
- **Welcome message**: Optional verbatim greeting via `XAI_WELCOME_MESSAGE` (xAI `force_message`)
- **Barge-in**: Forwards `interruption` when user speech is detected
- **Transcripts**: User and agent transcript events to AVR
- **AVR tools**: `avr_transfer` and `avr_hangup` (plus custom tools in `tools/`)
- **Optional xAI tools**: `web_search`, `x_search`, `file_search` via environment variables

## Configuration

Copy `.env.example` to `.env` and configure:

### Required

```
XAI_API_KEY=your_xai_api_key
```

### Optional

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `6041` | AVR-facing WebSocket port |
| `XAI_WELCOME_MESSAGE` | — | Verbatim greeting played at session start via xAI `force_message` |
| `XAI_MODEL` | `grok-voice-latest` | Voice model query parameter |
| `XAI_VOICE` | `eve` | Agent voice (`eve`, `ara`, `rex`, `sal`, `leo`) |
| `XAI_TURN_DETECTION` | `server_vad` | Turn detection mode |
| `XAI_BUILTIN_TOOLS` | — | Comma-separated: `web_search`, `x_search`, `file_search` |
| `XAI_COLLECTION_IDS` | — | Collection IDs for `file_search` |
| `XAI_TRANSCRIPTION_MODEL` | `whisper-1` | Input audio transcription model |
| `XAI_LANGUAGE` | — | Transcription language hint (e.g. `it`) |
| `XAI_CONNECT_TIMEOUT_MS` | `15000` | Upstream xAI WebSocket connect timeout |
| `AMI_URL` | `http://127.0.0.1:6006` | AVR AMI service for transfer/hangup tools |

### Instructions (priority order)

1. `XAI_INSTRUCTIONS` — inline system prompt
2. `XAI_URL_INSTRUCTIONS` — HTTP endpoint returning `{ "system": "..." }` (receives `X-AVR-UUID`)
3. `XAI_FILE_INSTRUCTIONS` — local file path
4. Built-in default assistant prompt

## Usage

```bash
npm install
npm start
```

Development with auto-reload:

```bash
npm run start:dev
```

Point AVR core at `ws://<host>:6041` (or your configured `PORT`).

## Concurrency

Each AVR client connection uses dedicated audio resamplers and a dedicated xAI WebSocket session. Multiple concurrent calls are supported on a single connector instance.

## Docker

```bash
docker build -t agentvoiceresponse/avr-sts-xai:latest .
docker run --env-file .env -p 6041:6041 agentvoiceresponse/avr-sts-xai:latest
```

## AVR client protocol

**Client → connector**

- `{"type":"init","uuid":"<session-uuid>"}`
- `{"type":"audio","audio":"<base64 pcm16 8kHz>"}`

**Connector → client**

- `{"type":"audio","audio":"<base64 pcm16 8kHz 20ms frame>"}`
- `{"type":"transcript","role":"user|agent","text":"..."}`
- `{"type":"interruption"}`
- `{"type":"error","message":"..."}`

## References

- [Using xAI Grok Voice Agent STS with AVR](https://wiki.agentvoiceresponse.com/en/avr-sts-xai) — setup, Docker Compose, and AVR core wiring
- [xAI Voice Agent API](https://docs.x.ai/developers/model-capabilities/audio/voice-agent)
- [AVR STS integration guide](https://wiki.agentvoiceresponse.com/en/avr-sts-integration-implementation)

## Support & Community

*   **GitHub:** [https://github.com/agentvoiceresponse](https://github.com/agentvoiceresponse) - Report issues, contribute code.
*   **Discord:** [https://discord.gg/DFTU69Hg74](https://discord.gg/DFTU69Hg74) - Join the community discussion.
*   **Docker Hub:** [https://hub.docker.com/u/agentvoiceresponse](https://hub.docker.com/u/agentvoiceresponse) - Find Docker images.
*   **Wiki:** [https://wiki.agentvoiceresponse.com/en/home](https://wiki.agentvoiceresponse.com/en/home) - Project documentation and guides.

## Support AVR

AVR is free and open-source. If you find it valuable, consider supporting its development:

<a href="https://ko-fi.com/agentvoiceresponse" target="_blank"><img src="https://ko-fi.com/img/githubbutton_sm.svg" alt="Support us on Ko-fi"></a>

## License

MIT License - see the [LICENSE](LICENSE.md) file for details.
