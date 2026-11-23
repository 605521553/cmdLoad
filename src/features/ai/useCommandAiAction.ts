import { useCallback, useRef, useState } from "react";
import type { CommandAiAction } from "@/features/command-actions/CommandContextMenu";
import { appApi } from "@/services/appApi";
import { useAppStore } from "@/stores/appStore";
import type {
  Command,
  GeneratedAiAnnotation,
  ManualAnnotationMode,
} from "@/types/app";
import { getUserErrorMessage, toAppCommandError } from "@/utils/errors";
import {
  buildPreservedAnnotation,
  hasSeparateManualAnnotation,
  isAiMirroredAnnotation,
} from "./quickGenerate";

export interface AiQuickConfirmation {
  command: Command;
  sensitive: boolean;
  hasManual: boolean;
  hasAi: boolean;
}

function requestIdFor(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `ai-quick-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * One-click AI generation shared by the quick panel and the full manager.
 *
 * The action never opens the settings panel for a configured user. It confirms
 * only when the command is sensitive or already annotated, and it never
 * replaces a handwritten note without putting that note into the new detailed
 * explanation.
 */
export function useCommandAiAction() {
  const snapshot = useAppStore((state) => state.snapshot);
  const showNotice = useAppStore((state) => state.showNotice);
  const setManagerView = useAppStore((state) => state.setManagerView);
  const setUiMode = useAppStore((state) => state.setUiMode);
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());
  const busyRef = useRef<Set<string>>(new Set());
  const [confirmation, setConfirmation] =
    useState<AiQuickConfirmation | null>(null);

  const configured = snapshot?.aiApiKeyConfigured ?? false;

  const markBusy = useCallback((commandId: string) => {
    if (busyRef.current.has(commandId)) {
      return false;
    }
    busyRef.current.add(commandId);
    setBusyIds(new Set(busyRef.current));
    return true;
  }, []);

  const clearBusy = useCallback((commandId: string) => {
    busyRef.current.delete(commandId);
    setBusyIds(new Set(busyRef.current));
  }, []);

  const openSettings = useCallback(() => {
    setManagerView("settings");
    void setUiMode("manager");
  }, [setManagerView, setUiMode]);

  const handleGenerationError = useCallback(
    (error: unknown, command: Command) => {
      const appError = toAppCommandError(error);
      if (appError.code === "AI_SENSITIVE_BLOCKED") {
        setConfirmation({
          command,
          sensitive: true,
          hasManual: hasSeparateManualAnnotation(command),
          hasAi: Boolean(command.aiAnnotation),
        });
        return;
      }
      if (appError.code === "AI_BUSY") {
        showNotice({ kind: "info", message: appError.message });
        return;
      }
      if (appError.code === "AI_CANCELLED") {
        return;
      }
      if (
        appError.code === "AI_NOT_CONFIGURED" ||
        appError.code === "AI_CREDENTIAL_ERROR"
      ) {
        showNotice({
          kind: "error",
          message: appError.message,
          actionLabel: "打开设置",
          onAction: openSettings,
        });
        return;
      }
      showNotice({
        kind: "error",
        message: getUserErrorMessage(appError),
      });
    },
    [openSettings, showNotice],
  );

  const saveGenerated = useCallback(
    async (
      command: Command,
      generated: GeneratedAiAnnotation,
      preserveManual: boolean,
    ): Promise<Command> => {
      // Re-read the authoritative row after the network round-trip. This closes
      // the race where the user edits or adds a handwritten note while the
      // request is in flight.
      const current = await appApi.getCommand(command.id);
      const currentManual = hasSeparateManualAnnotation(current);
      const mirroredAi = isAiMirroredAnnotation(current);
      let payload = generated;
      let mode: ManualAnnotationMode = "keep";
      let preserved = false;

      if (currentManual && preserveManual) {
        payload = buildPreservedAnnotation(current, generated);
        mode = "replace";
        preserved = true;
      } else if (mirroredAi) {
        // The previous replace copied AI text into title/description. Replace
        // again so the visible command fields do not keep stale AI text.
        mode = "replace";
      }

      const updated = await appApi.saveAiAnnotation(payload, mode);
      showNotice({
        kind: "success",
        message: preserved
          ? "AI 注释已生成，原手写内容已保留在新详细说明中"
          : currentManual
            ? "AI 注释已生成，手写注释保持不变"
            : "AI 注释已生成",
      });
      return updated;
    },
    [showNotice],
  );

  const generateAndSave = useCallback(
    async (
      command: Command,
      allowSensitive: boolean,
      preserveManual: boolean,
    ): Promise<Command> => {
      showNotice({ kind: "info", message: "正在生成 AI 注释…" });
      const generated = await appApi.generateAiAnnotation(
        command.id,
        requestIdFor(),
        allowSensitive,
      );
      return saveGenerated(command, generated, preserveManual);
    },
    [saveGenerated, showNotice],
  );

  const request = useCallback(
    async (command: Command) => {
      if (!configured) {
        showNotice({
          kind: "info",
          message: "尚未配置 AI 服务。",
          actionLabel: "打开设置",
          onAction: openSettings,
        });
        return;
      }
      if (command.aiAnnotationStatus === "pending") {
        showNotice({
          kind: "info",
          message: "该命令正在生成 AI 注释，请稍候。",
        });
        return;
      }
      if (!markBusy(command.id)) {
        return;
      }

      try {
        const sensitive = await appApi.checkAiCommandSensitivity(command.id);
        const hasManual = hasSeparateManualAnnotation(command);
        const hasAi = Boolean(command.aiAnnotation);
        if (sensitive || hasManual || hasAi) {
          setConfirmation({ command, sensitive, hasManual, hasAi });
          return;
        }
        await generateAndSave(command, false, false);
      } catch (error) {
        handleGenerationError(error, command);
      } finally {
        clearBusy(command.id);
      }
    },
    [
      clearBusy,
      configured,
      generateAndSave,
      handleGenerationError,
      markBusy,
      openSettings,
      showNotice,
    ],
  );

  const confirm = useCallback(async () => {
    if (!confirmation) {
      return;
    }
    const pending = confirmation;
    setConfirmation(null);
    if (!markBusy(pending.command.id)) {
      return;
    }
    try {
      await generateAndSave(
        pending.command,
        pending.sensitive,
        pending.hasManual,
      );
    } catch (error) {
      handleGenerationError(error, pending.command);
    } finally {
      clearBusy(pending.command.id);
    }
  }, [
    clearBusy,
    confirmation,
    generateAndSave,
    handleGenerationError,
    markBusy,
  ]);

  const cancel = useCallback(() => {
    setConfirmation(null);
  }, []);

  const menuAction = useCallback(
    (command: Command): CommandAiAction => {
      const busy =
        busyIds.has(command.id) ||
        command.aiAnnotationStatus === "pending";
      return {
        label: busy
          ? "AI 生成中…"
          : command.aiAnnotation
            ? "重新生成 AI 注释"
            : "AI 生成注释",
        disabled: busy,
        busy,
        onSelect: () => {
          void request(command);
        },
      };
    },
    [busyIds, request],
  );

  return { confirmation, confirm, cancel, request, menuAction };
}
