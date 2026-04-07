import React, { useCallback, useMemo, useState } from "react";
import { ArrowDownIcon } from "@shared/kit/icons";
import s from "./ScrollToBottomButton.module.css";

const DEBOUNCE_DELAY = 100;
const SCROLL_SHIFT_THRESHOLD = 200;

type Props = {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  /** When this changes, we re-check scroll position (e.g. displayMessages.length). */
  contentKey: number;
};

export function ScrollToBottomButton({ scrollRef, onScroll, contentKey }: Props) {
  const [canScroll, setCanScroll] = useState(false);

  const debouncedCheck = useMemo(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        const el = scrollRef.current;
        if (!el) return;
        const isScrolledToBottom =
          el.scrollTop + el.clientHeight >= el.scrollHeight - SCROLL_SHIFT_THRESHOLD;
        setCanScroll(!isScrolledToBottom);
      }, DEBOUNCE_DELAY);
    };
  }, [scrollRef]);

  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    debouncedCheck();

    el.addEventListener("scroll", debouncedCheck);
    window.addEventListener("resize", debouncedCheck);

    return () => {
      el.removeEventListener("scroll", debouncedCheck);
      window.removeEventListener("resize", debouncedCheck);
    };
  }, [contentKey, scrollRef, debouncedCheck]);

  const handleClick = useCallback(() => {
    onScroll();
  }, [onScroll]);

  if (!canScroll) return null;

  return (
    <button type="button" className={s.btn} onClick={handleClick} aria-label="Scroll to bottom">
      <ArrowDownIcon />
    </button>
  );
}
