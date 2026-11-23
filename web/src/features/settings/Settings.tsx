import { Button, Input, Switch } from "../../components/ui";
import { useText } from "../../app/locale/text";
import { useState } from "react";
import { Agents } from "./Agents";
import { Choice } from "./Choice";
import { Shortcuts } from "./Shortcuts";
import { Dialog } from "../../components/Overlay";
import { Icon } from "../../components/Icon";
import { Messaging } from "../panels/Messaging";
import { Lab } from "../panels/Lab";
export type Preferences = Record<string, string>;
const sections = [
  "通用设置",
  "自动化任务",
  "上下文洞察",
  "Agent 设置",
  "IM机器人",
  "破甲台 · jailbreak",
];
const rows = [
  ["权限", "选择新会话的默认权限模式", "完全权限", "仅可查看", "工作区内修改"],
  [
    "语言",
    "",
    "中文",
    "English",
    "日本語",
    "Español",
    "Français",
    "Deutsch",
    "Русский",
    "Português",
  ],
  ["外观", "", "浅色", "深色", "跟随系统"],
  ["字号大小", "仅影响会话内容的字号", "16"],
  [
    "工作步骤展示",
    "选择希望看到多少工具调用细节",
    "标准",
    "详细",
    "简洁",
    "完全展开",
  ],
  [
    "工作步骤收起时机",
    "选择何时自动收起工作步骤",
    "回答结束后",
    "下次有新消息时",
  ],
  [
    "收起后显示的回复",
    "工作步骤收起后，保留哪些助手回复",
    "全部回复",
    "仅最终回答",
  ],
  [
    "显示代码工作视图",
    "开启后，显示轨迹、本轮代码差异，可选择完整的 Agent 预设切换",
    "开关",
  ],
  ["快捷键", "查看和编辑当前可用的快捷键和输入操作", "编辑快捷键"],
  [
    "繁忙时的发送行为",
    "智能体运行时 Enter 键和发送按钮的行为；Cmd/Ctrl+Enter 使用另一行为",
    "排队发送",
    "插话发送",
  ],
  ["性能与用量", "选择性能与用量信息展示的详细程度", "详细", "简洁"],
  [
    "在使用官方模型 API 时上传 Session Log",
    "帮助改进 DeepSeek 模型与产品",
    "开关",
  ],
];
export function Settings({
  values,
  update,
  close,
  openPanel,
  workspace,
}: {
  workspace?: string;
  values: Preferences;
  update: (k: string, v: string) => void;
  close: () => void;
  openPanel: (panel: string) => void;
}) {
  const tr = useText();
  const [tab, setTab] = useState("通用设置"),
    [child, setChild] = useState("");
  return (
    <Dialog title={tr("设置")} close={close} className="settings">
      <div className="settingsGrid">
        <h2>{tr("设置")}</h2>
        <Button
          variant="ghost"
          className="close"
          aria-label={tr("关闭")}
          onClick={close}
        >
          <Icon name="close" size={16} />
        </Button>
        <nav>
          {sections.map(
            (n, i) => (
                <Button
                  variant="ghost"
                  key={n}
                  className={tab === n ? "active" : ""}
                  onClick={() => ["自动化任务", "上下文洞察"].includes(n) ? openPanel(n) : setTab(n)}
                >
                  <Icon name={["pref0", "clock", "context", "pref3", "pref4", "pref5"][i]} />
                  <span>{tr(n)}</span>
                </Button>
              ),
          )}
        </nav>
        <section className="settingsBody">
          {tab === "通用设置" ? (
            <>
              {rows.map(([key, desc, ...opts]) => (
                <div
                  className={key === "外观" ? "option appearance" : "option"}
                  key={key}
                >
                  <div>
                    {tr(key)}
                    {desc && <small>{tr(desc)}</small>}
                  </div>
                  {key === "外观" ? (
                    <div className="segments">
                      {opts.map((v, i) => (
                        <Button
                          variant="ghost"
                          key={v}
                          className={
                            (values[key] || "跟随系统") === v ? "active" : ""
                          }
                          onClick={() => update(key, v)}
                        >
                          <Icon name={"pref" + (7 + i)} />
                          {tr(v)}
                        </Button>
                      ))}
                    </div>
                  ) : opts[0] === "开关" ? (
                    <Switch
                      aria-label={key}

                      checked={
                        (values[key] ||
                          (key === "显示代码工作视图" ? "开" : "关")) === "开"
                      }

                      onChange={() =>
                        update(
                          key,
                          (values[key] ||
                            (key === "显示代码工作视图" ? "开" : "关")) === "开"
                            ? "关"
                            : "开",
                        )
                      }
                    />
                  ) : key === "字号大小" ? (
                    <label>
                      <Input
                        type="number"
                        min="10"
                        max="28"
                        value={values[key] || 16}
                        onChange={(e) => update(key, e.target.value)}
                      />{" "}
                      px
                    </label>
                  ) : key === "快捷键" ? (
                    <Button
                      variant="default"
                      className="outline"
                      onClick={() => setChild(key)}
                    >
                      {tr("编辑快捷键")}
                    </Button>
                  ) : (
                    <Choice
                      label={key}
                      options={opts}
                      value={values[key] || opts[0]}
                      onChange={(v) => update(key, v)}
                    />
                  )}
                </div>
              ))}
            </>
          ) : tab === "Agent 设置" ? (
            <Agents workspace={workspace} />
          ) : tab === "IM机器人" ? (
            <Messaging />
          ) : (
            <Lab />
          )}
        </section>
      </div>
      {child === "快捷键" && <Shortcuts close={() => setChild("")} />}
    </Dialog>
  );
}
