"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";

import { formatUsd } from "@/lib/money";
import { SHOP } from "@/lib/shop";

type SpeechResult = {
  results: Array<Array<{ transcript: string }>>;
};

type SpeechRec = {
  lang: string;
  onresult: ((event: SpeechResult) => void) | null;
  start: () => void;
};

const STARTERS = ["My water heater is leaking.", "The AC is running but the house will not cool.", "The kitchen drain is backing up."];

function textOf(part: { type: string; text?: string }): string {
  return part.type === "text" && part.text ? part.text : "";
}

export function ChatPanel({ demoMode, paypalMock }: { demoMode: boolean; paypalMock: boolean }) {
  const transport = useMemo(() => new DefaultChatTransport({ api: "/api/chat" }), []);
  const { messages, sendMessage, status, error, clearError } = useChat({ transport });
  const [input, setInput] = useState("");
  const [voiceOn, setVoiceOn] = useState(false);
  const spoken = useRef("");
  const busy = status === "submitted" || status === "streaming";

  useEffect(() => {
    if (!voiceOn || busy || typeof window === "undefined" || !window.speechSynthesis) return;
    const last = [...messages].reverse().find((message) => message.role === "assistant");
    const line = last?.parts.map((part) => textOf(part)).join(" ").trim() ?? "";
    if (!line || line === spoken.current) return;
    spoken.current = line;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(line));
  }, [busy, messages, voiceOn]);

  function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    sendMessage({ text: trimmed });
    setInput("");
  }

  function listen() {
    const host = window as Window & {
      SpeechRecognition?: new () => SpeechRec;
      webkitSpeechRecognition?: new () => SpeechRec;
    };
    const Ctor = host.SpeechRecognition || host.webkitSpeechRecognition;
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.onresult = (event) => {
      const heard = event.results[0]?.[0]?.transcript ?? "";
      setInput((current) => (current ? `${current} ${heard}` : heard));
    };
    rec.start();
  }

  return (
    <section className="desk" aria-label="Chat with Marge">
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
          {error.message || "Marge dropped the radio."}{" "}
          <button type="button" className="ghost" onClick={() => clearError()}>
            Dismiss
          </button>
        </p>
      ) : null}
      <div className="log" aria-live="polite">
        <div className="bubble assistant">
          Coastline, this is Marge. What is going on at the house, and when can we get in?
        </div>
        {messages.map((message) => (
          <div key={message.id}>
            {message.parts.map((part, index) => {
              if (part.type === "text" && part.text) {
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
                return (
                  <article key={`${message.id}-sms-${index}`} className="sms">
                    <div className="from">Text message · {SHOP.phone}</div>
                    <p>{output.smsText}</p>
                    <p>
                      <a href={output.payUrl}>Open the {output.deposit ?? ""} deposit link</a>
                    </p>
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
            })}
          </div>
        ))}
        {busy ? <p className="muted">Marge is checking the board…</p> : null}
      </div>
      {messages.length === 0 ? (
        <div className="starters" style={{ padding: "0 12px 8px" }}>
          {STARTERS.map((starter) => (
            <button key={starter} type="button" onClick={() => submit(starter)}>
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
        <label className="sr-only" htmlFor="marge-input" style={{ position: "absolute", left: "-999px" }}>
          Message Marge
        </label>
        <input
          id="marge-input"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Water heater leaking. I'm Dana Ruiz…"
          disabled={busy}
          autoComplete="off"
        />
        <button type="button" className="ghost" onClick={listen} aria-label="Dictate a message">
          Mic
        </button>
        <button type="button" className={voiceOn ? "primary" : "ghost"} onClick={() => setVoiceOn((value) => !value)} aria-pressed={voiceOn}>
          Speak
        </button>
        <button className="primary" type="submit" disabled={busy || input.trim().length === 0}>
          Send
        </button>
      </form>
      <p className="muted" style={{ padding: "0 14px 12px", margin: 0 }}>
        Prices such as an {formatUsd(8900)} AC diagnostic come from the price book, not from the model.
      </p>
    </section>
  );
}
