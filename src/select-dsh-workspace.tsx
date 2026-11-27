import {
  Action,
  ActionPanel,
  Icon,
  List,
  Toast,
  launchCommand,
  LaunchType,
  showToast,
} from "@raycast/api";
import { useEffect, useState } from "react";
import {
  getSelectedDshWorkspaceSync,
  resolveDshWorkspaceHome,
  scanDshWorkspaces,
  setSelectedDshWorkspaceSync,
} from "./utils/dshWorkspace";

export default function SelectDshWorkspace() {
  const [rows, setRows] = useState(() => scanDshWorkspaces());
  const [selected, setSelected] = useState(() => getSelectedDshWorkspaceSync());

  useEffect(() => {
    setRows(scanDshWorkspaces());
    setSelected(getSelectedDshWorkspaceSync());
  }, []);

  async function pick(name: string) {
    const home = resolveDshWorkspaceHome(name);
    if (!home) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Workspace 不可用",
        message: "目录不存在或缺少 skills/",
      });
      return;
    }

    setSelectedDshWorkspaceSync(name);
    setSelected(name);
    await showToast({
      style: Toast.Style.Success,
      title: `已切换到 ${name}`,
      message: home.replace(/^\/Users\/[^/]+/, "~"),
    });
    try {
      await launchCommand({
        name: "commands",
        type: LaunchType.UserInitiated,
      });
    } catch {
      // The main command can be reopened manually.
    }
  }

  return (
    <List
      isLoading={rows.length === 0}
      searchBarPlaceholder="搜索 DSH workspace..."
    >
      <List.EmptyView
        title="未发现 DSH workspace"
        description="在 ~/.dsh/bot/workspace/<bot>/skills/ 下存在技能的目录会自动出现"
        icon={Icon.Box}
      />
      {rows.map((row) => (
        <List.Item
          key={row.name}
          icon={Icon.Box}
          title={row.name}
          subtitle={
            row.description
              ? `${row.description} · ${row.skillCount} skills`
              : `${row.skillCount} skills`
          }
          accessories={selected === row.name ? [{ icon: Icon.Checkmark }] : []}
          actions={
            <ActionPanel>
              <Action
                title={
                  selected === row.name
                    ? "Reselect This Workspace"
                    : "Switch to This Workspace"
                }
                icon={Icon.Switch}
                onAction={() => pick(row.name)}
              />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}
