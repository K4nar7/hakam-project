import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Header } from "@/components/hakam/Header";
import { VideoPanel } from "@/components/hakam/VideoPanel";
import { ChatPanel } from "@/components/hakam/ChatPanel";
import { sendChat, uploadVideo, type ChatMessage } from "@/lib/hakam-api";

export const Route = createFileRoute("/")({
  component: Hakam,
  head: () => ({
    meta: [
      { title: "Hakam — Video Intelligence" },
      {
        name: "description",
        content:
          "Hakam analyzes your videos with a fine-tuned Qwen3.5 + SportsQA LoRA model. Upload a clip and chat about what's happening.",
      },
    ],
  }),
});

type Tone = "idle" | "working" | "ready" | "error";

function Hakam() {
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState("Awaiting video…");
  const [tone, setTone] = useState<Tone>("idle");
  const [busy, setBusy] = useState(false);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  const handleFile = async (file: File) => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    setVideoUrl(url);
    setMessages([]);
    setSessionId(null);
    setBusy(true);
    setTone("working");
    setStatus("Processing video payload…");

    try {
      setTimeout(() => setStatus("Analyzing frames…"), 600);
      const { session_id } = await uploadVideo(file);
      setSessionId(session_id);
      setStatus("Ready for questions");
      setTone("ready");
    } catch (e) {
      console.error(e);
      setStatus(
        e instanceof Error ? `Upload failed: ${e.message}` : "Upload failed",
      );
      setTone("error");
    } finally {
      setBusy(false);
    }
  };

  const handleSend = async (text: string) => {
    if (!sessionId) return;
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
    };
    setMessages((m) => [...m, userMsg]);
    setBusy(true);
    setTone("working");
    setStatus("Hakam is thinking…");

    try {
      const { response } = await sendChat(sessionId, text);
      setMessages((m) => [
        ...m,
        { id: crypto.randomUUID(), role: "assistant", content: response },
      ]);
      setStatus("Ready for questions");
      setTone("ready");
    } catch (e) {
      console.error(e);
      setStatus(
        e instanceof Error ? `Inference error: ${e.message}` : "Inference error",
      );
      setTone("error");
    } finally {
      setBusy(false);
    }
  };

  const canSend = !!sessionId && !busy;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header />
      <main className="mx-auto grid max-w-7xl gap-5 px-6 py-6 lg:h-[calc(100vh-4rem)] lg:grid-cols-[1.15fr_1fr] lg:py-5">
        <section className="min-h-[420px] lg:min-h-0">
          <VideoPanel
            videoUrl={videoUrl}
            onFile={handleFile}
            disabled={busy}
          />
        </section>
        <section className="min-h-[520px] lg:min-h-0">
          <ChatPanel
            messages={messages}
            status={status}
            statusTone={tone}
            canSend={canSend}
            onSend={handleSend}
          />
        </section>
      </main>
    </div>
  );
}
