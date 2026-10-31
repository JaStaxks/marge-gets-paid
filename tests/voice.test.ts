import { describe, expect, it } from "vitest";

import {
  VOICE_NETWORK_MESSAGE,
  VOICE_NO_MIC_MESSAGE,
  VOICE_PERMISSION_MESSAGE,
  VOICE_SILENCE_MESSAGE,
  VOICE_UNSUPPORTED_MESSAGE,
  actionForRecognitionError,
  assistantSpeech,
  attachDictation,
  composeDictation,
  dictationValue,
  pickEnglishVoice,
  queueSpeech,
  speechChunks,
  prefersContinuousRecognition,
  speechRecognitionCtor,
  transcriptFromResults,
  type MinimalRecognition,
} from "@/lib/voice";

function fakeRecognition() {
  const recognition: MinimalRecognition & { starts: number; stops: number; aborts: number } = {
    lang: "",
    continuous: false,
    interimResults: false,
    maxAlternatives: 0,
    onresult: null,
    onerror: null,
    onend: null,
    onstart: null,
    starts: 0,
    stops: 0,
    aborts: 0,
    start() {
      recognition.starts += 1;
      recognition.onstart?.();
    },
    stop() {
      recognition.stops += 1;
      recognition.onend?.();
    },
    abort() {
      recognition.aborts += 1;
      recognition.onend?.();
    },
  };
  return recognition;
}

describe("speech recognition support", () => {
  it("uses the unprefixed API, then webkit, and refuses an insecure page", () => {
    const Standard = class Standard {};
    const Webkit = class Webkit {};
    expect(speechRecognitionCtor({ isSecureContext: true, SpeechRecognition: Standard, webkitSpeechRecognition: Webkit })).toBe(
      Standard,
    );
    expect(speechRecognitionCtor({ isSecureContext: true, webkitSpeechRecognition: Webkit })).toBe(Webkit);
    expect(speechRecognitionCtor({ isSecureContext: false, SpeechRecognition: Standard })).toBeNull();
    expect(speechRecognitionCtor({ isSecureContext: true })).toBeNull();
    expect(speechRecognitionCtor(null)).toBeNull();
  });

  it("names the fallback a person sees when the browser cannot dictate", () => {
    expect(VOICE_UNSUPPORTED_MESSAGE).toBe("Voice is not supported in this browser. Please type.");
  });

  it("keeps one session open in Chrome and Edge, and restarts phrase by phrase on Safari", () => {
    const chrome = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
    const edge = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0";
    const android = "Mozilla/5.0 (Linux; Android 14; Pixel) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
    const safariMac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
    const safariIos = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
    const chromeIos = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.0.0 Mobile/15E148 Safari/604.1";
    expect(prefersContinuousRecognition(chrome)).toBe(true);
    expect(prefersContinuousRecognition(edge)).toBe(true);
    expect(prefersContinuousRecognition(android)).toBe(true);
    expect(prefersContinuousRecognition(safariMac)).toBe(false);
    expect(prefersContinuousRecognition(safariIos)).toBe(false);
    expect(prefersContinuousRecognition(chromeIos)).toBe(false);
    expect(prefersContinuousRecognition(chrome, 5, "MacIntel")).toBe(false);
  });
});

describe("dictation text", () => {
  it("keeps the words already in the box and replaces interim text with the latest phrase", () => {
    const interim = [{ 0: { transcript: "is leaking" }, isFinal: false }];
    const live = [
      { 0: { transcript: "is leaking" }, isFinal: true },
      { 0: { transcript: "under the sink" }, isFinal: false },
    ];
    expect(dictationValue("The water heater", interim)).toBe("The water heater is leaking");
    expect(dictationValue("The water heater", live)).toBe("The water heater is leaking under the sink");
    expect(transcriptFromResults({ length: 0 })).toBe("");
    expect(composeDictation("  Already here  ", "   ")).toBe("Already here");
  });

  it("reads only the assistant's text parts", () => {
    expect(
      assistantSpeech([
        { type: "text", text: "Tuesday at 9 works." },
        { type: "tool-quote_service" },
        { type: "text", text: " The deposit is $49. " },
      ]),
    ).toBe("Tuesday at 9 works. The deposit is $49.");
  });
});

describe("recognition errors", () => {
  it("stops for a denied mic and keeps going when the room is quiet", () => {
    expect(actionForRecognitionError("not-allowed")).toEqual({ keepListening: false, message: VOICE_PERMISSION_MESSAGE });
    expect(actionForRecognitionError("service-not-allowed").message).toBe(VOICE_PERMISSION_MESSAGE);
    expect(actionForRecognitionError("audio-capture").message).toBe(VOICE_NO_MIC_MESSAGE);
    expect(actionForRecognitionError("network").message).toBe(VOICE_NETWORK_MESSAGE);
    expect(actionForRecognitionError("aborted")).toEqual({ keepListening: false, message: null });
    expect(actionForRecognitionError("no-speech")).toEqual({ keepListening: true, message: null });
  });
});

describe("dictation session", () => {
  it("asks for live English results, writes each phrase, and does not restart after stop", () => {
    const recognition = fakeRecognition();
    const heard: string[] = [];
    const listening: boolean[] = [];
    const queued: Array<() => void> = [];
    const session = attachDictation(
      recognition,
      {
        onTranscript: (text) => heard.push(text),
        onListening: (value) => listening.push(value),
        onMessage: () => undefined,
      },
      { schedule: (fn) => queued.push(fn) },
    );

    expect(recognition.lang).toBe("en-US");
    expect(recognition.continuous).toBe(true);
    expect(recognition.interimResults).toBe(true);
    expect(session.start()).toBe(true);
    recognition.onresult?.({
      results: [{ 0: { transcript: "kitchen drain" }, isFinal: false }],
    });
    recognition.onresult?.({
      results: [{ 0: { transcript: "kitchen drain is backing up" }, isFinal: true }],
    });
    expect(heard).toEqual(["kitchen drain", "kitchen drain is backing up"]);

    session.stop();
    expect(listening.at(-1)).toBe(false);
    expect(queued).toHaveLength(0);
    recognition.onresult?.({ results: [{ 0: { transcript: "too late" } }] });
    expect(heard.at(-1)).toBe("kitchen drain is backing up");
  });

  it("surfaces a denied microphone and does not restart", () => {
    const recognition = fakeRecognition();
    recognition.start = () => {
      recognition.starts += 1;
      recognition.onerror?.({ error: "not-allowed" });
      recognition.onend?.();
    };
    const messages: Array<string | null> = [];
    const listening: boolean[] = [];
    const queued: Array<() => void> = [];
    const session = attachDictation(
      recognition,
      {
        onTranscript: () => undefined,
        onListening: (value) => listening.push(value),
        onMessage: (message) => messages.push(message),
      },
      { schedule: (fn) => queued.push(fn) },
    );
    expect(session.start()).toBe(false);
    expect(messages).toContain(VOICE_PERMISSION_MESSAGE);
    expect(listening.at(-1)).toBe(false);
    expect(queued).toHaveLength(0);
  });

  it("restarts after a quiet pause and gives up if nothing is ever heard", () => {
    const recognition = fakeRecognition();
    const messages: Array<string | null> = [];
    const queued: Array<() => void> = [];
    attachDictation(
      recognition,
      {
        onTranscript: () => undefined,
        onListening: () => undefined,
        onMessage: (message) => messages.push(message),
      },
      { schedule: (fn) => queued.push(fn), maxRestarts: 1 },
    );
    recognition.onend?.();
    expect(queued).toHaveLength(1);
    queued[0]?.();
    expect(recognition.starts).toBe(1);
    recognition.onend?.();
    expect(messages).toContain(VOICE_SILENCE_MESSAGE);
  });

  it("drops a late result once the user sends", () => {
    const recognition = fakeRecognition();
    const heard: string[] = [];
    const session = attachDictation(
      recognition,
      {
        onTranscript: (text) => heard.push(text),
        onListening: () => undefined,
        onMessage: () => undefined,
      },
      { schedule: () => undefined },
    );
    session.start();
    recognition.onresult?.({ results: [{ 0: { transcript: "Dana Ruiz" } }] });
    session.cancel();
    recognition.onresult?.({ results: [{ 0: { transcript: "should not refill the box" } }] });
    expect(heard).toEqual(["Dana Ruiz"]);
    expect(recognition.aborts).toBe(1);
  });
});

describe("spoken replies", () => {
  it("keeps every utterance and speaks after cancel so Chrome does not drop the line", () => {
    const events: string[] = [];
    const synth = {
      cancel: () => events.push("cancel"),
      resume: () => events.push("resume"),
      speak: (utterance: { text: string }) => events.push(`speak:${utterance.text}`),
      getVoices: () => [
        { lang: "en-GB", name: "Daniel", localService: true },
        { lang: "en-US", name: "Samantha", localService: true, default: true },
      ],
    };
    const queued: Array<{ fn: () => void; delayMs: number }> = [];
    const line = `${"The visit is held. ".repeat(20)}Deposit is forty nine dollars.`;
    const utterances = queueSpeech(
      synth,
      line,
      (chunk, voice) => ({ text: chunk, voice: voice?.name ?? "" }),
      (fn, delayMs) => queued.push({ fn, delayMs }),
    );
    expect(events).toEqual(["cancel"]);
    expect(utterances.length).toBeGreaterThan(1);
    expect(utterances.every((utterance) => utterance.voice === "Samantha")).toBe(true);
    expect(utterances.map((utterance) => utterance.text).join(" ")).toBe(line.replace(/\s+/g, " ").trim());
    expect(queued[0]?.delayMs).toBe(50);
    queued[0]?.fn();
    expect(events.slice(1, 3)).toEqual(["resume", `speak:${utterances[0]?.text}`]);
  });

  it("speaks immediately when the click still owns the user gesture", () => {
    const events: string[] = [];
    const synth = {
      cancel: () => events.push("cancel"),
      resume: () => events.push("resume"),
      speak: (utterance: { text: string }) => events.push(`speak:${utterance.text}`),
      getVoices: () => [],
    };
    const queued: Array<() => void> = [];
    const utterances = queueSpeech(
      synth,
      "Coastline, this is Marge.",
      (chunk) => ({ text: chunk }),
      (fn) => queued.push(fn),
      true,
    );
    expect(queued).toHaveLength(0);
    expect(events).toEqual(["resume", "speak:Coastline, this is Marge."]);
    expect(utterances).toEqual([{ text: "Coastline, this is Marge." }]);
  });

  it("splits long replies on word boundaries and prefers an American English voice", () => {
    expect(speechChunks("")).toEqual([]);
    const chunks = speechChunks("alpha beta gamma delta", 12);
    expect(chunks).toEqual(["alpha beta", "gamma delta"]);
    expect(pickEnglishVoice([{ lang: "es-ES", name: "Lucia" }, { lang: "en-US", name: "Sam", localService: true }])?.name).toBe(
      "Sam",
    );
  });
});
