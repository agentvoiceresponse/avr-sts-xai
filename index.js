/**
 * index.js
 * Entry point for the xAI Grok Voice Agent Speech-to-Speech streaming WebSocket server.
 *
 * Client Protocol:
 * - Send {"type": "init", "uuid": "uuid"} to initialize session
 * - Send {"type": "audio", "audio": "base64_encoded_audio"} to stream audio
 * - Receive {"type": "audio", "audio": "base64_encoded_audio"} for responses
 * - Receive {"type": "error", "message": "error_message"} for errors
 *
 * @author Agent Voice Response <info@agentvoiceresponse.com>
 * @see https://www.agentvoiceresponse.com
 */

const WebSocket = require("ws");
const axios = require("axios");
const fs = require("fs").promises;
const { create } = require("@alexanderolsen/libsamplerate-js");
const { loadTools, getToolHandler } = require("./loadTools");

require("dotenv").config();

const DEFAULT_MODEL = "grok-voice-latest";
const DEFAULT_INSTRUCTIONS =
  "You are a helpful assistant that can answer questions and help with tasks.";
const REALTIME_PCM_RATE = 24000;
const REALTIME_PCM_FORMAT = { type: "audio/pcm", rate: REALTIME_PCM_RATE };
const XAI_VOICES = new Set(["eve", "ara", "rex", "sal", "leo"]);
const CONNECT_TIMEOUT_MS = Number(process.env.XAI_CONNECT_TIMEOUT_MS) || 15000;

if (!process.env.XAI_API_KEY) {
  throw new Error("XAI_API_KEY is not set");
}

const parseFiniteEnv = (name) => {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
};

const resolveModel = () => process.env.XAI_MODEL || DEFAULT_MODEL;

const resolveVoice = () => {
  const voice = (process.env.XAI_VOICE || "eve").toLowerCase();
  return XAI_VOICES.has(voice) ? voice : "eve";
};

const buildTurnDetection = () => {
  const turnDetection = {
    type: (process.env.XAI_TURN_DETECTION || "server_vad").toLowerCase(),
  };

  const threshold = parseFiniteEnv("XAI_TURN_DETECTION_THRESHOLD");
  if (threshold !== undefined) turnDetection.threshold = threshold;

  const silenceMs = parseFiniteEnv("XAI_TURN_DETECTION_SILENCE_MS");
  if (silenceMs !== undefined) turnDetection.silence_duration_ms = silenceMs;

  const prefixPaddingMs = parseFiniteEnv("XAI_TURN_DETECTION_PREFIX_PADDING_MS");
  if (prefixPaddingMs !== undefined) {
    turnDetection.prefix_padding_ms = prefixPaddingMs;
  }

  return turnDetection;
};

const buildBuiltinTools = () => {
  const raw = process.env.XAI_BUILTIN_TOOLS;
  if (!raw) return [];

  const tools = [];
  for (const name of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
    if (name === "web_search") {
      tools.push({ type: "web_search" });
    } else if (name === "x_search") {
      tools.push({ type: "x_search" });
    } else if (name === "file_search") {
      const ids = (process.env.XAI_COLLECTION_IDS || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (ids.length === 0) {
        console.warn("file_search requested but XAI_COLLECTION_IDS is empty");
        continue;
      }
      tools.push({
        type: "file_search",
        vector_store_ids: ids,
        max_num_results: 10,
      });
    } else {
      console.warn(`Unknown XAI_BUILTIN_TOOLS entry: ${name}`);
    }
  }
  return tools;
};

const connectToXai = () => {
  const model = resolveModel();
  console.log("Connecting to xAI Voice Agent with model:", model);
  return new WebSocket(`wss://api.x.ai/v1/realtime?model=${model}`, {
    headers: {
      Authorization: `Bearer ${process.env.XAI_API_KEY}`,
    },
  });
};

const resolveInstructions = async (sessionUuid) => {
  if (process.env.XAI_INSTRUCTIONS) {
    console.log("Using XAI_INSTRUCTIONS from environment variable");
    return process.env.XAI_INSTRUCTIONS;
  }

  if (process.env.XAI_URL_INSTRUCTIONS) {
    console.log("Using XAI_URL_INSTRUCTIONS from environment variable");
    try {
      const response = await axios.get(process.env.XAI_URL_INSTRUCTIONS, {
        headers: {
          "Content-Type": "application/json",
          "X-AVR-UUID": sessionUuid,
        },
      });
      const system = response.data?.system;
      if (typeof system === "string" && system.trim()) {
        return system;
      }
      console.error(
        `Invalid instructions payload from ${process.env.XAI_URL_INSTRUCTIONS}: missing or empty "system" field`
      );
    } catch (error) {
      console.error(
        `Error loading instructions from ${process.env.XAI_URL_INSTRUCTIONS}: ${error.message}`
      );
    }
  }

  if (process.env.XAI_FILE_INSTRUCTIONS) {
    console.log("Using XAI_FILE_INSTRUCTIONS from environment variable");
    try {
      const text = await fs.readFile(process.env.XAI_FILE_INSTRUCTIONS, "utf8");
      if (text.trim()) return text;
      console.error(
        `Empty instructions file: ${process.env.XAI_FILE_INSTRUCTIONS}`
      );
    } catch (error) {
      console.error(
        `Error loading instructions from ${process.env.XAI_FILE_INSTRUCTIONS}: ${error.message}`
      );
    }
  }

  console.log("Using default instructions");
  return DEFAULT_INSTRUCTIONS;
};

const sendClientError = (clientWs, message) => {
  if (clientWs.readyState === WebSocket.OPEN) {
    clientWs.send(JSON.stringify({ type: "error", message }));
  }
};

const handleClientConnection = (clientWs) => {
  console.log("New client WebSocket connection received");

  let sessionUuid = null;
  let sessionInitialized = false;
  let audioBuffer8k = [];
  let ws = null;
  let cleaned = false;
  let connectTimeout = null;
  let downsampler = null;
  let upsampler = null;

  const destroySessionResamplers = () => {
    if (downsampler) {
      downsampler.destroy();
      downsampler = null;
    }
    if (upsampler) {
      upsampler.destroy();
      upsampler = null;
    }
  };

  const createSessionResamplers = async () => {
    downsampler = await create(1, 24000, 8000);
    upsampler = await create(1, 8000, 24000);
  };

  function processXaiAudioChunk(inputBuffer) {
    const inputSamples = new Int16Array(
      inputBuffer.buffer,
      inputBuffer.byteOffset,
      inputBuffer.length / 2
    );

    const downsampledSamples = downsampler.full(inputSamples);
    audioBuffer8k = audioBuffer8k.concat(Array.from(downsampledSamples));

    const audioFrames = [];
    while (audioBuffer8k.length >= 160) {
      const frame = audioBuffer8k.slice(0, 160);
      audioBuffer8k = audioBuffer8k.slice(160);
      audioFrames.push(Buffer.from(Int16Array.from(frame).buffer));
    }

    return audioFrames;
  }

  function convert8kTo24k(inputBuffer) {
    const inputSamples = new Int16Array(
      inputBuffer.buffer,
      inputBuffer.byteOffset,
      inputBuffer.length / 2
    );
    const upsampledSamples = upsampler.full(inputSamples);
    return Buffer.from(Int16Array.from(upsampledSamples).buffer);
  }

  const sendFunctionResult = (callId, output) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(
      JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: callId,
          output: typeof output === "string" ? output : JSON.stringify(output),
        },
      })
    );
    ws.send(JSON.stringify({ type: "response.create" }));
  };

  function cleanup() {
    if (cleaned) return;
    cleaned = true;

    if (connectTimeout) {
      clearTimeout(connectTimeout);
      connectTimeout = null;
    }

    const upstream = ws;
    ws = null;
    if (upstream) {
      upstream.removeAllListeners();
      if (
        upstream.readyState === WebSocket.OPEN ||
        upstream.readyState === WebSocket.CONNECTING
      ) {
        upstream.close();
      }
    }

    destroySessionResamplers();

    if (
      clientWs.readyState === WebSocket.OPEN ||
      clientWs.readyState === WebSocket.CONNECTING
    ) {
      clientWs.close();
    }
  }

  const initializeXaiConnection = async () => {
    if (ws) {
      console.log("xAI connection already active; skipping duplicate init");
      return;
    }

    try {
      await createSessionResamplers();
    } catch (error) {
      console.error("Failed to create session resamplers:", error);
      sendClientError(clientWs, "Failed to initialize audio processing");
      cleanup();
      return;
    }

    ws = connectToXai();

    connectTimeout = setTimeout(() => {
      if (ws && ws.readyState !== WebSocket.OPEN) {
        console.error(
          `xAI connection timed out after ${CONNECT_TIMEOUT_MS}ms`
        );
        sendClientError(clientWs, "xAI Voice Agent connection timeout");
        cleanup();
      }
    }, CONNECT_TIMEOUT_MS);

    ws.on("open", async () => {
      if (cleaned) return;

      if (connectTimeout) {
        clearTimeout(connectTimeout);
        connectTimeout = null;
      }

      console.log("WebSocket connected to xAI Voice Agent");

      const instructions = await resolveInstructions(sessionUuid);
      const session = {
        instructions,
        voice: resolveVoice(),
        turn_detection: buildTurnDetection(),
        audio: {
          input: {
            format: REALTIME_PCM_FORMAT,
            transcription: {
              model: process.env.XAI_TRANSCRIPTION_MODEL || "whisper-1",
            },
          },
          output: { format: REALTIME_PCM_FORMAT },
        },
      };

      if (process.env.XAI_LANGUAGE) {
        session.audio.input.transcription.language = process.env.XAI_LANGUAGE;
      }

      const tools = [...buildBuiltinTools(), ...loadTools()];
      if (tools.length > 0) {
        session.tools = tools;
        console.log(`Loaded ${tools.length} tools for xAI Voice Agent`);
      }

      ws.send(JSON.stringify({ type: "session.update", session }));
    });

    ws.on("message", async (data) => {
      if (cleaned) return;

      try {
        const message = JSON.parse(data);

        switch (message.type) {
          case "error":
            console.error("xAI Voice Agent error:", message.error);
            sendClientError(
              clientWs,
              message.error?.message || "xAI Voice Agent error"
            );
            break;

          case "session.updated":
            console.log("Session updated");
            ws.send(JSON.stringify({ type: "response.create" }));
            break;

          case "response.output_audio.delta":
          case "response.audio.delta": {
            const audioChunk = Buffer.from(message.delta, "base64");
            const audioFrames = processXaiAudioChunk(audioChunk);
            audioFrames.forEach((frame) => {
              if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(
                  JSON.stringify({
                    type: "audio",
                    audio: frame.toString("base64"),
                  })
                );
              }
            });
            break;
          }

          case "response.function_call_arguments.done": {
            const handler = getToolHandler(message.name);
            if (!handler) {
              const errMsg = `No handler found for tool: ${message.name}`;
              console.error(errMsg);
              sendClientError(clientWs, errMsg);
              return;
            }

            try {
              const content = await handler(
                sessionUuid,
                JSON.parse(message.arguments)
              );
              console.log("Tool response:", content);
              if (!message.call_id) {
                console.error("Missing call_id on function call event");
                sendClientError(
                  clientWs,
                  "Missing call_id on function call event"
                );
                return;
              }
              sendFunctionResult(message.call_id, content);
            } catch (error) {
              const errMsg = `Tool ${message.name} failed: ${error.message}`;
              console.error(errMsg, error);
              sendClientError(clientWs, errMsg);
            }
            break;
          }

          case "response.output_audio_transcript.done":
          case "response.audio_transcript.done": {
            const agentData = {
              type: "transcript",
              role: "agent",
              text: message.transcript,
            };
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(JSON.stringify(agentData));
            }
            console.log("Agent transcript:", agentData);
            break;
          }

          case "input_audio_buffer.speech_started":
            console.log("User speech started (barge-in)");
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(JSON.stringify({ type: "interruption" }));
            }
            break;

          case "conversation.item.input_audio_transcription.completed": {
            const userData = {
              type: "transcript",
              role: "user",
              text: message.transcript,
            };
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(JSON.stringify(userData));
            }
            console.log("User transcript:", userData);
            break;
          }

          default:
            console.log("Received message type:", message.type);
            break;
        }
      } catch (error) {
        console.error("Error processing xAI WebSocket message:", error);
      }
    });

    ws.on("close", () => {
      console.log("xAI WebSocket connection closed");
      cleanup();
    });

    ws.on("error", (err) => {
      console.error("xAI WebSocket error:", err);
      if (!cleaned) {
        sendClientError(clientWs, "xAI Voice Agent connection error");
      }
      cleanup();
    });
  };

  clientWs.on("message", async (data) => {
    try {
      const message = JSON.parse(data);
      switch (message.type) {
        case "init":
          if (sessionInitialized) {
            console.log("Ignoring duplicate init for session:", sessionUuid);
            break;
          }
          sessionUuid = message.uuid;
          sessionInitialized = true;
          console.log("Session UUID:", sessionUuid);
          await initializeXaiConnection();
          break;

        case "audio":
          if (
            message.audio &&
            ws &&
            ws.readyState === WebSocket.OPEN &&
            downsampler &&
            upsampler
          ) {
            const audioBuffer = Buffer.from(message.audio, "base64");
            const upsampledAudio = convert8kTo24k(audioBuffer);
            ws.send(
              JSON.stringify({
                type: "input_audio_buffer.append",
                audio: upsampledAudio.toString("base64"),
              })
            );
          }
          break;

        default:
          console.log("Unknown message type from client:", message.type);
          break;
      }
    } catch (error) {
      console.error("Error processing client message:", error);
    }
  });

  clientWs.on("close", () => {
    console.log("Client WebSocket connection closed");
    cleanup();
  });

  clientWs.on("error", (err) => {
    console.error("Client WebSocket error:", err);
    cleanup();
  });
};

let wss = null;

const shutdown = () => {
  console.log("Shutting down xAI STS server...");
  if (wss) {
    wss.close();
    wss = null;
  }
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

const startServer = async () => {
  const PORT = process.env.PORT || 6041;
  wss = new WebSocket.Server({ port: PORT });

  wss.on("connection", (clientWs) => {
    console.log("New client connected");
    handleClientConnection(clientWs);
  });

  console.log(
    `xAI Voice Agent Speech-to-Speech WebSocket server running on port ${PORT}`
  );
};

startServer().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
