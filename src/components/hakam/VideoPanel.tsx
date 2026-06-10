import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { Film, Upload, AlertTriangle, Loader2 } from "lucide-react";

interface Props {
  videoUrl: string | null;
  onFile: (file: File) => void;
  /** True while the file is uploading / transcoding on the server. */
  loading?: boolean;
  disabled?: boolean;
}

const MEDIA_ERR: Record<number, string> = {
  1: "Playback was interrupted.",
  2: "Couldn't load the video — check the connection and try again.",
  3: "This file looks corrupted and can't be decoded.",
  4: "This clip's format can't be played here. The analysis still ran — keep chatting about it below.",
};

export function VideoPanel({ videoUrl, onFile, loading, disabled }: Props) {
  const [dragOver, setDragOver] = useState(false);
  const [playError, setPlayError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Clear any stale playback error whenever the source changes or a new
  // upload begins, so the warning never lingers across clips.
  useEffect(() => {
    setPlayError(null);
  }, [videoUrl, loading]);

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file && file.type.startsWith("video/")) onFile(file);
    },
    [onFile],
  );

  return (
    <div className="flex h-full flex-col rounded-2xl border border-border/60 bg-[image:var(--gradient-surface)] p-4 shadow-[var(--shadow-elegant)]">
      <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        <Film className="h-3.5 w-3.5" />
        Video Workspace
      </div>

      {videoUrl ? (
        <div className="flex flex-1 flex-col gap-3">
          <div className="relative flex-1 overflow-hidden rounded-xl bg-black shadow-[var(--shadow-elegant)]">
            <video
              key={videoUrl}
              src={videoUrl}
              controls
              preload="auto"
              playsInline
              onError={(e) => {
                // Suppress errors from the temporary blob while the server is
                // still converting — the playable copy is on its way.
                if (loading) return;
                const code = e.currentTarget.error?.code ?? 0;
                setPlayError(MEDIA_ERR[code] ?? "This clip couldn't be played here.");
              }}
              onLoadedData={() => setPlayError(null)}
              className="h-full w-full object-contain"
            />

            {/* Calm converting state — replaces the old red flash */}
            {loading && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 backdrop-blur-sm">
                <Loader2 className="h-7 w-7 animate-spin text-primary" />
                <p className="text-sm font-medium text-foreground">
                  Preparing your video…
                </p>
                <p className="text-xs text-muted-foreground">
                  Converting for smooth playback
                </p>
              </div>
            )}

            {/* Genuine playback failure — only after conversion settled */}
            {!loading && playError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/80 p-6 text-center">
                <AlertTriangle className="h-6 w-6 text-muted-foreground" />
                <p className="max-w-sm text-sm text-foreground">{playError}</p>
              </div>
            )}
          </div>

          <button
            onClick={() => inputRef.current?.click()}
            disabled={disabled}
            className="text-xs text-muted-foreground transition-colors hover:text-primary disabled:opacity-50"
          >
            Replace video
          </button>
        </div>
      ) : (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className={`flex flex-1 cursor-pointer flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed transition-all ${
            dragOver
              ? "border-primary bg-primary/5 shadow-[var(--shadow-glow)]"
              : "border-border/60 hover:border-primary/60 hover:bg-card/40"
          }`}
        >
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[image:var(--gradient-primary)] shadow-[var(--shadow-glow)]">
            <Upload className="h-6 w-6 text-primary-foreground" />
          </div>
          <div className="text-center">
            <p className="text-base font-medium text-foreground">
              Drop a video to begin
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              or click to browse · MP4, MOV, MKV, WEBM
            </p>
          </div>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}