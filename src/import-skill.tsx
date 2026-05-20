import {
  Form,
  showToast,
  Toast,
  ActionPanel,
  Action,
  Icon,
  openCommandPreferences,
} from "@raycast/api";
import { useState, useEffect } from "react";
import {
  isValidSkillDir,
  importSkill,
  importSkillFromUrl,
} from "./utils/skills";
import { getConfig } from "./utils/claude";
import { resolve } from "path";

function isLocalPath(input: string): boolean {
  return (
    input.startsWith("/") ||
    input.startsWith("~") ||
    input.startsWith("./") ||
    input.startsWith("../")
  );
}

export default function ImportSkill() {
  const [address, setAddress] = useState("");
  const [sourceDir, setSourceDir] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [targetProjectDir, setTargetProjectDir] = useState<string>("");
  const [projectDirs, setProjectDirs] = useState<
    { title: string; value: string }[]
  >([]);

  useEffect(() => {
    const config = getConfig();
    const dirs = config.projectDirs
      .filter((d) => d.trim().length > 0)
      .map((d) => ({ title: d.split("/").pop() || d, value: d }));
    setProjectDirs(dirs);
    if (dirs.length > 0) {
      setTargetProjectDir(dirs[0].value);
    }
  }, []);

  const selectedPath = sourceDir[0] || "";
  const isLocalValid = selectedPath ? isValidSkillDir(selectedPath) : null;
  const noProjectDirs = projectDirs.length === 0;

  // 实时校验地址栏输入的本地路径
  const trimmedAddress = address.trim();
  const addressIsLocal = trimmedAddress ? isLocalPath(trimmedAddress) : false;
  const addressLocalPath = addressIsLocal
    ? resolve(trimmedAddress.replace(/^~/, process.env.HOME || "~"))
    : "";
  const addressLocalValid = addressLocalPath
    ? isValidSkillDir(addressLocalPath)
    : null;

  async function handleSubmit() {
    if (!targetProjectDir) {
      await showToast({
        style: Toast.Style.Failure,
        title: "请选择目标项目目录",
      });
      return;
    }

    // 优先使用地址栏输入
    if (trimmedAddress) {
      if (addressIsLocal) {
        // 本地路径 → 直接创建符号链接
        const result = importSkill(addressLocalPath, targetProjectDir);
        if (result.success) {
          await showToast({
            style: Toast.Style.Success,
            title: result.message,
          });
        } else {
          await showToast({
            style: Toast.Style.Failure,
            title: "导入失败",
            message: result.message,
          });
        }
      } else {
        // 远程 URL → clone 后创建符号链接
        setIsLoading(true);
        try {
          const result = await importSkillFromUrl(
            trimmedAddress,
            targetProjectDir,
          );
          if (result.success) {
            await showToast({
              style: Toast.Style.Success,
              title: "导入成功",
              message: result.message,
            });
          } else {
            await showToast({
              style: Toast.Style.Failure,
              title: "导入失败",
              message: result.message,
            });
          }
        } catch (error) {
          await showToast({
            style: Toast.Style.Failure,
            title: "导入失败",
            message: error instanceof Error ? error.message : "未知错误",
          });
        } finally {
          setIsLoading(false);
        }
      }
      return;
    }

    // 地址栏为空时使用文件选择器
    if (!selectedPath) {
      await showToast({
        style: Toast.Style.Failure,
        title: "请输入地址或选择 Skill 目录",
      });
      return;
    }

    if (!isLocalValid) {
      await showToast({
        style: Toast.Style.Failure,
        title: "所选目录不是有效的 Skill（缺少 skill.md）",
      });
      return;
    }

    const result = importSkill(selectedPath, targetProjectDir);
    if (result.success) {
      await showToast({ style: Toast.Style.Success, title: result.message });
    } else {
      await showToast({
        style: Toast.Style.Failure,
        title: "导入失败",
        message: result.message,
      });
    }
  }

  if (noProjectDirs) {
    return (
      <Form
        actions={
          <ActionPanel>
            <Action
              title="打开扩展设置"
              onAction={openCommandPreferences}
              icon={Icon.Gear}
            />
          </ActionPanel>
        }
      >
        <Form.Description text="⚠️ 未配置项目目录。请在扩展设置中至少配置一个项目目录后再导入 Skill。" />
      </Form>
    );
  }

  return (
    <Form
      isLoading={isLoading}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="导入 Skill"
            icon={Icon.Download}
            onSubmit={handleSubmit}
          />
        </ActionPanel>
      }
    >
      <Form.TextField
        id="address"
        title="Skill 地址"
        value={address}
        onChange={setAddress}
        placeholder="本地路径或 GitHub 链接"
        info="支持本地路径（如 ~/skills/my-skill）或 GitHub 仓库链接（如 https://github.com/user/repo）"
      />
      {addressIsLocal && addressLocalValid === false && (
        <Form.Description text="⚠️ 路径不是有效的 Skill（缺少 skill.md）" />
      )}
      {addressIsLocal && addressLocalValid === true && (
        <Form.Description text="✅ 有效的 Skill 目录" />
      )}

      <Form.Separator />

      <Form.FilePicker
        id="sourceDir"
        title="或选择 Skill 目录"
        canChooseDirectories
        allowMultipleSelection={false}
        onChange={setSourceDir}
        info="也可直接通过上方地址栏输入路径或链接"
      />
      {selectedPath && isLocalValid === false && (
        <Form.Description text="⚠️ 所选目录不是有效的 Skill（缺少 skill.md）" />
      )}
      {selectedPath && isLocalValid === true && (
        <Form.Description text="✅ 有效的 Skill 目录" />
      )}

      {projectDirs.length > 1 && (
        <Form.Dropdown
          id="targetProjectDir"
          title="目标项目目录"
          value={targetProjectDir}
          onChange={setTargetProjectDir}
        >
          {projectDirs.map((d) => (
            <Form.Dropdown.Item key={d.value} title={d.title} value={d.value} />
          ))}
        </Form.Dropdown>
      )}
    </Form>
  );
}
