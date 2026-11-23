import {
  BookOpen,
  Box,
  Boxes,
  Bug,
  Cloud,
  Code,
  Container,
  Cpu,
  Database,
  FileCode,
  Folder,
  FolderOpen,
  GitBranch,
  Globe,
  HardDrive,
  Layers,
  Monitor,
  Network,
  Package,
  Rocket,
  Server,
  Settings,
  Shield,
  Terminal,
  Workflow,
  Wrench,
  type LucideIcon,
} from "lucide-react";
export interface CategoryIconOption {
  name: string;
  label: string;
  keywords: string[];
  icon: LucideIcon;
}

/**
 * Persisted icon names. Rust validates writes against the same set in
 * `src-tauri/src/models/appearance.rs`; unknown imported names fall back to the
 * default folder icon.
 */
export const CATEGORY_ICON_OPTIONS: CategoryIconOption[] = [
  {
    name: "folder",
    label: "文件夹",
    keywords: ["folder", "默认", "目录"],
    icon: Folder,
  },
  {
    name: "folder-open",
    label: "打开的文件夹",
    keywords: ["folder", "open", "目录"],
    icon: FolderOpen,
  },
  {
    name: "terminal",
    label: "终端",
    keywords: ["terminal", "shell", "命令行", "powershell", "cmd"],
    icon: Terminal,
  },
  {
    name: "code",
    label: "代码",
    keywords: ["code", "开发", "编程"],
    icon: Code,
  },
  {
    name: "database",
    label: "数据库",
    keywords: ["database", "sql", "数据"],
    icon: Database,
  },
  {
    name: "server",
    label: "服务器",
    keywords: ["server", "主机", "运维", "ssh"],
    icon: Server,
  },
  {
    name: "container",
    label: "容器",
    keywords: ["container", "docker", "容器"],
    icon: Container,
  },
  {
    name: "git-branch",
    label: "Git 分支",
    keywords: ["git", "branch", "版本", "分支"],
    icon: GitBranch,
  },
  {
    name: "network",
    label: "网络",
    keywords: ["network", "网络", "连接"],
    icon: Network,
  },
  {
    name: "cloud",
    label: "云",
    keywords: ["cloud", "云", "部署"],
    icon: Cloud,
  },
  {
    name: "settings",
    label: "设置",
    keywords: ["settings", "配置", "工具"],
    icon: Settings,
  },
  {
    name: "package",
    label: "软件包",
    keywords: ["package", "包", "依赖", "npm"],
    icon: Package,
  },
  {
    name: "file-code",
    label: "代码文件",
    keywords: ["file", "code", "文件", "脚本"],
    icon: FileCode,
  },
  {
    name: "workflow",
    label: "工作流",
    keywords: ["workflow", "流程", "自动化"],
    icon: Workflow,
  },
  {
    name: "monitor",
    label: "显示器",
    keywords: ["monitor", "屏幕", "桌面", "windows"],
    icon: Monitor,
  },
  {
    name: "hard-drive",
    label: "硬盘",
    keywords: ["hard", "drive", "磁盘", "存储"],
    icon: HardDrive,
  },
  {
    name: "box",
    label: "盒子",
    keywords: ["box", "盒子", "构建"],
    icon: Box,
  },
  {
    name: "boxes",
    label: "多个盒子",
    keywords: ["boxes", "模块", "集合"],
    icon: Boxes,
  },
  {
    name: "globe",
    label: "全球",
    keywords: ["globe", "web", "互联网", "域名"],
    icon: Globe,
  },
  {
    name: "cpu",
    label: "处理器",
    keywords: ["cpu", "芯片", "性能"],
    icon: Cpu,
  },
  {
    name: "layers",
    label: "图层",
    keywords: ["layers", "堆栈", "层级"],
    icon: Layers,
  },
  {
    name: "shield",
    label: "防护",
    keywords: ["shield", "安全", "权限"],
    icon: Shield,
  },
  {
    name: "book-open",
    label: "手册",
    keywords: ["book", "文档", "笔记"],
    icon: BookOpen,
  },
  {
    name: "wrench",
    label: "工具",
    keywords: ["wrench", "工具", "维护"],
    icon: Wrench,
  },
  {
    name: "bug",
    label: "调试",
    keywords: ["bug", "调试", "问题"],
    icon: Bug,
  },
  {
    name: "rocket",
    label: "火箭",
    keywords: ["rocket", "发布", "启动"],
    icon: Rocket,
  },
];

export const DEFAULT_CATEGORY_ICON = "folder";

const ICON_BY_NAME = new Map(
  CATEGORY_ICON_OPTIONS.map((option) => [option.name, option]),
);

export function getCategoryIconOption(
  name: string | null | undefined,
): CategoryIconOption | null {
  return name ? ICON_BY_NAME.get(name) ?? null : null;
}

export function getCategoryIconComponent(
  name: string | null | undefined,
): LucideIcon {
  return getCategoryIconOption(name)?.icon ?? Folder;
}

export function searchCategoryIcons(query: string): CategoryIconOption[] {
  const value = query.trim().toLocaleLowerCase();
  if (!value) {
    return CATEGORY_ICON_OPTIONS;
  }
  return CATEGORY_ICON_OPTIONS.filter(
    (option) =>
      option.name.includes(value) ||
      option.label.includes(value) ||
      option.keywords.some((keyword) => keyword.includes(value)),
  );
}
