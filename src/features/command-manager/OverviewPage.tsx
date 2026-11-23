import {
  ArrowRight,
  Command,
  FileText,
  Keyboard,
  LibraryBig,
  Monitor,
  Power,
  Settings2,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { ShortcutKeys } from "@/components/common/ShortcutKeys";
import { StatusDot } from "@/components/common/StatusDot";
import { Button } from "@/components/ui/Button";
import { CommandPrimary } from "@/features/command-display/CommandPrimary";
import { appApi } from "@/services/appApi";
import { useAppStore } from "@/stores/appStore";
import type { LibrarySummary, PromptLibrarySummary } from "@/types/app";
import { getUserErrorMessage } from "@/utils/errors";

function Section({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="border-t border-line py-4 first:border-t-0 first:pt-0">
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <h2 className="text-[11px] font-medium tracking-[0.04em] text-ink-faint">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function StatusRow({
  icon: Icon,
  label,
  value,
  tone = "success",
  trailing,
}: {
  icon: typeof Keyboard;
  label: string;
  value: string;
  tone?: "success" | "warning" | "neutral";
  trailing?: ReactNode;
}) {
  return (
    <div className="flex min-h-8 items-center gap-2.5 border-b border-line/70 py-1.5 last:border-b-0">
      <Icon className="size-3.5 shrink-0 text-ink-faint" strokeWidth={1.8} />
      <span className="text-[12.5px] text-ink-muted">{label}</span>
      <span className="ml-auto flex min-w-0 items-center gap-1.5 text-right text-[12.5px] text-ink">
        {trailing}
        <StatusDot tone={tone} />
        <span className="truncate">{value}</span>
      </span>
    </div>
  );
}

export function OverviewPage() {
  const snapshot = useAppStore((state) => state.snapshot);
  const dataRevision = useAppStore((state) => state.dataRevision);
  const promptRevision = useAppStore((state) => state.promptRevision);
  const setManagerView = useAppStore((state) => state.setManagerView);
  const showNotice = useAppStore((state) => state.showNotice);
  const [summary, setSummary] = useState<LibrarySummary | null>(null);
  const [promptSummary, setPromptSummary] =
    useState<PromptLibrarySummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      appApi.getLibrarySummary(),
      appApi.getPromptLibrarySummary(),
    ])
      .then(([result, prompts]) => {
        if (!cancelled) {
          setSummary(result);
          setPromptSummary(prompts);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          showNotice({ kind: "error", message: getUserErrorMessage(error) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [dataRevision, promptRevision, showNotice]);

  if (!snapshot) {
    return null;
  }

  const shortcutReady = snapshot.shortcut.registered;
  const commandCount = summary?.commandCount ?? 0;
  const favoriteCount = summary?.favoriteCount ?? 0;
  const recentCommands = summary?.recentCommands ?? [];
  const promptCount = promptSummary?.promptCount ?? 0;
  const promptFavoriteCount = promptSummary?.favoriteCount ?? 0;

  return (
    <div className="animate-content-in mx-auto w-full max-w-[620px]">
      <h1 className="sr-only">概览</h1>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
        <p className="text-[12px] text-ink-muted">
          本地模式 · v{snapshot.version}
        </p>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2 py-1 text-[10.5px] text-ink-muted">
          <StatusDot />
          运行正常
        </span>
      </div>

      <Section
        title="全局快捷键"
        action={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setManagerView("settings")}
          >
            设置
          </Button>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <ShortcutKeys shortcut={snapshot.settings.shortcut} />
          <span className="text-[11.5px] text-ink-muted">
            {shortcutReady
              ? "随时呼出快捷面板，再次按下隐藏。"
              : "当前未注册成功，可前往设置重新绑定。"}
          </span>
          <StatusDot
            tone={shortcutReady ? "success" : "warning"}
            className="ml-auto"
          />
        </div>
      </Section>

      <Section title="应用与托盘">
        <StatusRow
          icon={Monitor}
          label="系统托盘"
          value="后台常驻"
          tone="success"
        />
        <StatusRow
          icon={Power}
          label="开机自动启动"
          value={snapshot.autostartEnabled ? "已开启" : "未开启"}
          tone={snapshot.autostartEnabled ? "success" : "neutral"}
        />
        <StatusRow
          icon={Keyboard}
          label="快捷面板失焦隐藏"
          value={
            snapshot.settings.autoHideQuickPanel ? "已开启" : "已关闭"
          }
          tone={snapshot.settings.autoHideQuickPanel ? "success" : "neutral"}
        />
      </Section>

      <Section title="命令库">
        <div className="grid grid-cols-2 divide-x divide-line rounded-md border border-line bg-surface">
          <div className="flex items-center gap-2.5 px-3 py-2.5">
            <LibraryBig className="size-4 text-ink-faint" strokeWidth={1.8} />
            <div>
              <p className="text-[15px] font-semibold leading-5 text-ink">
                {commandCount}
              </p>
              <p className="text-[10.5px] text-ink-faint">条命令</p>
            </div>
          </div>
          <div className="flex items-center gap-2.5 px-3 py-2.5">
            <Command className="size-4 text-ink-faint" strokeWidth={1.8} />
            <div>
              <p className="text-[15px] font-semibold leading-5 text-ink">
                {favoriteCount}
              </p>
              <p className="text-[10.5px] text-ink-faint">条收藏</p>
            </div>
          </div>
        </div>
      </Section>

      <Section
        title="最近命令"
        action={
          <button
            type="button"
            onClick={() => setManagerView("library")}
            className="inline-flex items-center gap-0.5 text-[11px] text-ink-muted hover:text-ink"
          >
            打开命令库
            <ArrowRight className="size-3" />
          </button>
        }
      >
        {recentCommands.length === 0 ? (
          <p className="rounded-md border border-dashed border-line px-3 py-2.5 text-[12px] text-ink-faint">
            暂无最近使用的命令
          </p>
        ) : (
          <div className="divide-y divide-line/70 rounded-md border border-line bg-surface">
            {recentCommands.map((command) => (
              <button
                key={command.id}
                type="button"
                onClick={() => setManagerView("library")}
                className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/40"
              >
                <CommandPrimary
                  command={command}
                  density="manager"
                  lines={1}
                  className="min-w-0 flex-1"
                  trailing={
                    <span className="shrink-0 text-[9.5px] text-ink-faint">
                      {command.useCount} 次
                    </span>
                  }
                />
              </button>
            ))}
          </div>
        )}
      </Section>

      <Section
        title="提示词库"
        action={
          <button
            type="button"
            onClick={() => setManagerView("prompts")}
            className="inline-flex items-center gap-0.5 text-[11px] text-ink-muted hover:text-ink"
          >
            打开提示词库
            <ArrowRight className="size-3" />
          </button>
        }
      >
        <div className="grid grid-cols-2 divide-x divide-line rounded-md border border-line bg-surface">
          <div className="flex items-center gap-2.5 px-3 py-2.5">
            <FileText className="size-4 text-ink-faint" strokeWidth={1.8} />
            <div>
              <p className="text-[15px] font-semibold leading-5 text-ink">
                {promptCount}
              </p>
              <p className="text-[10.5px] text-ink-faint">条提示词</p>
            </div>
          </div>
          <div className="flex items-center gap-2.5 px-3 py-2.5">
            <Command className="size-4 text-ink-faint" strokeWidth={1.8} />
            <div>
              <p className="text-[15px] font-semibold leading-5 text-ink">
                {promptFavoriteCount}
              </p>
              <p className="text-[10.5px] text-ink-faint">条收藏</p>
            </div>
          </div>
        </div>
      </Section>

      <Section title="快捷操作">
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setManagerView("library")}
          >
            <LibraryBig />
            命令库
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setManagerView("prompts")}
          >
            <FileText />
            提示词库
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setManagerView("settings")}
          >
            <Settings2 />
            设置
          </Button>
        </div>
      </Section>
    </div>
  );
}
