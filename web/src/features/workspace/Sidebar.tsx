import {
  messageCountOf,
  PERSONAL_SESSION_ID,
  workspaceName,
  type Desk,
  type Session,
} from "../../../../shared/workspace";
import { Button, Input } from "../../components/ui";
import { SessionSourceIcon } from "../../components/SessionSourceIcon";
import { useText } from "../../app/locale/text";
import { useEffect, useState } from "react";
import { Icon } from "../../components/Icon";
import { Dialog, type MenuItem, type Popover } from "../../components/Overlay";

type Props = {
  desk: Desk;
  active: string;
  act: (op: Record<string, unknown>) => Promise<Desk>;
  collapsed: boolean;
  toggle: () => void;
  pick: () => void;
  select: (session: Session) => void;
  menu: (
    el: HTMLElement,
    items: MenuItem[],
    layout?: Popover["layout"],
  ) => void;
  personal: () => void;
  settings: () => void;
  newChat: (path?: string) => void;
  deleted: (id: string) => void;
};
export function Sidebar(p: Props) {
  const tr = useText();
  const [search, setSearch] = useState(false),
    [term, setTerm] = useState("");
  const [expansion, setExpansion] = useState<Record<string, boolean>>(() =>
    JSON.parse(localStorage.getItem("workspace-expansion") || "{}"),
  );
  const [limits, setLimits] = useState<Record<string, number>>({});
  const [layout, setLayout] = useState(
    () => localStorage.getItem("sidebar-layout") || "分项目显示",
  );
  const [sort, setSort] = useState(
    () => localStorage.getItem("sidebar-sort") || "最近更新",
  );
  const [order, setOrder] = useState<string[]>(() =>
    JSON.parse(localStorage.getItem("session-order") || "[]"),
  );
  const [sections, setSections] = useState<Record<string, boolean>>(() =>
    JSON.parse(localStorage.getItem("sidebar-sections") || "{}"),
  );
  const toggleSection = (key: string) =>
    setSections((previous) => {
      const next = { ...previous, [key]: previous[key] === false };
      localStorage.setItem("sidebar-sections", JSON.stringify(next));
      return next;
    });
  const [recentLimit, setRecentLimit] = useState(20);
  const [error, setError] = useState("");
  const [rename, setRename] = useState<Session | null>(null),
    [name, setName] = useState("");
  useEffect(() => {
    localStorage.setItem("workspace-expansion", JSON.stringify(expansion));
  }, [expansion]);
  useEffect(() => {
    localStorage.setItem("sidebar-layout", layout);
  }, [layout]);
  useEffect(() => {
    localStorage.setItem("sidebar-sort", sort);
  }, [sort]);
  useEffect(() => {
    const show = () => {
      setSearch(true);
      if (p.collapsed) p.toggle();
    };
    document.addEventListener("thindesk-search", show);
    return () => document.removeEventListener("thindesk-search", show);
  }, [p.collapsed, p.toggle]);
  const activeWorkspace = p.desk.sessions.find(
    (session) => session.id === p.active,
  )?.workspace;
  useEffect(() => {
    if (activeWorkspace)
      setExpansion((previous) => ({ ...previous, [activeWorkspace]: true }));
  }, [p.active, activeWorkspace]);
  const ranks = new Map(order.map((id, index) => [id, index]));
  const sessions = p.desk.sessions
    .filter(
      (session) =>
        session.id !== PERSONAL_SESSION_ID && !session.archived &&
        session.title.toLowerCase().includes(term.toLowerCase()),
    )
    .sort((a, b) =>
      sort === "最近更新"
        ? (b.updatedAt || 0) - (a.updatedAt || 0)
        : (ranks.get(a.id) ?? Infinity) - (ranks.get(b.id) ?? Infinity),
    );
  const recent = sessions.filter((session) => messageCountOf(session));
  function sessionMenu(el: HTMLElement, session: Session) {
    p.menu(el, [
      {
        label: "重命名",
        action: () => {
          setRename(session);
          setName(session.title);
        },
      },
      {
        label: "复制为新会话",
        action: () => {
          void p
            .act({ action: "fork", session: session.id })
            .then((desk) => p.select(desk.sessions[0]))
            .catch((e) => setError(String(e)));
        },
      },
      {
        label: "删除会话",
        action: () => {
          void p
            .act({ action: "delete-session", session: session.id })
            .then(() => p.deleted(session.id))
            .catch((error) => setError(String(error)));
        },
      },
      {
        label: "归档",
        action: () => {
          void p
            .act({ action: "archive", session: session.id })
            .catch((e) => setError(String(e)));
        },
      },
    ]);
  }
  function view(el: HTMLElement) {
    p.menu(el, [
      {
        label: "整理侧边栏",
        icon: "sidebar",
        children: ["分项目显示", "合并显示"].map((label) => ({
          label,
          selected: layout === label,
          action: () => setLayout(label),
        })),
      },
      {
        label: "聊天排序方式",
        icon: "view-manual-order",
        children: ["最近更新", "手动排序"].map((label) => ({
          label,
          selected: sort === label,
          action: () => setSort(label),
        })),
      },
    ]);
  }
  const iconButton = (
    icon: string,
    label: string,
    action: (el: HTMLElement) => void,
  ) => (
    <Button
      variant="ghost"
      className="iconButton"
      aria-label={tr(label)}
      title={tr(label)}
      onClick={(e) => action(e.currentTarget)}
    >
      <Icon name={icon} size={16} />
    </Button>
  );
  const sessionRow = (session: Session) => (
    <div
      key={session.id}
      className={"sessionLine" + (p.active === session.id ? " active" : "")}
      draggable={sort === "手动排序"}
      onDragStart={(e) =>
        e.dataTransfer.setData("application/x-thindesk-session", session.id)
      }
      onDragOver={(e) => {
        if (
          sort === "手动排序" &&
          e.dataTransfer.types.includes("application/x-thindesk-session")
        )
          e.preventDefault();
      }}
      onDrop={(e) => {
        if (sort !== "手动排序") return;
        const from = e.dataTransfer.getData("application/x-thindesk-session");
        if (
          !from ||
          from === session.id ||
          !p.desk.sessions.some((item) => item.id === from)
        )
          return;
        e.preventDefault();
        const ids = sessions.map((item) => item.id).filter((id) => id !== from);
        ids.splice(ids.indexOf(session.id), 0, from);
        setOrder(ids);
        localStorage.setItem("session-order", JSON.stringify(ids));
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        sessionMenu(e.currentTarget, session);
      }}
    >
      <Button
        variant="ghost"
        className="sessionRow"
        title={session.title + "\n" + workspaceName(p.desk, session.workspace)}
        onClick={() => {
          setSearch(false);
          setTerm("");
          p.select(session);
        }}
      >
        <SessionSourceIcon channel={session.channel} />
        <span>{session.title}</span>
      </Button>
      <Button
        variant="ghost"
        aria-label={session.title + " 的菜单"}
        className="sessionMenu"
        onClick={(e) => sessionMenu(e.currentTarget, session)}
      >
        <Icon name="more" size={14} />
      </Button>
    </div>
  );
  function projectRow(path: string) {
    const members = sessions.filter((session) => session.workspace === path);
    const rows = members.filter((session) => messageCountOf(session));
    const blanks = members.filter((session) => !messageCountOf(session));
    const required = rows
      .slice(0, 50)
      .reduce(
        (limit, session, index) =>
          session.id === p.active || session.running || session.pendingApproval
            ? Math.max(limit, index + 1)
            : limit,
        5,
      );
    const limit = Math.max(required, limits[path] || 0),
      remaining = Math.max(0, rows.length - limit);
    const expanded =
      expansion[path] ??
      path ===
        p.desk.sessions.find((session) => session.sampleUsage)?.workspace;
    return (
      <div key={path} className="projectGroup">
        <div className="folderHeading">
          <Button
            variant="ghost"
            aria-expanded={expanded}
            title={path}
            onClick={() => {
              setExpansion((previous) => ({ ...previous, [path]: !expanded }));
              if (expanded)
                setLimits((previous) => ({ ...previous, [path]: 0 }));
            }}
          >
            <Icon name="down" size={12} />
            <Icon name="folder" />
            <span>{workspaceName(p.desk, path)}</span>
          </Button>
          <Button
            variant="ghost"
            className="newInFolder"
            aria-label={workspaceName(p.desk, path) + " 的项目菜单"}
            onClick={(e) => p.menu(e.currentTarget, [{
              label: "删除",
              action: () => {
                void p.act({ action: "delete-workspace", path })
                  .catch((error) => setError(String(error)));
              },
            }])}
          >
            <Icon name="more" size={16} />
          </Button>
          <Button
            variant="ghost"
            className="newInFolder"
            title="新建会话"
            aria-label={"在 " + path + " 中新建会话"}
            onClick={() => p.newChat(path)}
          >
            <Icon name="edit" size={16} />
          </Button>
        </div>
        {expanded && (
          <div className="projectSessions">
            {blanks.map(sessionRow)}
            {rows.slice(0, limit).map(sessionRow)}
            {rows.length > required && (
              <Button
                variant="ghost"
                className="sessionOverflow"
                aria-expanded={!remaining}
                onClick={() =>
                  setLimits((previous) => ({
                    ...previous,
                    [path]: remaining ? limit + 5 : 0,
                  }))
                }
              >
                {remaining ? "展开其余 " + remaining + " 个会话" : "收起"}
              </Button>
            )}
          </div>
        )}
      </div>
    );
  }
  return (
    <aside
      aria-label={tr("导航")}
      className={"sidebar" + (p.collapsed ? " compact" : "")}
    >
      <header className="logo">
        <Button
          variant="ghost"
          onClick={() => p.newChat()}
          aria-label="ThinDesk 首页"
        >
          <strong>ThinDesk</strong>
        </Button>
        {iconButton(
          "sidebar",
          p.collapsed ? "打开侧边栏" : "收起侧边栏",
          p.toggle,
        )}
      </header>
      <nav className="sidebarPrimary" aria-label="主要导航">
        <Button
          variant="ghost"
          className="newChat"
          aria-label={tr("新建会话")}
          onClick={() => p.newChat()}
        >
          <Icon name="edit" size={18} />
          <span>{tr("新聊天")}</span>
        </Button>
        <Button variant="ghost" className="settingsEntry" aria-label={tr("个人助手")}
          aria-current={p.active === PERSONAL_SESSION_ID ? "page" : undefined} onClick={p.personal}>
          <Icon name="mode" size={18} />
          <span>{tr("个人助手")}</span>
        </Button>
        <Button
          variant="ghost"
          className="settingsEntry"
          aria-label={tr("设置")}
          onClick={p.settings}
        >
          <Icon name="pref0" size={18} />
          <span>{tr("设置")}</span>
        </Button>
      </nav>
      <div className="workspaceList">
        <div className="workspaceHeading">
          <Button
            variant="ghost"
            className="sidebarSectionToggle"
            aria-label="项目"
            aria-expanded={sections.projects !== false}
            onClick={() => toggleSection("projects")}
          >
            <Icon name="down" size={12} />
            {tr("项目")}
          </Button>
          {iconButton("sliders", "整理与排序", view)}
          {iconButton("plus", "创建项目", p.pick)}
        </div>
        {search && (
          <Input
            autoFocus
            aria-label="搜索会话"
            placeholder="搜索会话"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setSearch(false);
                setTerm("");
              }
            }}
          />
        )}
        {!term && layout === "分项目显示" && sections.projects !== false && (
          <section className="projectList" aria-label="项目列表">
            {p.desk.workspaces.map(projectRow)}
            {!p.desk.workspaces.length && (
              <p className="sidebarEmpty">创建项目，开始工作</p>
            )}
          </section>
        )}
        <section className="recentList" aria-label="最近会话">
          <h2>
            <Button
              variant="ghost"
              className="sidebarSectionToggle"
              aria-label="最近"
              aria-expanded={sections.recent !== false}
              onClick={() => toggleSection("recent")}
            >
              <Icon name="down" size={12} />
              {tr("最近")}
            </Button>
          </h2>
          {sections.recent !== false && (
            <>
              {recent.slice(0, recentLimit).map(sessionRow)}
              {recent.length > recentLimit && (
                <Button
                  variant="ghost"
                  className="sessionOverflow"
                  onClick={() => setRecentLimit((limit) => limit + 20)}
                >
                  显示更多会话
                </Button>
              )}
              {!recent.length && <p className="sidebarEmpty">暂无会话</p>}
            </>
          )}
        </section>
      </div>
      {error && (
        <div role="alert">
          {error}
          <Button variant="ghost" onClick={() => setError("")}>
            关闭
          </Button>
        </div>
      )}
      {rename && (
        <Dialog
          title={tr("重命名会话")}
          close={() => setRename(null)}
          className="formDialog"
        >
          <h2>{tr("重命名会话")}</h2>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await p.act({ action: "rename", session: rename.id, name });
                setRename(null);
              } catch (error) {
                setError(String(error));
              }
            }}
          >
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-label={tr("会话名称")}
              required
            />
            <footer>
              <Button
                variant="ghost"
                type="button"
                onClick={() => setRename(null)}
              >
                {tr("取消")}
              </Button>
              <Button variant="primary" type="submit">
                {tr("保存")}
              </Button>
            </footer>
          </form>
        </Dialog>
      )}
    </aside>
  );
}
