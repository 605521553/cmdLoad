/** Compact relative time for clipboard rows. */
export function formatRelativeTime(timestamp: number, now = Date.now()): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return "较早";
  }
  const delta = Math.max(0, now - timestamp);
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) {
    return "刚刚";
  }
  if (minutes < 60) {
    return `${minutes} 分钟前`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} 小时前`;
  }
  const days = Math.floor(hours / 24);
  if (days < 30) {
    return `${days} 天前`;
  }
  return new Date(timestamp).toLocaleDateString("zh-CN", {
    month: "numeric",
    day: "numeric",
  });
}
