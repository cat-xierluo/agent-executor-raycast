import {
  List,
  ActionPanel,
  Action,
  showToast,
  Toast,
  Icon,
  launchCommand,
  LaunchType,
} from "@raycast/api";
import { useState, useEffect } from "react";
import {
  scanHermesProfiles,
  getSelectedHermesProfile,
  setSelectedHermesProfile,
  MAIN_PROFILE_LABEL,
} from "./utils/hermesProfile";

interface ProfileRow {
  name: string; // "" 表示主 Hermes
  title: string;
  subtitle: string;
}

export default function SelectProfile() {
  const [rows, setRows] = useState<ProfileRow[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const profiles = scanHermesProfiles();
        const current = await getSelectedHermesProfile();

        const list: ProfileRow[] = [
          {
            name: "",
            title: MAIN_PROFILE_LABEL,
            subtitle: "~/.hermes（用户级全部技能）",
          },
          ...profiles.map((p) => ({
            name: p.name,
            title: p.name,
            subtitle:
              (p.description ? p.description + " · " : "") +
              `${p.skillCount} skills · ${p.home.replace(
                /^\/Users\/[^/]+/,
                "~",
              )}`,
          })),
        ];

        setRows(list);
        setSelected(current);
      } catch (error) {
        await showToast({
          style: Toast.Style.Failure,
          title: "扫描 profile 失败",
          message: error instanceof Error ? error.message : "未知错误",
        });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function pick(name: string) {
    await setSelectedHermesProfile(name);
    await showToast({
      style: Toast.Style.Success,
      title: name ? `已切换到 ${name}` : "已切换到主 Hermes",
    });
    // 回到主界面，加载的 skills 立即按新 profile 走
    try {
      await launchCommand({ name: "commands", type: LaunchType.UserInitiated });
    } catch {
      // launchCommand 失败不致命，用户手动打开主界面也行
    }
  }

  return (
    <List isLoading={loading} searchBarPlaceholder="搜索 profile...">
      {rows.map((row) => (
        <List.Item
          key={row.name || "__main__"}
          icon={row.name ? Icon.Person : Icon.House}
          title={row.title}
          subtitle={row.subtitle}
          accessories={
            selected === row.name ? [{ icon: Icon.Checkmark }] : []
          }
          actions={
            <ActionPanel>
              {selected === row.name ? (
                <Action
                  title="取消选择（回主 Hermes）"
                  icon={Icon.XMarkCircle}
                  onAction={() => pick("")}
                />
              ) : (
                <Action
                  title="切换到此 profile"
                  icon={Icon.Switch}
                  onAction={() => pick(row.name)}
                />
              )}
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}
