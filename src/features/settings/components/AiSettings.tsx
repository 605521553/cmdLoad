import { KeyRound, LoaderCircle, PlugZap, Save, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { StatusDot } from "@/components/common/StatusDot";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Switch";
import { ConfirmDialog } from "@/features/command-manager/ConfirmDialog";
import { appApi } from "@/services/appApi";
import { useAppStore } from "@/stores/appStore";
import type { SettingsPatch } from "@/types/app";
import { getUserErrorMessage } from "@/utils/errors";
import { SettingRow } from "./SettingRow";
import { SettingsSection } from "./SettingsSection";

interface ProviderPreset {
  id: string;
  label: string;
  baseUrl: string;
  model: string;
}

const PROVIDERS: ProviderPreset[] = [
  {
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
  },
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4.1-mini",
  },
  {
    id: "siliconflow",
    label: "SiliconFlow",
    baseUrl: "https://api.siliconflow.cn/v1",
    model: "deepseek-ai/DeepSeek-V3",
  },
];

const inputClass =
  "h-8 w-full rounded-md border border-line bg-canvas px-2.5 text-[12px] text-ink outline-none transition-colors placeholder:text-ink-faint hover:border-line-strong focus:border-ink-faint";

type BusyState = "save" | "test" | "auto" | "key" | null;

function presetFor(provider: string): ProviderPreset | undefined {
  return PROVIDERS.find((preset) => preset.id === provider);
}

export function AiSettings() {
  const snapshot = useAppStore((state) => state.snapshot);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const refreshSnapshot = useAppStore((state) => state.refreshSnapshot);
  const showNotice = useAppStore((state) => state.showNotice);
  const [provider, setProvider] = useState("deepseek");
  const [baseUrl, setBaseUrl] = useState("https://api.deepseek.com/v1");
  const [model, setModel] = useState("deepseek-chat");
  const [timeoutSeconds, setTimeoutSeconds] = useState("30");
  const [temperature, setTemperature] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState<BusyState>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [confirmClearKey, setConfirmClearKey] = useState(false);
  const initialized = useRef(false);

  const settings = snapshot?.settings;

  useEffect(() => {
    if (!settings || initialized.current) {
      return;
    }
    initialized.current = true;
    setProvider(settings.aiProvider || "deepseek");
    setBaseUrl(settings.aiBaseUrl);
    setModel(settings.aiModel);
    setTimeoutSeconds(String(settings.aiTimeoutSeconds));
    setTemperature(
      settings.aiTemperature === null ? "" : String(settings.aiTemperature),
    );
  }, [settings]);

  if (!settings || !snapshot) {
    return null;
  }

  const controlsDisabled = busy !== null;
  const providerIsPreset = Boolean(presetFor(provider));

  const patchFromForm = (): SettingsPatch => {
    const timeout = Number(timeoutSeconds);
    if (!Number.isFinite(timeout) || timeout < 5 || timeout > 120) {
      throw new Error("超时时间需在 5–120 秒之间。");
    }
    const trimmedTemperature = temperature.trim();
    if (trimmedTemperature) {
      const value = Number(trimmedTemperature);
      if (!Number.isFinite(value) || value < 0 || value > 2) {
        throw new Error("Temperature 需在 0–2 之间，或留空使用服务默认值。");
      }
    }
    return {
      aiProvider: provider,
      aiBaseUrl: baseUrl.trim(),
      aiModel: model.trim(),
      aiTimeoutSeconds: Math.round(timeout),
      ...(trimmedTemperature
        ? { aiTemperature: Number(trimmedTemperature) }
        : { clearAiTemperature: true }),
    };
  };

  const saveConfig = async () => {
    setBusy("save");
    setTestResult(null);
    try {
      await updateSettings(patchFromForm());
      if (apiKey.trim()) {
        await appApi.saveAiApiKey(apiKey);
        setApiKey("");
        await refreshSnapshot();
      }
      showNotice({
        kind: "success",
        message: apiKey.trim()
          ? "AI 配置已保存，API Key 已写入 Windows 凭据管理器"
          : "AI 配置已保存",
      });
    } catch (error) {
      showNotice({ kind: "error", message: getUserErrorMessage(error) });
    } finally {
      setBusy(null);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void saveConfig();
  };

  const testConnection = async () => {
    setBusy("test");
    setTestResult(null);
    try {
      const timeout = Math.min(120, Math.max(5, Number(timeoutSeconds) || 30));
      if (!baseUrl.trim() || !model.trim()) {
        throw new Error("请先填写 Base URL 和模型名称。");
      }
      const result = await appApi.testAiConnection({
        baseUrl: baseUrl.trim(),
        model: model.trim(),
        timeoutSeconds: timeout,
        apiKey: apiKey.trim() || undefined,
      });
      const message = `连接成功 · ${result.latencyMs} ms · ${result.model}`;
      setTestResult(message);
      showNotice({ kind: "success", message });
    } catch (error) {
      const message = getUserErrorMessage(error);
      setTestResult(null);
      showNotice({ kind: "error", message });
    } finally {
      setBusy(null);
    }
  };

  const setAutoAnnotation = async (enabled: boolean) => {
    setBusy("auto");
    try {
      await updateSettings({ aiAutoAnnotation: enabled });
      showNotice({
        kind: "success",
        message: enabled
          ? "已开启收藏后自动生成 AI 注释"
          : "已关闭收藏后自动生成 AI 注释",
      });
    } catch (error) {
      showNotice({ kind: "error", message: getUserErrorMessage(error) });
    } finally {
      setBusy(null);
    }
  };

  const clearKey = async () => {
    setBusy("key");
    try {
      await appApi.clearAiApiKey();
      await refreshSnapshot();
      setTestResult(null);
      setConfirmClearKey(false);
      showNotice({ kind: "success", message: "已从 Windows 凭据管理器清除 API Key" });
    } catch (error) {
      showNotice({ kind: "error", message: getUserErrorMessage(error) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <SettingsSection
        title="AI 注释"
        description="使用你自己的 OpenAI 兼容 Chat Completions 服务生成中文命令说明。所有请求由 Rust 后端发出，API Key 只保存在 Windows 凭据管理器。"
      >
        <form onSubmit={submit} className="mt-1 space-y-2.5">
          <div className="grid grid-cols-[1fr_128px] gap-2.5">
            <Field label="API 服务商" htmlFor="ai-provider">
              <select
                id="ai-provider"
                value={providerIsPreset ? provider : "custom"}
                disabled={controlsDisabled}
                onChange={(event) => {
                  const next = event.target.value;
                  if (next === "custom") {
                    setProvider("custom");
                    return;
                  }
                  const preset = presetFor(next);
                  if (preset) {
                    setProvider(preset.id);
                    setBaseUrl(preset.baseUrl);
                    setModel(preset.model);
                  }
                }}
                className={inputClass}
              >
                {PROVIDERS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label}
                  </option>
                ))}
                <option value="custom">自定义</option>
              </select>
            </Field>
            <Field label="请求超时（秒）" htmlFor="ai-timeout">
              <input
                id="ai-timeout"
                type="number"
                min={5}
                max={120}
                step={1}
                value={timeoutSeconds}
                disabled={controlsDisabled}
                onChange={(event) => setTimeoutSeconds(event.target.value)}
                className={inputClass}
              />
            </Field>
          </div>

          <Field
            label="Base URL"
            htmlFor="ai-base-url"
            hint="填写到 OpenAI 兼容的 /v1 层；程序会自动补全 /chat/completions。"
          >
            <input
              id="ai-base-url"
              type="url"
              value={baseUrl}
              disabled={controlsDisabled}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://api.deepseek.com/v1"
              spellCheck={false}
              className={`${inputClass} font-mono text-[11.5px]`}
            />
          </Field>

          <div className="grid grid-cols-[minmax(0,1fr)_132px] gap-2.5">
            <Field label="Model" htmlFor="ai-model" hint="允许手动输入任意模型名称。">
              <input
                id="ai-model"
                value={model}
                disabled={controlsDisabled}
                onChange={(event) => setModel(event.target.value)}
                placeholder="deepseek-chat"
                spellCheck={false}
                className={`${inputClass} font-mono text-[11.5px]`}
              />
            </Field>
            <Field
              label="Temperature"
              htmlFor="ai-temperature"
              hint="可选；留空则使用服务商默认值。"
            >
              <input
                id="ai-temperature"
                type="number"
                min={0}
                max={2}
                step={0.1}
                value={temperature}
                disabled={controlsDisabled}
                onChange={(event) => setTemperature(event.target.value)}
                placeholder="默认"
                className={inputClass}
              />
            </Field>
          </div>

          <Field
            label="API Key"
            htmlFor="ai-api-key"
            hint={
              snapshot.aiApiKeyConfigured
                ? "已安全保存在 Windows 凭据管理器；留空表示保持现有密钥，不会写进 settings.json。"
                : "保存后写入 Windows 凭据管理器，不会写进 settings.json、SQLite 或日志。"
            }
          >
            <div className="relative">
              <KeyRound className="pointer-events-none absolute left-2.5 top-1/2 size-3 -translate-y-1/2 text-ink-faint" />
              <input
                id="ai-api-key"
                type="password"
                autoComplete="new-password"
                value={apiKey}
                disabled={controlsDisabled}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={
                  snapshot.aiApiKeyConfigured ? "已保存（留空保持不变）" : "sk-…"
                }
                spellCheck={false}
                className={`${inputClass} pl-7 font-mono`}
              />
            </div>
          </Field>

          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            <span className="flex items-center gap-1.5 text-[10.5px] text-ink-muted">
              <StatusDot
                tone={snapshot.aiApiKeyConfigured ? "success" : "neutral"}
              />
              {snapshot.aiApiKeyConfigured ? "密钥已配置" : "未配置密钥"}
            </span>
            <span className="text-[10px] text-ink-faint">
              仅发送命令原文、Shell 和生成要求；不会发送本地数据库。
            </span>
            <div className="ml-auto flex items-center gap-1.5">
              {snapshot.aiApiKeyConfigured ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={controlsDisabled}
                  onClick={() => setConfirmClearKey(true)}
                  title="从 Windows 凭据管理器清除 API Key"
                >
                  <Trash2 />
                  清除密钥
                </Button>
              ) : null}
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={controlsDisabled}
                onClick={() => void testConnection()}
              >
                {busy === "test" ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <PlugZap />
                )}
                测试连接
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={controlsDisabled}
              >
                {busy === "save" ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <Save />
                )}
                保存配置
              </Button>
            </div>
          </div>

          {testResult ? (
            <p className="text-[10.5px] leading-4 text-success" role="status">
              {testResult}
            </p>
          ) : null}
        </form>

        <div className="mt-2 border-t border-line/70 pt-1">
          <SettingRow
            title="收藏命令后自动生成 AI 注释"
            description="默认关闭。开启后，从剪贴板保存的新命令会先写入本地，再异步生成注释；已有手写注释或疑似包含敏感信息的命令会跳过。"
          >
            <Switch
              checked={settings.aiAutoAnnotation}
              disabled={controlsDisabled}
              onCheckedChange={(checked) => void setAutoAnnotation(checked)}
              aria-label="收藏命令后自动生成 AI 注释"
            />
          </SettingRow>
        </div>
      </SettingsSection>

      <ConfirmDialog
        open={confirmClearKey}
        title="清除 API Key？"
        description="将从 Windows 凭据管理器删除密钥。AI 注释将无法继续生成，已有注释和命令不会受影响。"
        confirmLabel="清除密钥"
        danger
        busy={busy === "key"}
        onConfirm={() => void clearKey()}
        onClose={() => {
          if (busy !== "key") {
            setConfirmClearKey(false);
          }
        }}
      />
    </>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="mb-1 block text-[11px] font-medium text-ink-muted"
      >
        {label}
      </label>
      {children}
      {hint ? (
        <p className="mt-0.5 text-[9.5px] leading-3.5 text-ink-faint">{hint}</p>
      ) : null}
    </div>
  );
}
