"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { depositButtonLabel, readableChatError, smsBodyWithoutLink } from "@/lib/chat-display";
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
const COMPOSER_LINES = 6;

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
  const spoken = useRef("");
  const logRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const pinnedRef = useRef(true);
  const busy = status === "submitted" || status === "streaming";
  const canSend = !busy && input.trim().length > 0;
  const latest = messages[messages.length - 1];
  const latestAssistantText =
    latest?.role === "assistant" ? latest.parts.map((part) => textOf(part)).join("").trim() : "";
  const showTyping = busy && latestAssistantText.length === 0;

  useEffect(() => {
    if (!voiceOn || busy || typeof window === "undefined" || !window.speechSynthesis) return;
    const last = [...messages].reverse().find((message) => message.role === "assistant");
    const line = last?.parts.map((part) => textOf(part)).join(" ").trim() ?? "";
    if (!line || line === spoken.current) return;
    spoken.current = line;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(line));
  }, [busy, messages, voiceOn]);

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
        <div className="bubble assistant">
          Coastline, this is Marge. What is going on at the house, and when can we get in?
        </div>
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
        <label className="sr-only" htmlFor="marge-input">
          Message Marge
        </label>
        <textarea
          id="marge-input"
          ref={composerRef}
          rows={1}
          value={input}
          onChange={(event) => setInput(event.target.value)}
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
          <button type="button" className="ghost" onClick={listen} aria-label="Dictate a message">
            Mic
          </button>
          <button type="button" className={voiceOn ? "primary" : "ghost"} onClick={() => setVoiceOn((value) => !value)} aria-pressed={voiceOn}>
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
