import React from "react";
import { settingsStyles as ps } from "../SettingsPage";
import sit from "./SkillsIntegrationsTab.module.css";

import { TextInput, ConfirmDialog } from "@shared/kit";
import type { GatewayState } from "@main/types";
import { useSkillsStatus } from "./useSkillsStatus";
import { useCustomSkills } from "./useCustomSkills";
import { useSkillModal } from "./useSkillModal";
import { SkillsGrid } from "./SkillsGrid";
import { SkillModals } from "./SkillModals";
import { CustomSkillUploadModal } from "./CustomSkillUploadModal";
import { ClawHubTab } from "./clawhub";
import type { GatewayRpc, ConfigSnapshotLike } from "./skillDefinitions";

type SkillsSubTab = "installed" | "clawhub";

// ── Main tab component ───────────────────────────────────────────────

export function SkillsIntegrationsTab(props: {
  state: Extract<GatewayState, { kind: "ready" }>;
  gw: GatewayRpc;
  configSnap: ConfigSnapshotLike | null;
  reload: () => Promise<void>;
  onError: (value: string | null) => void;
  noTitle?: boolean;
}) {
  const { statuses, markConnected, markDisabled, refresh, loadConfig } = useSkillsStatus({
    gw: props.gw,
    configSnap: props.configSnap,
    reload: props.reload,
  });

  const custom = useCustomSkills(props.onError);
  const modal = useSkillModal({
    gw: props.gw,
    markConnected,
    markDisabled,
    refresh,
    loadConfig,
    onError: props.onError,
  });

  const [searchQuery, setSearchQuery] = React.useState("");
  const [activeSubTab, setActiveSubTab] = React.useState<SkillsSubTab>("clawhub");

  return (
    <div className={ps.UiSettingsContentInner}>
      {!props.noTitle && (
        <div className={sit.UiSkillsTabHeader}>
          <div className={ps.UiSettingsTabTitle}>Skills and Integrations</div>
          <button
            type="button"
            className={sit.UiAddCustomSkillLink}
            onClick={() => custom.setShowUploadModal(true)}
          >
            + Add custom skill
          </button>
        </div>
      )}

      <div className={sit.UiSkillsModeToggleWrap}>
        <div className={sit.UiSkillsModeToggle} role="tablist" aria-label="Skills source">
          <button
            type="button"
            role="tab"
            aria-selected={activeSubTab === "clawhub"}
            className={`${sit.UiSkillsModeOption}${activeSubTab === "clawhub" ? ` ${sit["UiSkillsModeOption--active"]}` : ""}`}
            onClick={() => setActiveSubTab("clawhub")}
          >
            ClawHub
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeSubTab === "installed"}
            className={`${sit.UiSkillsModeOption}${activeSubTab === "installed" ? ` ${sit["UiSkillsModeOption--active"]}` : ""}`}
            onClick={() => setActiveSubTab("installed")}
          >
            Installed
          </button>
        </div>
      </div>

      {activeSubTab === "installed" ? (
        <>
          <div className="UiInputRow">
            <TextInput
              type="text"
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search by skills…"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              isSearch={true}
            />
          </div>

          <SkillsGrid
            searchQuery={searchQuery}
            customSkills={custom.customSkills}
            statuses={statuses}
            onOpenModal={modal.openModal}
            onRemoveCustomSkill={custom.requestRemoveCustomSkill}
          />

          <SkillModals
            activeModal={modal.activeModal}
            onClose={modal.closeModal}
            gw={props.gw}
            loadConfig={loadConfig}
            statuses={statuses}
            onConnected={modal.handleConnected}
            onDisabled={modal.handleDisabled}
          />

          <CustomSkillUploadModal
            open={custom.showUploadModal}
            onClose={() => custom.setShowUploadModal(false)}
            onInstalled={custom.handleCustomSkillInstalled}
          />

          <ConfirmDialog
            open={custom.pendingRemove !== null}
            title={`Remove skill "${custom.pendingRemove?.name ?? ""}"?`}
            subtitle="This will delete the skill files."
            confirmLabel="Remove"
            danger
            onConfirm={() => void custom.confirmRemoveCustomSkill()}
            onCancel={custom.cancelRemoveCustomSkill}
          />
        </>
      ) : (
        <ClawHubTab
          gw={props.gw}
          installedSkillDirs={custom.customSkills.map((skill) => skill.dirName)}
          onInstalledSkillsChanged={() => void custom.refreshCustomSkills()}
        />
      )}
    </div>
  );
}
