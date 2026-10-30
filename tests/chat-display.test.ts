import { describe, expect, it } from "vitest";

import { depositButtonLabel, readableChatError, smsBodyWithoutLink } from "@/lib/chat-display";

describe("chat display copy", () => {
  it("shows a sentence when a chat failure is blank or a JSON body", () => {
    expect(readableChatError(undefined)).toBe("Marge could not reply. Send that again.");
    expect(readableChatError({ message: "   " })).toBe("Marge could not reply. Send that again.");
    expect(readableChatError({ message: '{"error":"Marge could not book that. Try again."}' })).toBe(
      "Marge could not book that. Try again.",
    );
    expect(readableChatError({ message: "Network down." })).toBe("Network down.");
  });

  it("labels the deposit button and drops the raw url from the text", () => {
    const url = "http://localhost:3000/pay/job_abc";
    expect(depositButtonLabel("$49.00")).toBe("Pay $49.00 deposit");
    expect(depositButtonLabel("  ")).toBe("Pay the deposit");
    expect(
      smsBodyWithoutLink(
        `Coastline Heating & Plumbing: Hi Dana, your Tue visit is held. Deposit $49.00: ${url}`,
        url,
      ),
    ).toBe("Coastline Heating & Plumbing: Hi Dana, your Tue visit is held. Deposit $49.00");
  });
});
