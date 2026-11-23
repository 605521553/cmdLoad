import type { CategoryNode, PromptCategoryNode } from "@/types/app";

/** User-facing module name; internal Category naming stays unchanged. */
export const CATEGORY_MODULE_NAME = "目录结构";

/** System default bucket (category_id = null) shown as “默认”. */
export const DEFAULT_CATEGORY_NAME = "默认";

export function categoryDisplayName(
  name: string | null | undefined,
): string {
  return name?.trim() ? name : DEFAULT_CATEGORY_NAME;
}

export interface FlatCategoryOption {
  id: string;
  name: string;
  depth: number;
  node: CategoryNode;
}

export function flattenCategoryOptions(
  nodes: CategoryNode[],
  depth = 0,
  output: FlatCategoryOption[] = [],
): FlatCategoryOption[] {
  for (const node of nodes) {
    output.push({ id: node.id, name: node.name, depth, node });
    flattenCategoryOptions(node.children, depth + 1, output);
  }
  return output;
}

export function buildCategoryPathMap(
  nodes: CategoryNode[],
  trail: string[] = [],
  output: Map<string, string> = new Map(),
): Map<string, string> {
  for (const node of nodes) {
    const path = [...trail, node.name];
    output.set(node.id, path.join(" / "));
    buildCategoryPathMap(node.children, path, output);
  }
  return output;
}

export function findCategoryName(
  nodes: CategoryNode[],
  id: string | null,
): string {
  if (!id) {
    return DEFAULT_CATEGORY_NAME;
  }
  for (const node of nodes) {
    if (node.id === id) {
      return node.name;
    }
    const found = findCategoryName(node.children, id);
    if (found !== DEFAULT_CATEGORY_NAME) {
      return found;
    }
  }
  return DEFAULT_CATEGORY_NAME;
}

export function findCategoryNode(
  nodes: CategoryNode[],
  id: string | null | undefined,
): CategoryNode | null {
  if (!id) {
    return null;
  }
  for (const node of nodes) {
    if (node.id === id) {
      return node;
    }
    const found = findCategoryNode(node.children, id);
    if (found) {
      return found;
    }
  }
  return null;
}

export function countSubtreeCommands(node: CategoryNode): number {
  return (
    node.commandCount +
    node.children.reduce(
      (total, child) => total + countSubtreeCommands(child),
      0,
    )
  );
}

export function countDescendantCategories(node: CategoryNode): number {
  return node.children.reduce(
    (total, child) => total + 1 + countDescendantCategories(child),
    0,
  );
}

/**
 * Prompt categories are a separate database entity but share the tree, icon and
 * color behavior. Adapting them to the shared `CategoryNode` shape lets the
 * existing sidebar, context menu, manager and appearance popover be reused
 * without mixing prompt rows into command queries.
 */
export function promptCategoryAsCategoryNode(
  node: PromptCategoryNode,
): CategoryNode {
  return {
    id: node.id,
    name: node.name,
    parentId: node.parentId,
    sortOrder: node.sortOrder,
    commandCount: node.promptCount,
    color: node.color,
    iconName: node.iconName,
    children: node.children.map(promptCategoryAsCategoryNode),
  };
}

export function promptCategoriesAsCategoryNodes(
  nodes: PromptCategoryNode[],
): CategoryNode[] {
  return nodes.map(promptCategoryAsCategoryNode);
}
