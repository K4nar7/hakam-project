import { useCallback, useRef, useState, type DragEvent } from "react";
import { Film, Upload, AlertTriangle } from "lucide-react";

interface Props {
  videoUrl: string | null;
  onFile: (file: File) => void;
  disabled?: boolean;
}

const MEDIA_ERR: Record<number, string> = {
  1: "Playback aborted.",
  2: "Network error while loading the video.",
  3: "Decode error — the file is corrupt or partially downloaded.",
  4: "This video format/codec isn't supported by the browser (e.g. HEVC/H.265, MKV, AVI). Re-encode to H.264 MP4 to preview it here.",
};

export function VideoPanel({ videoUrl, onFile, disabled }: Props) {
  const [dragOver, setDragOver] = useState(false);
  const [playError, setPlayError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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
          <div className="relative flex-1">
            <video
              key={videoUrl}
              src={videoUrl}
              controls
              preload="auto"
              playsInline
              onError={(e) => {
                const code = e.currentTarget.error?.code ?? 0;
                setPlayError(MEDIA_ERR[code] ?? "Unknown playback error.");
              }}
              onLoadedData={() => setPlayError(null)}
              className="h-full w-full rounded-xl bg-black object-contain shadow-[var(--shadow-elegant)]"
            />
            {playError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-xl bg-black/80 p-6 text-center">
                <AlertTriangle className="h-6 w-6 text-destructive" />
                <p className="text-sm text-foreground">{playError}</p>
                <p className="text-xs text-muted-foreground">
                  The upload still worked — you can keep chatting about the clip.
                </p>
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
              or click to browse · MP4 (H.264) plays best
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