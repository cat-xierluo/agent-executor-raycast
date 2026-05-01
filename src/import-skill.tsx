import { Form, showToast, Toast, ActionPanel, Action, Icon } from "@raycast/api";
import { useState, useEffect } from "react";
import { isValidSkillDir, importSkill, invalidateSkillsCache } from "./utils/skills";
import { getConfig } from "./utils/claude";

export default function ImportSkill() {
  const [sourceDir, setSourceDir] = useState<string[]>([]);
  const [targetProjectDir, setTargetProjectDir] = useState<string>("");
  const [projectDirs, setProjectDirs] = useState<{ title: string; value: string }[]>([]);

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
  const isValid = selectedPath ? isValidSkillDir(selectedPath) : null;

  async function handleSubmit() {
    if (!selectedPath) {
      await showToast({ style: Toast.Style.Failure, title: "请选择 Skill 目录" });
      return;
    }

    if (!isValid) {
      await showToast({ style: Toast.Style.Failure, title: "所选目录不是有效的 Skill" });
      return;
    }

    if (!targetProjectDir) {
      await showToast({ style: Toast.Style.Failure, title: "请选择目标项目目录" });
      return;
    }

    const result = importSkill(selectedPath, targetProjectDir);

    if (result.success) {
      await showToast({ style: Toast.Style.Success, title: result.message });
    } else {
      await showToast({ style: Toast.Style.Failure, title: "导入失败", message: result.message });
    }
  }

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm title="导入 Skill" icon={Icon.Download} onAction={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.FilePicker
        id="sourceDir"
        title="选择 Skill 目录"
        canChooseDirectories
        allowMultipleSelection={false}
        onChange={setSourceDir}
        info="选择包含 skill.md 或 .claude 子目录的目录"
      />
      {selectedPath && isValid === false && (
        <Form.Description text="⚠️ 所选目录不是有效的 Skill（缺少 skill.md 或 .claude 目录）" />
      )}
      {selectedPath && isValid === true && (
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
