// @vitest-environment jsdom
import { beforeAll, describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";

// IntersectionObserver is not available in jsdom
beforeAll(() => {
  globalThis.IntersectionObserver = class IntersectionObserver {
    constructor(
      public callback: IntersectionObserverCallback,
      public options?: IntersectionObserverInit
    ) {}
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
    readonly root: Element | null = null;
    readonly rootMargin: string = "";
    readonly thresholds: readonly number[] = [];
  } as unknown as typeof IntersectionObserver;
});

vi.mock("./ClawHubGrid.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

import { ClawHubGrid } from "./ClawHubGrid";

const skill = {
  slug: "calendar",
  displayName: "Calendar Skill",
  summary: "Manage calendar events",
  badges: { highlighted: false, official: false, deprecated: false },
  stats: {
    downloads: 1200,
    installsCurrent: 42,
    installsAllTime: 100,
    stars: 55,
    versions: 3,
    comments: 2,
  },
  owner: { handle: "magos", displayName: "Magos", image: undefined, kind: "user" },
  latestVersion: { version: "1.2.3", createdAt: Date.now() },
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

describe("ClawHubGrid", () => {
  afterEach(() => cleanup());

  it("shows Remove for installed skills", () => {
    const onInstall = vi.fn();
    const onRemove = vi.fn();

    render(
      <ClawHubGrid
        skills={[skill]}
        loading={false}
        loadingMore={false}
        error={null}
        actionSlug={null}
        actionKind={null}
        installedSlugs={new Set(["calendar"])}
        hasMore={false}
        onInstall={onInstall}
        onRemove={onRemove}
        onOpenDetails={vi.fn()}
        onLoadMore={vi.fn()}
      />
    );

    const button = screen.getByRole("button", { name: "Remove" });
    expect(button.className).toContain("UiClawHubRemoveBtn");

    fireEvent.click(button);
    expect(onRemove).toHaveBeenCalledWith("calendar");
    expect(onInstall).not.toHaveBeenCalled();
  });

  it("displays stats (stars and downloads)", () => {
    render(
      <ClawHubGrid
        skills={[skill]}
        loading={false}
        loadingMore={false}
        error={null}
        actionSlug={null}
        actionKind={null}
        installedSlugs={new Set()}
        hasMore={false}
        onInstall={vi.fn()}
        onRemove={vi.fn()}
        onOpenDetails={vi.fn()}
        onLoadMore={vi.fn()}
      />
    );

    expect(screen.getByText("★ 55")).toBeTruthy();
    expect(screen.getByText("↓ 1.2k")).toBeTruthy();
  });

  it("shows FEATURED badge for highlighted skills", () => {
    const featured = {
      ...skill,
      slug: "featured-skill",
      badges: { highlighted: true, official: false, deprecated: false },
    };

    render(
      <ClawHubGrid
        skills={[featured]}
        loading={false}
        loadingMore={false}
        error={null}
        actionSlug={null}
        actionKind={null}
        installedSlugs={new Set()}
        hasMore={false}
        onInstall={vi.fn()}
        onRemove={vi.fn()}
        onOpenDetails={vi.fn()}
        onLoadMore={vi.fn()}
      />
    );

    expect(screen.getByText("FEATURED")).toBeTruthy();
  });

  it("renders scroll sentinel when hasMore is true", () => {
    render(
      <ClawHubGrid
        skills={[skill]}
        loading={false}
        loadingMore={false}
        error={null}
        actionSlug={null}
        actionKind={null}
        installedSlugs={new Set()}
        hasMore={true}
        onInstall={vi.fn()}
        onRemove={vi.fn()}
        onOpenDetails={vi.fn()}
        onLoadMore={vi.fn()}
      />
    );

    // Sentinel div is rendered (no button anymore, IntersectionObserver triggers load)
    expect(document.querySelector(".UiClawHubScrollSentinel")).toBeTruthy();
  });
});
