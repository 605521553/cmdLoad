import { GitBranch } from "lucide-react";
import { EmptyState } from "@/components/common/EmptyState";

export function WorkflowsPage() {
  return (
    <section aria-labelledby="workflows-heading">
      <h1 id="workflows-heading" className="sr-only">
        工作流
      </h1>
      <div className="rounded-lg border border-line bg-surface">
        <EmptyState
          icon={<GitBranch className="size-4" />}
          title="暂无工作流"
          description="将常用命令组合为有序步骤后，可在此维护并整组复制。"
        />
      </div>
    </section>
  );
}
