"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { depositButtonLabel, readableChatError, smsBodyWithoutLink } from "@/lib/chat-display";
import { formatUsd } from "@/lib/money";
import { SHOP } from "@/lib/shop";
import {
  VOICE_LISTENING_MESSAGE,
  VOICE_UNSUPPORTED_MESSAGE,
  assistantSpeech,
  attachDictation,
  composeDictation,
  queueSpeech,
  prefersContinuousRecognition,
  speechRecognitionCtor,
  type DictationSession,
  type SpeechHost,
} from "@/lib/voice";

const STARTERS = ["My water heater is leaking.", "The AC is running but the house will not cool.", "The kitchen drain is backing up."];
const COMPOSER_LINES = 6;
const GREETING = "Coastline, this is Marge. What is going on at the house, and when can we get in?";

function makeUtterance(chunk: string, voice: SpeechSynthesisVoice | null): SpeechSynthesisUtterance {
  const utterance = new SpeechSynthesisUtterance(chunk);
  utterance.lang = voice?.lang || "en-US";
  if (voice) utterance.voice = voice;
  return utterance;
}

function textOf(part: { type: string; text?: string }): string {
  return part.type === "text" && part.text ? part.text : "";
}

function resizeComposer(node: HTMLTextAreaElement | null) {
  if (!node) return;
  node.style.height = "auto";
  const computed = window.getComputedStyle(node);
  const line = Number.parseFloat(computed.lineHeight) || 24;
  const chrome =
    (Number.parseFloat(computed.paddingTop) || 0) +
    (Number.parseFloat(computed.paddingBottom) || 0) +
    (Number.parseFloat(computed.borderTopWidth) || 0) +
    (Number.parseFloat(computed.borderBottomWidth) || 0);
  const max = line * COMPOSER_LINES + chrome;
  const next = Math.min(node.scrollHeight, max);
  node.style.height = `${next}px`;
  node.style.overflowY = node.scrollHeight > max + 1 ? "auto" : "hidden";
}

export function ChatPanel({ demoMode, paypalMock }: { demoMode: boolean; paypalMock: boolean }) {
  const transport = useMemo(() => new DefaultChatTransport({ api: "/api/chat" }), []);
  const { messages, sendMessage, status, error, clearError } = useChat({ transport });
  const [input, setInput] = useState("");
  const [voiceOn, setVoiceOn] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  const spoken = useRef("");
  const logRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const pinnedRef = useRef(true);
  const inputRef = useRef(input);
  const sessionRef = useRef<DictationSession | null>(null);
  const listeningRef = useRef(false);
  const baseTextRef = useRef("");
  const utterancesRef = useRef<SpeechSynthesisUtterance[]>([]);
  const speechTimer = useRef<number | null>(null);
  const busy = status === "submitted" || status === "streaming";
  const canSend = !busy && input.trim().length > 0;
  const latest = messages[messages.length - 1];
  const latestAssistantText = latest?.role === "assistant" ? assistantSpeech(latest.parts) : "";
  const showTyping = busy && latestAssistantText.length === 0;
  inputRef.current = input;

  function endDictation(mode: "stop" | "cancel") {
    listeningRef.current = false;
    const session = sessionRef.current;
    sessionRef.current = null;
    if (!session) {
      setListening(false);
      return;
    }
    if (mode === "cancel") session.cancel();
    else session.stop();
  }

  function speakLine(line: string, immediate: boolean) {
    const synth = window.speechSynthesis;
    if (!synth || !line || line === spoken.current) return;
    if (speechTimer.current !== null) {
      window.clearTimeout(speechTimer.current);
      speechTimer.current = null;
    }
    try {
      const queued = queueSpeech(
        synth,
        line,
        makeUtterance,
        (fn, delayMs) => {
          speechTimer.current = window.setTimeout(fn, delayMs);
        },
        immediate,
      );
      spoken.current = line;
      utterancesRef.current = queued;
    } catch {
      spoken.current = "";
    }
  }

  function lineToSpeak(greetWhenQuiet: boolean): string {
    const last = [...messages].reverse().find((message) => message.role === "assistant");
    const line = last ? assistantSpeech(last.parts) : "";
    if (line) return line;
    if (greetWhenQuiet && !messages.some((message) => message.role === "assistant")) return GREETING;
    return "";
  }

  useEffect(() => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const cacheVoices = () => {
      synth.getVoices();
    };
    cacheVoices();
    synth.addEventListener("voiceschanged", cacheVoices);
    return () => {
      synth.removeEventListener("voiceschanged", cacheVoices);
      sessionRef.current?.cancel();
      sessionRef.current = null;
      if (speechTimer.current !== null) window.clearTimeout(speechTimer.current);
      utterancesRef.current = [];
      synth.cancel();
    };
  }, []);

  useEffect(() => {
    if (!voiceOn || busy || listening) return;
    speakLine(lineToSpeak(false), false);
  }, [busy, listening, messages, voiceOn]);

  useLayoutEffect(() => {
    resizeComposer(composerRef.current);
  }, [input]);

  useEffect(() => {
    const node = logRef.current;
    if (!node) return;
    const onScroll = () => {
      pinnedRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
    };
    node.addEventListener("scroll", onScroll, { passive: true });
    return () => node.removeEventListener("scroll", onScroll);
  }, []);

  useLayoutEffect(() => {
    const node = logRef.current;
    if (!node || !pinnedRef.current) return;
    node.scrollTop = node.scrollHeight;
  }, [messages, showTyping, error]);

  function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    endDictation("cancel");
    window.speechSynthesis?.cancel();
    utterancesRef.current = [];
    sendMessage({ text: trimmed });
    setInput("");
    baseTextRef.current = "";
  }

  function listen() {
    if (listeningRef.current || sessionRef.current) {
      endDictation("stop");
      return;
    }
    const host = window as Window & SpeechHost;
    const Ctor = speechRecognitionCtor({
      isSecureContext: host.isSecureContext,
      SpeechRecognition: host.SpeechRecognition,
      webkitSpeechRecognition: host.webkitSpeechRecognition,
    });
    if (!Ctor) {
      setVoiceNote(VOICE_UNSUPPORTED_MESSAGE);
      return;
    }
    window.speechSynthesis?.cancel();
    utterancesRef.current = [];
    baseTextRef.current = inputRef.current;
    let recognition: InstanceType<typeof Ctor>;
    try {
      recognition = new Ctor();
    } catch {
      setVoiceNote(VOICE_UNSUPPORTED_MESSAGE);
      return;
    }
    const session = attachDictation(
      recognition,
      {
        onTranscript: (heard) => {
          setInput(composeDictation(baseTextRef.current, heard));
        },
        onListening: (isListening) => {
          listeningRef.current = isListening;
          setListening(isListening);
          if (isListening) setVoiceNote(null);
        },
        onMessage: (message) => setVoiceNote(message),
      },
      {
        continuous: prefersContinuousRecognition(navigator.userAgent, navigator.maxTouchPoints, navigator.platform),
      },
    );
    sessionRef.current = session;
    if (!session.start()) {
      sessionRef.current = null;
      return;
    }
    listeningRef.current = true;
    setListening(true);
    setVoiceNote(null);
  }

  function toggleSpeak() {
    const synth = window.speechSynthesis;
    if (!synth) {
      setVoiceNote(VOICE_UNSUPPORTED_MESSAGE);
      return;
    }
    if (voiceOn) {
      synth.cancel();
      utterancesRef.current = [];
      spoken.current = "";
      if (speechTimer.current !== null) {
        window.clearTimeout(speechTimer.current);
        speechTimer.current = null;
      }
      setVoiceOn(false);
      return;
    }
    setVoiceNote(null);
    synth.resume();
    synth.getVoices();
    const line = lineToSpeak(true);
    if (line) speakLine(line, true);
    else {
      const primer = new SpeechSynthesisUtterance(" ");
      primer.volume = 0;
      utterancesRef.current = [primer];
      try {
        synth.speak(primer);
      } catch {
        setVoiceNote(VOICE_UNSUPPORTED_MESSAGE);
        return;
      }
    }
    setVoiceOn(true);
  }

  function editComposer() {
    if (!listeningRef.current) return;
    endDictation("cancel");
  }

  return (
    <section className="desk" aria-label="Chat with Marge" aria-busy={busy}>
      <header>
        <div>
          <div className="who">{SHOP.receptionist}</div>
          <p>Front desk · {SHOP.name}</p>
        </div>
        <span className="pill">{demoMode ? "Demo replies" : "Gemini"} · {paypalMock ? "PayPal mock" : "PayPal sandbox"}</span>
      </header>
      {demoMode ? (
        <p className="banner">
          No GEMINI_API_KEY on this server, so Marge is using the scripted receptionist. Add the key for the live model.
        </p>
      ) : null}
      {error ? (
        <p className="banner error-banner" role="alert">
          {readableChatError(error)}{" "}
          <button type="button" className="ghost" onClick={() => clearError()}>
            Dismiss
          </button>
        </p>
      ) : null}
      <div className="log" ref={logRef} aria-live="polite">
        <div className="bubble assistant">{GREETING}</div>
        {messages.map((message) => {
          const parts = message.parts.map((part, index) => {
            if (part.type === "text" && part.text?.trim()) {
              return (
                <p key={`${message.id}-${index}`} className={`bubble ${message.role === "user" ? "user" : "assistant"}`}>
                  {part.text}
                </p>
              );
            }
            if (part.type === "tool-quote_service" && "output" in part && part.output && typeof part.output === "object") {
              const output = part.output as { serviceName?: string; quote?: string; deposit?: string; summary?: string };
              if (!output.serviceName) return null;
              return (
                <div key={`${message.id}-quote-${index}`} className="quote-card">
                  <strong>{output.serviceName}</strong>
                  <div>{output.summary}</div>
                  <div>
                    Quote {output.quote} · deposit {output.deposit}
                  </div>
                </div>
              );
            }
            if (
              part.type === "tool-create_deposit_order" &&
              "state" in part &&
              part.state === "output-available" &&
              part.output &&
              typeof part.output === "object"
            ) {
              const output = part.output as { smsText?: string; payUrl?: string; deposit?: string };
              if (!output.payUrl) return null;
              const preview = smsBodyWithoutLink(output.smsText ?? "", output.payUrl);
              return (
                <article key={`${message.id}-sms-${index}`} className="sms">
                  <div className="from">Text message · {SHOP.phone}</div>
                  {preview ? <p>{preview}</p> : null}
                  <a className="pay-deposit" href={output.payUrl}>
                    {depositButtonLabel(output.deposit)}
                  </a>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => {
                      void navigator.clipboard?.writeText(output.payUrl || "");
                    }}
                  >
                    Copy link
                  </button>
                </article>
              );
            }
            if (part.type.startsWith("tool-") && "state" in part && part.state === "output-error") {
              return (
                <p key={`${message.id}-err-${index}`} className="banner error-banner">
                  Tool failed. Marge can try that step again.
                </p>
              );
            }
            return null;
          });
          if (parts.every((part) => part == null)) return null;
          return <div key={message.id}>{parts}</div>;
        })}
        {showTyping ? (
          <div className="bubble assistant typing" role="status">
            <span className="typing-dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            Marge is typing
          </div>
        ) : null}
      </div>
      {messages.length === 0 ? (
        <div className="starters">
          {STARTERS.map((starter) => (
            <button key={starter} type="button" disabled={busy} onClick={() => submit(starter)}>
              {starter}
            </button>
          ))}
        </div>
      ) : null}
      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          submit(input);
        }}
      >
        {listening || voiceNote ? (
          <p className={listening ? "voice-status" : "voice-note"} id="voice-status" role={listening ? "status" : "alert"}>
            {listening ? VOICE_LISTENING_MESSAGE : voiceNote}
          </p>
        ) : null}
        <label className="sr-only" htmlFor="marge-input">
          Message Marge
        </label>
        <textarea
          id="marge-input"
          ref={composerRef}
          rows={1}
          value={input}
          className={listening ? "is-listening" : undefined}
          aria-describedby={listening || voiceNote ? "voice-status" : undefined}
          onPointerDown={editComposer}
          onChange={(event) => {
            setInput(event.target.value);
            setVoiceNote(null);
            editComposer();
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
            event.preventDefault();
            submit(input);
          }}
          placeholder="Water heater leaking. I'm Dana Ruiz…"
          autoComplete="off"
          autoFocus
          enterKeyHint="send"
        />
        <div className="composer-actions">
          <button
            type="button"
            className={listening ? "mic-live" : "ghost"}
            onClick={listen}
            aria-pressed={listening}
            aria-label={listening ? "Stop dictation" : "Dictate a message"}
          >
            {listening ? "Listening" : "Mic"}
          </button>
          <button
            type="button"
            className={voiceOn ? "primary" : "ghost"}
            onClick={toggleSpeak}
            aria-pressed={voiceOn}
            aria-label={voiceOn ? "Stop spoken replies" : "Speak Marge's replies"}
          >
            Speak
          </button>
          <button className="primary" type="submit" disabled={!canSend}>
            Send
          </button>
        </div>
      </form>
      <p className="muted footnote">
        Prices such as an {formatUsd(8900)} AC diagnostic come from the price book, not from the model.
      </p>
    </section>
  );
}
