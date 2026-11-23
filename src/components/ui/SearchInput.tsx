import { Search, X } from "lucide-react";
import {
  forwardRef,
  useImperativeHandle,
  useRef,
  type InputHTMLAttributes,
} from "react";
import { cn } from "@/utils/cn";

interface SearchInputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** When provided, exactly one custom clear control is rendered. */
  onClear?: () => void;
}

/**
 * Shared compact search field.
 *
 * The browser's native search cancel button is hidden so pages never show two
 * clear icons. Callers opt into the single custom clear button with `onClear`.
 */
export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(
  (
    {
      className,
      placeholder = "搜索命令",
      onClear,
      value,
      ...props
    },
    ref,
  ) => {
    const innerRef = useRef<HTMLInputElement>(null);
    useImperativeHandle(ref, () => innerRef.current as HTMLInputElement, []);
    const hasValue =
      value !== undefined && value !== null && String(value).length > 0;

    return (
      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-faint"
        />
        <input
          ref={innerRef}
          type="search"
          value={value}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          className={cn(
            "h-8 w-full rounded-[10px] border border-line/90 bg-surface pl-8 pr-3 text-[12px] text-ink outline-none transition-[border-color,box-shadow] placeholder:text-ink-faint hover:border-line-strong focus:border-line-strong focus:shadow-[0_0_0_3px_var(--brand-soft)]",
            "[&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden",
            hasValue && onClear && "pr-8",
            className,
          )}
          {...props}
        />
        {hasValue && onClear ? (
          <button
            type="button"
            onClick={() => {
              onClear();
              innerRef.current?.focus();
            }}
            className="absolute right-1.5 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-ink-faint transition-colors hover:bg-muted hover:text-ink"
            aria-label="清空搜索"
            title="清空搜索"
          >
            <X className="size-3" />
          </button>
        ) : null}
      </div>
    );
  },
);

SearchInput.displayName = "SearchInput";
