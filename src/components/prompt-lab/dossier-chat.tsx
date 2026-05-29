"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Send, RotateCcw, Sparkles } from "lucide-react";

type Message = {
  role: "user" | "assistant";
  content: string;
};

export function DossierChat({ dossierId }: { dossierId: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  // Shared streaming logic for both free-form chat and structured analysis.
  async function runStream(updatedMessages: Message[], mode: "chat" | "analyze") {
    setStreaming(true);
    const assistantMsg: Message = { role: "assistant", content: "" };
    setMessages([...updatedMessages, assistantMsg]);

    try {
      const res = await fetch("/api/admin/prompt-lab/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dossierId, messages: updatedMessages, mode }),
      });

      if (!res.ok) {
        const err = await res.json();
        setMessages((prev) => {
          const copy = [...prev];
          copy[copy.length - 1] = {
            role: "assistant",
            content: `Error: ${err.error ?? "Unknown error"}`,
          };
          return copy;
        });
        setStreaming(false);
        return;
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6);
              if (data === "[DONE]") continue;
              try {
                const parsed = JSON.parse(data);
                if (parsed.text) {
                  accumulated += parsed.text;
                  setMessages((prev) => {
                    const copy = [...prev];
                    copy[copy.length - 1] = {
                      role: "assistant",
                      content: accumulated,
                    };
                    return copy;
                  });
                }
                if (parsed.error) {
                  accumulated += `\n\nError: ${parsed.error}`;
                }
              } catch {
                // skip malformed JSON
              }
            }
          }
        }
      }
    } catch (err) {
      setMessages((prev) => {
        const copy = [...prev];
        copy[copy.length - 1] = {
          role: "assistant",
          content: `Connection error: ${err instanceof Error ? err.message : "Unknown"}`,
        };
        return copy;
      });
    } finally {
      setStreaming(false);
    }
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || streaming) return;
    const userMsg: Message = { role: "user", content: text };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setInput("");
    await runStream(updatedMessages, "chat");
  }

  async function handleAnalyze() {
    if (streaming) return;
    const userMsg: Message = { role: "user", content: "Analyseer dit dossier volledig." };
    // Analysis always starts a fresh conversation so the report is at the top.
    const updatedMessages = [userMsg];
    setMessages(updatedMessages);
    setInput("");
    await runStream(updatedMessages, "analyze");
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="flex flex-col h-[500px]">
      {/* Header */}
      <div className="flex items-center gap-2 pb-3 border-b">
        <Button
          variant="default"
          size="sm"
          onClick={handleAnalyze}
          disabled={streaming}
        >
          {streaming ? (
            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5 mr-1.5" />
          )}
          Analyseer dit dossier
        </Button>
        {messages.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={() => setMessages([])}
            disabled={streaming}
          >
            <RotateCcw className="h-3 w-3 mr-1" />
            Clear chat
          </Button>
        )}
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto py-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-sm text-muted-foreground py-12">
            <p className="font-medium">AI-analyse van dit dossier</p>
            <p className="mt-1">
              Klik <span className="font-medium">&quot;Analyseer dit dossier&quot;</span> voor een volledig rapport
              (wat loopt goed / fout, prompt-aanbevelingen, vragen) — of stel zelf een vraag.
            </p>
            <div className="mt-4 flex flex-wrap gap-2 justify-center">
              {[
                "Wat zie je in de plannen?",
                "Waarom wijkt de SQM-extractie af?",
                "Stel verbeteringen voor de SQM-prompt voor",
                "Welke QQP-scores kloppen niet?",
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  className="px-3 py-1.5 text-xs rounded-full border border-border hover:bg-muted transition-colors"
                  onClick={() => {
                    setInput(suggestion);
                    textareaRef.current?.focus();
                  }}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-lg px-4 py-2.5 text-sm whitespace-pre-wrap ${
                msg.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted"
              }`}
            >
              {msg.content}
              {streaming && i === messages.length - 1 && msg.role === "assistant" && (
                <span className="inline-block w-1.5 h-4 ml-0.5 bg-current animate-pulse" />
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="border-t pt-3">
        <div className="flex gap-2">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Stel een vraag over dit dossier..."
            className="min-h-[44px] max-h-[120px] resize-none"
            rows={1}
            disabled={streaming}
          />
          <Button
            onClick={handleSend}
            disabled={!input.trim() || streaming}
            size="icon"
            className="shrink-0 h-[44px] w-[44px]"
          >
            {streaming ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
