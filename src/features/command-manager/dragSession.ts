let cancelled = false;

export function beginDragSession() {
  cancelled = false;
}

export function cancelDragSession() {
  cancelled = true;
}

export function isDragSessionCancelled() {
  return cancelled;
}

export function endDragSession() {
  cancelled = false;
}
