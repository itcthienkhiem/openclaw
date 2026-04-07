// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, it, expect, vi, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mockGetDesktopApiOrNull = vi.fn();
const mockAddToast = vi.fn();
const mockAddToastError = vi.fn();
const mockSetSearchQuery = vi.fn();
const mockSetHideSuspicious = vi.fn();
const mockSetSortField = vi.fn();
const mockSetSortDir = vi.fn();
const mockLoadMore = vi.fn();
const mockUseClawHubSkills = vi.fn();
const mockNavigate = vi.fn();

vi.mock("@ipc/desktopApi", () => ({
  getDesktopApiOrNull: () => mockGetDesktopApiOrNull(),
}));

vi.mock("@shared/toast", () => ({
  addToast: (message: string) => mockAddToast(message),
  addToastError: (message: string) => mockAddToastError(message),
}));

const mockSearchParams = new URLSearchParams();
const mockSetSearchParams = vi.fn();
vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
  useSearchParams: () => [mockSearchParams, mockSetSearchParams],
}));

vi.mock("@ui/app/routes", () => ({
  routes: { skills: "/skills", clawhubDetail: "/skills/clawhub" },
}));

vi.mock("@shared/kit", () => ({
  TextInput: ({
    value,
    onChange,
    placeholder,
  }: {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
  }) => (
    <input
      aria-label={placeholder ?? "text-input"}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
  CheckboxRow: ({
    checked,
    onChange,
    children,
  }: {
    checked: boolean;
    onChange: (checked: boolean) => void;
    children: React.ReactNode;
  }) => (
    <label>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      {children}
    </label>
  ),
  SelectDropdown: ({
    value,
    onChange,
    options,
  }: {
    value: string;
    onChange: (value: string) => void;
    options: Array<{ value: string; label: string }>;
  }) => (
    <select aria-label="Sort" value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

vi.mock("./ClawHubGrid.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

vi.mock("../skillDefinitions", () => ({
  BUILTIN_SKILL_IDS: new Set(["google-workspace", "apple-notes"]),
}));

vi.mock("./useClawHubSkills", () => ({
  useClawHubSkills: () => mockUseClawHubSkills(),
}));

import { ClawHubTab } from "./ClawHubTab";

const skill = {
  slug: "calendar",
  displayName: "Calendar Skill",
  summary: "Manage calendar events",
  badges: { highlighted: false, official: false, deprecated: false },
  stats: {
    downloads: 500,
    installsCurrent: 10,
    installsAllTime: 20,
    stars: 15,
    versions: 2,
    comments: 0,
  },
  owner: { handle: "magos", displayName: "Magos", kind: "user" },
  latestVersion: { version: "1.2.3", createdAt: Date.now() },
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

describe("ClawHubTab", () => {
  afterEach(() => cleanup());
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseClawHubSkills.mockReturnValue({
      skills: [skill],
      loading: false,
      loadingMore: false,
      error: null,
      searchQuery: "",
      setSearchQuery: mockSetSearchQuery,
      hideSuspicious: true,
      setHideSuspicious: mockSetHideSuspicious,
      sortField: "downloads",
      setSortField: mockSetSortField,
      sortDir: "desc",
      setSortDir: mockSetSortDir,
      hasMore: false,
      loadMore: mockLoadMore,
    });
  });

  it("installs a skill and requests installed list sync", async () => {
    const request = vi.fn().mockResolvedValue({});
    const onInstalledSkillsChanged = vi.fn().mockResolvedValue(undefined);

    mockGetDesktopApiOrNull.mockReturnValue({
      removeCustomSkill: vi.fn(),
    });

    render(
      <ClawHubTab
        gw={{ request }}
        installedSkillDirs={[]}
        onInstalledSkillsChanged={onInstalledSkillsChanged}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Install" }));

    await waitFor(() =>
      expect(request).toHaveBeenCalledWith("skills.install", {
        source: "clawhub",
        slug: "calendar",
      })
    );
    expect(onInstalledSkillsChanged).toHaveBeenCalledOnce();
    expect(mockAddToast).toHaveBeenCalledWith('Installed "calendar" from ClawHub');
  });

  it("removes an installed skill and requests installed list sync", async () => {
    const removeCustomSkill = vi.fn().mockResolvedValue({ ok: true });
    const onInstalledSkillsChanged = vi.fn().mockResolvedValue(undefined);

    mockGetDesktopApiOrNull.mockReturnValue({
      removeCustomSkill,
    });

    render(
      <ClawHubTab
        gw={{ request: vi.fn() }}
        installedSkillDirs={["calendar"]}
        onInstalledSkillsChanged={onInstalledSkillsChanged}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(removeCustomSkill).toHaveBeenCalledWith("calendar"));
    expect(onInstalledSkillsChanged).toHaveBeenCalledOnce();
    expect(mockAddToast).toHaveBeenCalledWith('Removed "calendar"');
  });

  it("navigates to detail page when skill card is clicked", () => {
    render(
      <ClawHubTab
        gw={{ request: vi.fn() }}
        installedSkillDirs={[]}
        onInstalledSkillsChanged={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText("Calendar Skill"));

    expect(mockNavigate).toHaveBeenCalledWith("/skills/clawhub/calendar");
  });
});
