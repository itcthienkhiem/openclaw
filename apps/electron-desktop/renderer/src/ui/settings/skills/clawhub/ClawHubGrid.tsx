import React from "react";
import type { ClawHubSkillItem } from "./useClawHubSkills";
import s from "./ClawHubGrid.module.css";

function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

export function ClawHubGrid(props: {
  skills: ClawHubSkillItem[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  actionSlug: string | null;
  actionKind: "install" | "remove" | null;
  installedSlugs: Set<string>;
  hasMore: boolean;
  onInstall: (slug: string) => void;
  onRemove: (slug: string) => void;
  onOpenDetails: (slug: string) => void;
  onLoadMore: () => void;
  emptyStateText?: string;
  emptyStateSubtext?: string;
}) {
  const {
    skills,
    loading,
    loadingMore,
    error,
    actionSlug,
    actionKind,
    installedSlugs,
    hasMore,
    onInstall,
    onRemove,
    onOpenDetails,
    onLoadMore,
  } = props;

  const sentinelRef = React.useRef<HTMLDivElement>(null);

  // Infinite scroll via IntersectionObserver
  React.useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !loadingMore) {
          onLoadMore();
        }
      },
      { rootMargin: "200px" }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, onLoadMore]);

  if (loading && skills.length === 0) {
    return (
      <div className="UiSkillsGrid">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className={`UiSkillCard ${s.UiClawHubCard}`}>
            <div className="UiSkillTopRow">
              <span className={s.UiSkelCircle} />
              <span className={s.UiSkelBar} style={{ width: "55%", height: 14 }} />
              <span
                className={s.UiSkelBar}
                style={{
                  width: 60,
                  height: 24,
                  borderRadius: "var(--radius-full)",
                  marginLeft: "auto",
                }}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
              <span className={s.UiSkelBar} style={{ width: "100%", height: 11 }} />
              <span className={s.UiSkelBar} style={{ width: "72%", height: 11 }} />
            </div>
            <div className={s.UiClawHubFooter}>
              <div className={s.UiClawHubFooterLeft}>
                <span className={s.UiSkelBar} style={{ width: 60, height: 10 }} />
                <span className={s.UiSkelBar} style={{ width: 36, height: 10 }} />
                <span className={s.UiSkelBar} style={{ width: 36, height: 10 }} />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error && skills.length === 0) {
    return <div className={s.UiClawHubError}>{error}</div>;
  }

  if (skills.length === 0) {
    return (
      <div className={s.UiClawHubEmpty}>
        <div className={s.UiClawHubEmptyText}>
          {props.emptyStateText ?? "No skills available on ClawHub"}
        </div>
        <div className={s.UiClawHubEmptySubtext}>
          {props.emptyStateSubtext ?? "Skills published to ClawHub will appear here."}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="UiSkillsGrid">
        {skills.map((skill) => {
          const installed = installedSlugs.has(skill.slug);
          const busy = actionSlug === skill.slug;
          const ownerLabel = skill.owner?.handle ?? skill.owner?.displayName ?? null;

          return (
            <div
              key={skill.slug}
              className={`UiSkillCard ${s.UiClawHubCard}`}
              role="button"
              tabIndex={0}
              aria-label={skill.displayName}
              onClick={() => onOpenDetails(skill.slug)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onOpenDetails(skill.slug);
                }
              }}
            >
              {/* Title row: icon + name + install button */}
              <div className="UiSkillTopRow">
                <span
                  className="UiSkillIcon"
                  aria-hidden="true"
                  style={{
                    background: "var(--surface-overlay-subtle)",
                    width: 26,
                    height: 26,
                    fontSize: 14,
                  }}
                >
                  {skill.emoji || "🦞"}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="UiSkillName">{skill.displayName}</div>
                </div>
                <button
                  type="button"
                  className={`UiSkillConnectButton ${installed ? s.UiClawHubRemoveBtn : s.UiClawHubInstallBtn}`}
                  disabled={busy}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (installed) {
                      onRemove(skill.slug);
                      return;
                    }
                    onInstall(skill.slug);
                  }}
                >
                  {busy
                    ? actionKind === "remove"
                      ? "Removing…"
                      : "Installing…"
                    : installed
                      ? "Remove"
                      : "Install"}
                </button>
              </div>

              {/* Summary */}
              <div className="UiSkillDescription">{skill.summary ?? ""}</div>

              {/* Footer: author + stats left, badges right */}
              <div className={s.UiClawHubFooter}>
                <div className={s.UiClawHubFooterLeft}>
                  {ownerLabel ? <span className={s.UiClawHubAuthor}>by {ownerLabel}</span> : null}
                  <span className={s.UiClawHubStat} title="Stars">
                    ★ {formatCount(skill.stats?.stars ?? 0)}
                  </span>
                  <span className={s.UiClawHubStat} title="Downloads">
                    ↓ {formatCount(skill.stats?.downloads ?? 0)}
                  </span>
                </div>
                {skill.badges?.highlighted || skill.badges?.official ? (
                  <div className={s.UiClawHubBadgeRow}>
                    {skill.badges.highlighted ? (
                      <span className={s.UiClawHubFeaturedBadge}>FEATURED</span>
                    ) : null}
                    {skill.badges.official ? (
                      <span className={s.UiClawHubOfficialBadge}>OFFICIAL</span>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {/* Infinite scroll sentinel */}
      {hasMore ? (
        <div ref={sentinelRef} className={s.UiClawHubScrollSentinel}>
          {loadingMore ? <span className={s.UiClawHubLoadingMore}>Loading…</span> : null}
        </div>
      ) : null}
    </div>
  );
}
