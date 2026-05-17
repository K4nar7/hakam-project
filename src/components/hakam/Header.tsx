import { Sparkles } from "lucide-react";

export function Header() {
  return (
    <header className="border-b border-border/60 bg-card/40 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[image:var(--gradient-primary)] shadow-[var(--shadow-glow)]">
            <Sparkles className="h-4 w-4 text-primary-foreground" strokeWidth={2.5} />
          </div>
          <span className="text-lg font-semibold tracking-tight text-foreground">
            Hakam
          </span>
          <span className="ml-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Video Intelligence
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_8px_var(--primary)]" />
          Qwen3.5 · SportsQA LoRA
        </div>
      </div>
    </header>
  );
}
