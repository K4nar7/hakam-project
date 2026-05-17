import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { MessageSquare, Send } from "lucide-react";
import type { ChatMessage } from "@/lib/hakam-api";

interface Props {
  messages: ChatMessage[];
  status: string;
  statusTone: "idle" | "working" | "ready" | "error";
  canSend: boolean;
  onSend: (text: string) => void;
}

const toneClass: Record<Props["statusTone"], string> = {
  idle: "text-muted-foreground",
  working: "text-accent",
  ready: "text-primary",
  error: "text-destructive",
};

export function ChatPanel({ messages, status, statusTone, canSend, onSend }: Props) {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, status]);

  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const submit = () => {
    const t = input.trim();
    if (!t || !canSend) return;
    onSend(t);
    setInput("");
  };

  return (
    <div className="flex h-full flex-col rounded-2xl border border-border/60 bg-[image:var(--gradient-surface)] shadow-[var(--shadow-elegant)]">
      <div className="flex items-center gap-2 border-b border-border/60 px-5 py-4 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        <MessageSquare className="h-3.5 w-3.5" />
        Conversation
      </div>

      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center text-sm text-muted-foreground">
            Upload a video, then ask anything about it.
          </div>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                  m.role === "user"
                    ? "bg-[image:var(--gradient-primary)] text-primary-foreground shadow-[var(--shadow-glow)]"
                    : "bg-card/80 text-card-foreground border border-border/40"
                }`}
              >
                {m.content}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="border-t border-border/60 px-5 pt-3 pb-4">
        <div className={`mb-2 flex items-center gap-2 text-xs font-medium ${toneClass[statusTone]}`}>
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              statusTone === "working"
                ? "bg-accent animate-pulse"
                : statusTone === "ready"
                  ? "bg-primary shadow-[0_0_8px_var(--primary)]"
                  : statusTone === "error"
                    ? "bg-destructive"
                    : "bg-muted-foreground"
            }`}
          />
          {status}
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-input/60 px-3 py-2 focus-within:border-primary/70 focus-within:shadow-[var(--shadow-glow)] transition-all">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            disabled={!canSend}
            placeholder={canSend ? "Ask about the video…" : "Upload a video first…"}
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none disabled:opacity-50"
          />
          <button
            onClick={submit}
            disabled={!canSend || !input.trim()}
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-[image:var(--gradient-primary)] text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-30"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
