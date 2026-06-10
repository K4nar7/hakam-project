// Hakam backend (FastAPI on Vast.ai).
// Override with VITE_HAKAM_API_URL in .env.local, else uses the fallback.
export const HAKAM_API_URL =
  (import.meta.env.VITE_HAKAM_API_URL as string | undefined)?.replace(/\/$/, "") ||
  "http://81.166.162.13:13157";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

export async function uploadVideo(
  file: File,
): Promise<{ session_id: string; video_url?: string }> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch(`${HAKAM_API_URL}/api/upload-video`, {
    method: "POST",
    body: fd,
  });
  if (!res.ok) throw new Error(`Upload failed (${res.status})`);
  return res.json();
}

export async function sendChat(
  sessionId: string,
  query: string,
): Promise<{ response: string }> {
  const res = await fetch(`${HAKAM_API_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, query }),
  });
  if (!res.ok) throw new Error(`Chat failed (${res.status})`);
  return res.json();
}