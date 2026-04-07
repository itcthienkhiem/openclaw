import React from "react";
import type { BannerItem } from "./types";

const STORAGE_KEY = "banner-dismissed";

function loadPersistentDismissals(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch {
    /* corrupted data — start fresh */
  }
  return new Set();
}

function savePersistentDismissals(ids: Set<string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    /* storage full or unavailable */
  }
}

type BannerContextValue = {
  banners: BannerItem[];
  addBanner: (banner: BannerItem) => void;
  removeBanner: (id: string) => void;
  dismissBanner: (id: string, mode: "session" | "persistent") => void;
};

const BannerContext = React.createContext<BannerContextValue | null>(null);

export function BannerProvider({ children }: { children: React.ReactNode }) {
  const [banners, setBanners] = React.useState<BannerItem[]>([]);
  const [sessionDismissed, setSessionDismissed] = React.useState<Set<string>>(new Set());
  const [persistentDismissed, setPersistentDismissed] =
    React.useState<Set<string>>(loadPersistentDismissals);

  const addBanner = React.useCallback((banner: BannerItem) => {
    setBanners((prev) => {
      const idx = prev.findIndex((b) => b.id === banner.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = banner;
        return next;
      }
      return [...prev, banner];
    });
  }, []);

  const removeBanner = React.useCallback((id: string) => {
    setBanners((prev) => prev.filter((b) => b.id !== id));
  }, []);

  const dismissBanner = React.useCallback((id: string, mode: "session" | "persistent") => {
    if (mode === "persistent") {
      setPersistentDismissed((prev) => {
        const next = new Set(prev);
        next.add(id);
        savePersistentDismissals(next);
        return next;
      });
    } else {
      setSessionDismissed((prev) => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });
    }
  }, []);

  const visibleBanners = React.useMemo(
    () => banners.filter((b) => !sessionDismissed.has(b.id) && !persistentDismissed.has(b.id)),
    [banners, sessionDismissed, persistentDismissed]
  );

  const value = React.useMemo<BannerContextValue>(
    () => ({ banners: visibleBanners, addBanner, removeBanner, dismissBanner }),
    [visibleBanners, addBanner, removeBanner, dismissBanner]
  );

  return <BannerContext.Provider value={value}>{children}</BannerContext.Provider>;
}

export function useBanners(): BannerItem[] {
  const ctx = React.useContext(BannerContext);
  if (!ctx) {
    throw new Error("useBanners must be used within a BannerProvider");
  }
  return ctx.banners;
}

export function useDismissBanner(): (id: string, mode: "session" | "persistent") => void {
  const ctx = React.useContext(BannerContext);
  if (!ctx) {
    throw new Error("useDismissBanner must be used within a BannerProvider");
  }
  return ctx.dismissBanner;
}

/**
 * Declarative hook: pass a BannerItem to show it, or null to hide.
 * Handles add/remove lifecycle automatically.
 */
export function useBannerRegister(banner: BannerItem | null): void {
  const ctx = React.useContext(BannerContext);
  if (!ctx) {
    throw new Error("useBannerRegister must be used within a BannerProvider");
  }
  const { addBanner, removeBanner } = ctx;

  const idRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (banner) {
      addBanner(banner);
      idRef.current = banner.id;
    } else if (idRef.current) {
      removeBanner(idRef.current);
      idRef.current = null;
    }
  }, [banner, addBanner, removeBanner]);

  // Cleanup on unmount
  React.useEffect(() => {
    return () => {
      if (idRef.current) {
        removeBanner(idRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
