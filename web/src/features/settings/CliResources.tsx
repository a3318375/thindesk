import { useEffect, useState } from "react";
import { Button, Input, Switch } from "../../components/ui";
import "./CliResources.css";

type Skill = { name: string; description: string; path: string; enabled: boolean; scope: string };
type Server = { name: string; enabled: boolean; state: string; tools?: number; error?: string; scope: string };
type Resources = { skills: Skill[]; servers: Server[]; notice: string; skillError?: string; serverError?: string };
export function CliResources({ workspace }: { workspace?: string }) {
  const [agent, setAgent] = useState("codex");
  const [data, setData] = useState<Resources>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reload, refresh] = useState(0);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("[]");
  const [tokenEnv, setTokenEnv] = useState("");
  const endpoint = "/api/cli-resources?" + new URLSearchParams({ agent, ...(workspace ? { workspace } : {}) });
  useEffect(() => {
    const controller = new AbortController();
    setData(undefined); setError("");
    void fetch(endpoint, { signal: controller.signal }).then(async response => {
      const result = await response.json();
      if (!response.ok) throw Error(result.error || "读取失败");
      if (!controller.signal.aborted) setData(result);
    }).catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [endpoint, reload]);
  async function change(input: object) {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || "CLI 操作失败");
      setData(result); setAdding(false);
    } catch (error) { setError(error instanceof Error ? error.message : "CLI 操作失败"); }
    finally { setBusy(false); }
  }
  return <section className="cliResources" aria-label="CLI 技能和 MCP 管理">
    <header><h3>Skills / MCP</h3><div>
      <Button disabled={busy} aria-pressed={agent === "codex"} onClick={() => setAgent("codex")}>Codex</Button>
      <Button disabled={busy} aria-pressed={agent === "pi"} onClick={() => setAgent("pi")}>Pi</Button>
      <Button variant="ghost" disabled={busy} onClick={() => refresh(n => n + 1)}>重新读取 CLI</Button>
    </div></header>
    <p>{data?.notice || "由 CLI 提供技能清单、管理原生配置；不使用 ThinDesk 独立资源库。"}</p>
    {workspace && <small>读取项目：{workspace}；添加 MCP 默认保存用户级配置。</small>}
    {error && <p role="alert">{error}</p>}
    {!data && !error && <p role="status">正在读取 CLI 资源…</p>}
    {data && <>
      <h4>技能 · {data.skills.length}</h4>
      {data.skillError && <p role="alert">{data.skillError}</p>}
      {!data.skills.length && !data.skillError && <p>CLI 未加载技能</p>}
      {data.skills.map(skill => <div className="cliResourceRow" key={skill.path || skill.name}>
        <div><strong>{skill.name}</strong><p>{skill.description}</p><small>{skill.path} · {skill.scope}</small></div>
        <Switch aria-label={"启用技能 " + skill.name} checked={skill.enabled} disabled={busy} onCheckedChange={enabled => void change({ action: "skill-toggle", path: skill.path, enabled })} />
      </div>)}
      <header><h4>MCP · {data.servers.length}</h4><Button disabled={busy} onClick={() => setAdding(!adding)}>添加 MCP</Button></header>
      {data.serverError && <p role="alert">{data.serverError}</p>}
      {!data.servers.length && !data.serverError && <p>CLI 未配置 MCP</p>}
      {data.servers.map(server => <div className="cliResourceRow" key={server.name}>
        <div><strong>{server.name}</strong><small>{server.state} · {server.scope}{server.tools !== undefined ? ` · ${server.tools} 个工具` : ""}</small>{server.error && <p>{server.error}</p>}</div>
        <Switch aria-label={"启用 MCP " + server.name} checked={server.enabled} disabled={busy || (agent === "pi" && server.scope === "project")} onCheckedChange={enabled => void change({ action: "mcp-toggle", name: server.name, enabled })} />
        <Button variant="ghost" disabled={busy || (agent === "pi" && server.scope === "project")} onClick={() => void change({ action: "mcp-remove", name: server.name })}>移除配置</Button>
      </div>)}
      {adding && <form onSubmit={event => {
        event.preventDefault();
        let parsed; try { parsed = JSON.parse(args); } catch { setError("命令参数请输入 JSON 字符串数组"); return; }
        void change({ action: "mcp-add", name, url, command, args: parsed, tokenEnv });
      }}>
        <label>名称<Input required value={name} onChange={e => setName(e.target.value)} /></label>
        <label>HTTP 地址<Input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://example.com/mcp" /></label>
        {url ? <label>令牌环境变量名（可选）<Input value={tokenEnv} onChange={e => setTokenEnv(e.target.value)} placeholder="MCP_TOKEN" /></label> : <>
          <label>本地命令<Input value={command} onChange={e => setCommand(e.target.value)} placeholder="npx" /></label>
          <label>命令参数（JSON 数组）<Input value={args} onChange={e => setArgs(e.target.value)} placeholder={'["-y", "server-package"]'} /></label>
        </>}
        <small>由原生 CLI 添加；同名配置会替换。环境变量值与 OAuth 凭据仍由 CLI 管理。</small>
        <Button type="submit" disabled={busy}>{busy ? "CLI 正在保存…" : "保存到 CLI"}</Button>
      </form>}
    </>}
  </section>;
}
