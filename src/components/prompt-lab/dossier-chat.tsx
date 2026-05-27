"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Send, Play, RotateCcw } from "lucide-react";

type Message = {
  role: "user" | "assistant";
  content: string;
};

type EstimationResult = {
  cat1_sqm: number;
  cat2_sqm: number;
  cat3_sqm: number;
  total_cost: number;
  finishing_coefficient: number | null;
  confidence: number | null;
  processing_time_ms: number | null;
  warnings: string[];
};

type TestResult = {
  estimationId: string;
  status: "polling" | "done" | "error";
  detail?: string;
  result?: EstimationResult;
};

export function DossierChat({ dossierId }: { dossierId: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  async function handleSend() {
    const text = input.trim();
    if (!text || streaming) return;

    const userMsg: Message = { role: "user", content: text };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setInput("");
    setStreaming(true);

    // Add empty assistant message that we'll stream into
    const assistantMsg: Message = { role: "assistant", content: "" };
    setMessages([...updatedMessages, assistantMsg]);

    try {
      const res = await fetch("/api/admin/prompt-lab/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dossierId, messages: updatedMessages }),
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

  async function handleTestDossier() {
    setTestResult({ estimationId: "", status: "polling", detail: "Starting pipeline..." });

    try {
      const res = await fetch("/api/admin/prompt-lab/test-dossier", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dossierId }),
      });
      const data = await res.json();

      if (!res.ok) {
        setTestResult({ estimationId: "", status: "error", detail: data.error });
        return;
      }

      const { estimationId } = data;
      setTestResult({ estimationId, status: "polling", detail: "Pipeline running..." });

      // Poll until done (max 10 min)
      for (let i = 0; i < 240; i++) {
        await new Promise((r) => setTimeout(r, 2500));
        try {
          const pollRes = await fetch(`/api/prompt-lab/poll-estimation/${estimationId}`);
          if (pollRes.ok) {
            const pollData = await pollRes.json();
            if (pollData.done) {
              setTestResult({
                estimationId,
                status: pollData.status === "complete" ? "done" : "error",
                detail: pollData.status === "complete" ? "Pipeline complete!" : (pollData.error_message ?? "Pipeline failed"),
                result: pollData.result,
              });
              return;
            }
          }
          setTestResult({
            estimationId,
            status: "polling",
            detail: `Pipeline running... (${Math.round((i + 1) * 2.5)}s)`,
          });
        } catch {
          // network hiccup — retry
        }
      }

      setTestResult({ estimationId, status: "error", detail: "Timed out (>10 min)" });
    } catch (err) {
      setTestResult({
        estimationId: "",
        status: "error",
        detail: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="flex flex-col h-[600px]">
      {/* Toolbar */}
      <div className="flex items-center gap-2 pb-3 border-b">
        <Button
          variant="outline"
          size="sm"
          onClick={handleTestDossier}
          disabled={testResult?.status === "polling"}
        >
          {testResult?.status === "polling" ? (
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
          ) : (
            <Play className="h-3 w-3 mr-1" />
          )}
          Test dossier
        </Button>
        {testResult && (
          <span
            className={`text-xs ${
              testResult.status === "done"
                ? "text-green-600"
                : testResult.status === "error"
                  ? "text-destructive"
                  : "text-muted-foreground"
            }`}
          >
            {testResult.detail}
            {testResult.result?.processing_time_ms && (
              <span className="text-muted-foreground ml-1">
                ({(testResult.result.processing_time_ms / 1000).toFixed(0)}s)
              </span>
            )}
          </span>
        )}
        {messages.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={() => setMessages([])}
          >
            <RotateCcw className="h-3 w-3 mr-1" />
            Clear
          </Button>
        )}
      </div>

      {/* Test result card */}
      {testResult?.result && (
        <div className="border rounded-lg p-3 mt-3 bg-muted/30 space-y-2">
          <div className="grid grid-cols-4 gap-3 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Cat1 (livable)</p>
              <p className="font-semibold">{testResult.result.cat1_sqm.toFixed(1)} m²</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Cat2 (enclosed)</p>
              <p className="font-semibold">{testResult.result.cat2_sqm.toFixed(1)} m²</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Cat3 (outdoor)</p>
              <p className="font-semibold">{testResult.result.cat3_sqm.toFixed(1)} m²</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total cost</p>
              <p className="font-semibold">€{Math.round(testResult.result.total_cost).toLocaleString("nl-BE")}</p>
            </div>
          </div>
          <div className="flex gap-4 text-xs text-muted-foreground">
            {testResult.result.finishing_coefficient != null && (
              <span>F = {testResult.result.finishing_coefficient.toFixed(2)}</span>
            )}
            {testResult.result.confidence != null && (
              <span>Confidence: {(testResult.result.confidence * 100).toFixed(0)}%</span>
            )}
          </div>
          {testResult.result.warnings.length > 0 && (
            <div className="text-xs text-amber-600 space-y-0.5">
              {testResult.result.warnings.slice(0, 3).map((w, i) => (
                <p key={i}>⚠ {w}</p>
              ))}
              {testResult.result.warnings.length > 3 && (
                <p>+ {testResult.result.warnings.length - 3} more warnings</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto py-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-sm text-muted-foreground py-12">
            <p className="font-medium">Chat with AI about this dossier</p>
            <p className="mt-1">
              Ask about extraction errors, suggest prompt improvements, or analyze the plan images.
            </p>
            <div className="mt-4 flex flex-wrap gap-2 justify-center">
              {[
                "What do you see in the floor plans?",
                "Why might the SQM extraction be off?",
                "Suggest improvements for the prompt",
                "Compare the results with ground truth",
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
            placeholder="Ask about this dossier..."
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
