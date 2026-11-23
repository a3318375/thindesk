import { CliResources } from "./CliResources";
import { useEffect, useState } from "react";
type Agent = {
  name: string;
  executable: string;
  version: string;
  directory: string;
  configured: boolean;
};
export function Agents({ workspace }: { workspace?: string }) {
  const [agents, setAgents] = useState<Agent[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/agents", { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) throw Error();
        return r.json();
      })
      .then(setAgents)
      .catch(() => {
        if (!controller.signal.aborted) setError("无法读取服务器信息");
      });
    return () => controller.abort();
  }, []);
  return (
    <section className="agentSettings">
      <h2>Agent 设置</h2>
      {error && <p role="alert">{error}</p>}
      {!agents.length && !error && <p>正在读取服务器信息…</p>}
      {agents.map((a) => (
        <section key={a.name}>
          <h3>{a.name}</h3>
          <dl>
            <dt>版本</dt>
            <dd>{a.version || "未检测到"}</dd>
            <dt>可执行文件</dt>
            <dd>
              <code>{a.executable || "未找到"}</code>
            </dd>
            <dt>配置目录</dt>
            <dd>
              <code>{a.directory}</code>
              {!a.configured && "（尚未创建）"}
            </dd>
          </dl>
        </section>
      ))}
      <CliResources workspace={workspace} />
    </section>
  );
}
