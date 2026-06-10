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
          "Hakam analyzes your videos with a fine-tuned Qwen3.5 + SportsQA LoRA model.",
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
  const blobRef = useRef<string | null>(null);

  useEffect(
    () => () => {
      if (blobRef.current) URL.revokeObjectURL(blobRef.current);
    },
    [],
  );

  const handleFile = async (file: File) => {
    if (blobRef.current) URL.revokeObjectURL(blobRef.current);
    // Show the local blob instantly for fast feedback. If the codec is
    // browser-playable it just works; if not, we swap to the server's
    // transcoded MP4 once the upload returns.
    const blob = URL.createObjectURL(file);
    blobRef.current = blob;
    setVideoUrl(blob);

    setMessages([]);
    setSessionId(null);
    setBusy(true);
    setTone("working");
    setStatus("Uploading & converting…");

    try {
      const { session_id, video_url } = await uploadVideo(file);
      setSessionId(session_id);
      // Prefer the server's H.264 copy — guaranteed browser-playable.
      if (video_url) {
        setVideoUrl(video_url);
        if (blobRef.current) {
          URL.revokeObjectURL(blobRef.current);
          blobRef.current = null;
        }
      }
      setStatus("Ready for questions");
      setTone("ready");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Upload failed");
      setTone("error");
    } finally {
      setBusy(false);
    }
  };

  const handleSend = async (text: string) => {
    if (!sessionId) return;
    setMessages((m) => [
      ...m,
      { id: crypto.randomUUID(), role: "user", content: text },
    ]);
    setBusy(true);
    setTone("working");
    setStatus("Thinking…");

    try {
      const { response } = await sendChat(sessionId, text);
      setMessages((m) => [
        ...m,
        { id: crypto.randomUUID(), role: "assistant", content: response },
      ]);
      setStatus("Ready for questions");
      setTone("ready");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Inference error");
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
          <VideoPanel videoUrl={videoUrl} onFile={handleFile} disabled={busy} />
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