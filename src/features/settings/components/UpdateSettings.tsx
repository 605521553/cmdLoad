import { RefreshCw, ShieldCheck } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { SettingRow } from "@/features/settings/components/SettingRow";
import { useUpdateStore } from "@/features/updater/updateStore";
import { useAppStore } from "@/stores/appStore";
import { formatRelativeTime } from "@/utils/time";

function endpointLabel(endpoint: string | null): string {
  if (!endpoint) {
    return "未配置";
  }
  try {
    return new URL(endpoint).host;
  } catch {
    return endpoint;
  }
}

export function UpdateSettings() {
  const snapshot = useAppStore((state) => state.snapshot);
  const status = useUpdateStore((state) => state.status);
  const configuration = useUpdateStore((state) => state.configuration);
  const update = useUpdateStore((state) => state.update);
  const error = useUpdateStore((state) => state.error);
  const lastCheckedAt = useUpdateStore((state) => state.lastCheckedAt);
  const check = useUpdateStore((state) => state.check);
  const loadConfiguration = useUpdateStore(
    (state) => state.loadConfiguration,
  );
  const openDialog = useUpdateStore((state) => state.openDialog);

  useEffect(() => {
    void loadConfiguration();
  }, [loadConfiguration]);

  if (!snapshot) {
    return null;
  }

  const configured = configuration?.configured ?? false;
  const checking = status === "checking";
  const statusText =
    status === "checking"
      ? "正在检查…"
      : status === "downloading"
        ? "正在下载更新…"
        : status === "installing"
          ? "正在安装更新…"
          : status === "available" && update
            ? `发现新版本 v${update.version}`
            : status === "up-to-date"
              ? "已是最新版本"
              : status === "error"
                ? "检查失败"
                : "尚未检查";

  return (
    <>
      <SettingRow
        title="当前版本"
        description={
          <span>
            安装包会校验开发者签名；更新只替换程序文件，不会删除命令、提示词、设置或备份。
          </span>
        }
      >
        <span className="rounded border border-line bg-muted px-1.5 py-0.5 font-mono text-[10.5px] text-ink-muted">
          v{snapshot.version}
        </span>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void check()}
          disabled={checking || !configured}
          title={
            configured
              ? "检查是否有新版本"
              : "当前构建尚未配置更新源，发布前请修改 tauri.conf.json"
          }
        >
          <RefreshCw className={checking ? "animate-spin" : undefined} />
          {checking ? "检查中…" : "检查更新"}
        </Button>
        {status === "available" ? (
          <Button variant="ghost" size="sm" onClick={openDialog}>
            查看
          </Button>
        ) : null}
      </SettingRow>

      <SettingRow
        title="更新状态"
        description={
          <span className="space-y-0.5">
            <span className="block">
              {statusText}
              {lastCheckedAt && status !== "checking"
                ? ` · ${formatRelativeTime(lastCheckedAt)}`
                : ""}
            </span>
            {status === "error" && error ? (
              <span className="block text-danger">{error}</span>
            ) : null}
            {!configured ? (
              <span className="block text-amber">
                当前构建未配置更新源。发布前把 tauri.conf.json 的
                plugins.updater.endpoints 改成自己的 latest.json 地址，并重新构建。
              </span>
            ) : null}
          </span>
        }
      >
        <span className="inline-flex items-center gap-1 text-[10px] text-ink-faint">
          <ShieldCheck className="size-3" />
          {configuration ? endpointLabel(configuration.endpoint) : "读取中…"}
        </span>
      </SettingRow>

      <p className="border-b border-line/70 py-2.5 text-[10px] leading-4 text-ink-faint">
        启动后会在后台静默检查一次；有新版本时才会弹出提示。没有新版本或网络不可用时不会打断你。
      </p>
    </>
  );
}
