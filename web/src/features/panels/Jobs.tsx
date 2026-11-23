import { Button, Input, Select, TextArea } from "../../components/ui";
import { useText } from "../../app/locale/text";
import { useState } from "react";
import { Dialog } from "../../components/Overlay";
import { Icon } from "../../components/Icon";
import type { Desk, Job } from "../../../../shared/workspace";
export function Jobs({
  desk,
  act,
}: {
  desk: Desk;
  act: (op: Record<string, unknown>) => Promise<Desk>;
}) {
  const tr = useText();
  const [tab, setTab] = useState("已开启"),
    [query, setQuery] = useState(""),
    [create, setCreate] = useState(false),
    [detail, setDetail] = useState<Job | null>(null);
  const [error, setError] = useState("");
  const visible = desk.jobs.filter(
    (j) => (tab === "全部" || j.status === tab) && j.name.includes(query),
  );
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return (
    <article className="page jobs">
      <header>
        <h1>{tr("自动化任务")}</h1>
        <Button
          variant="primary"
          className="primary"
          onClick={() => setCreate(true)}
        >
          <Icon name="plus" size={14} /> 新建 <Icon name="down" size={14} />
        </Button>
      </header>
      <div className="tabs">
        {["已开启", "已暂停", "已结束", "全部"].map((t) => (
          <Button
            variant="ghost"
            key={t}
            className={tab === t ? "active" : ""}
            onClick={() => setTab(t)}
          >
            {tr(t)}
          </Button>
        ))}
      </div>
      <label className="searchbox">
        <Icon name="search" />
        <Input
          aria-label={tr("搜索任务")}
          placeholder={tr("搜索自动化任务")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      {visible.length ? (
        visible.map((j) => (
          <Button
            variant="ghost"
            className="catalogRow"
            key={j.id}
            onClick={() => setDetail(j)}
          >
            <Icon name="clock" />
            <strong>{j.name}</strong>
            <small>{j.schedule.replace("T", " ")}</small>
          </Button>
        ))
      ) : (
        <div className="emptyJobs">
          <Icon name="jobs-empty" size={48} />
          <p>
            {query
              ? "没有匹配的自动化任务"
              : tab === "全部"
                ? "没有自动化任务"
                : "没有" + tab + "的自动化任务"}
          </p>
          <Button
            variant="default"
            className="outline"
            onClick={() => setCreate(true)}
          >
            {tr("新建自动化任务")}
          </Button>
        </div>
      )}
      {create && (
        <Dialog
          title={tr("手动创建")}
          close={() => setCreate(false)}
          className="formDialog"
        >
          <h2>{tr("手动创建")}</h2>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              try {
                await act({
                  action: "job",
                  name: data.get("name"),
                  prompt: data.get("prompt"),
                  workspace: data.get("workspace"),
                  schedule: data.get("schedule"),
                  repeat: data.get("repeat") === "重复",
                });
                setTab("已开启");
                setCreate(false);
              } catch (err) {
                setError(String(err));
              }
            }}
          >
            <label>
              {tr("自动化任务名称")}
              <Input name="name" autoFocus required />
            </label>
            <label>
              {tr("自动化任务内容")}
              <TextArea name="prompt" required />
            </label>
            <label>
              {tr("执行位置")}
              <Select
                defaultValue="reuse"
                options={[{ value: "reuse", label: tr("新建会话并复用") }]}
              />
            </label>
            <label>
              {tr("关联工作区")}
              <Select
                name="workspace"
                defaultValue="未分组"
                options={["未分组", ...desk.workspaces].map((value) => ({
                  value,
                  label: value,
                }))}
              />
            </label>
            <h3>{tr("运行时间")}</h3>
            <label>
              {tr("重复")}
              <Select
                name="repeat"
                defaultValue="仅一次"
                options={["仅一次", "重复"].map((value) => ({
                  value,
                  label: tr(value),
                }))}
              />
            </label>
            <label>
              日期与时间
              <Input
                type="datetime-local"
                name="schedule"
                defaultValue={now.toISOString().slice(0, 16)}
                required
              />
            </label>
            <small>
              {tr("时区")}
              {Intl.DateTimeFormat().resolvedOptions().timeZone}
            </small>
            {error && <p role="alert">{error}</p>}
            <footer>
              <Button
                variant="ghost"
                type="button"
                onClick={() => setCreate(false)}
              >
                {tr("放弃")}
              </Button>
              <Button variant="primary" type="submit" className="primary">
                {tr("创建")}
              </Button>
            </footer>
          </form>
        </Dialog>
      )}
      {detail && (
        <Dialog
          title={detail.name}
          close={() => setDetail(null)}
          className="formDialog"
        >
          <h2>{detail.name}</h2>
          <p>{detail.prompt}</p>
          <p>
            {detail.workspace} · {detail.schedule}
          </p>
          <footer>
            <Button variant="ghost" onClick={() => setDetail(null)}>
              {tr("关闭")}
            </Button>
            <Button
              variant="default"
              className="outline"
              onClick={async () => {
                await act({
                  action: "job-status",
                  id: detail.id,
                  status: detail.status === "已开启" ? "已暂停" : "已开启",
                });
                setDetail(null);
              }}
            >
              {detail.status === "已开启" ? "暂停" : "开启"}
            </Button>
          </footer>
        </Dialog>
      )}
    </article>
  );
}
