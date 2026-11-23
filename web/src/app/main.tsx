import { DocumentLinks } from "../features/panels/DocumentPreview";
import { reconcileDesk } from "../api/reconcileDesk";
import { AssistantProvider } from "../features/conversation/AssistantProvider";
import { Button } from "../components/ui";
import { RecentSessions } from "../features/workspace/RecentSessions";
import { TextContext, textFor, languages, languageTags } from "./locale/text";
import {
  Shortcuts,
  readBindings,
  keyName,
} from "../features/settings/Shortcuts";
import { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import {
  emptyDesk,
  PERSONAL_SESSION_ID,
  messageCountOf,
  workspaceName,
  type Desk,
  type Session,
} from "../../../shared/workspace";
import {
  deskRequest,
  encodeAttachments,
  workspaceUrl,
  sessionRequest,
} from "../api/desk";
import { Icon } from "../components/Icon";
import { Menu, type Popover, type MenuItem } from "../components/Overlay";
import { Sidebar } from "../features/workspace/Sidebar";
import { Picker } from "../features/workspace/Picker";
import { Composer } from "../features/composer/Composer";
import { Settings, type Preferences } from "../features/settings/Settings";
import { Jobs } from "../features/panels/Jobs";
import { ThreadUsage } from "../features/conversation/ThreadUsage";
import { Insights } from "../features/insights/Insights";
import { Inspector } from "../features/panels/Inspector";
const Thread = lazy(() =>
  import("../features/conversation/Thread").then((m) => ({
    default: m.Thread,
  })),
);
import "../styles/elements.css";
import "../styles/theme.css";
import "../styles/desk.css";

function App() {
  const [desk, setDesk] = useState<Desk>(emptyDesk),
    [page, setPage] = useState("会话"),
    [dialog, setDialog] = useState(""),
    [popup, setPopup] = useState<Popover | null>(null),
    [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [inspect, setInspect] = useState(false);
  const [workspace, setWorkspace] = useState(
      sessionStorage.getItem("workspace") || "",
    ),
    [session, setSession] = useState(location.hash.slice(1));
  const [viewport, setViewport] = useState(innerWidth),
    [drawer, setDrawer] = useState(false),
    [compact, setCompact] = useState(
      innerWidth < 1024 || localStorage.getItem("mini") === "true",
    ),
    [width, setWidth] = useState(
      Number(localStorage.getItem("sidebar")) || 280,
    );
  const [prefs, setPrefs] = useState<Preferences>(() =>
    JSON.parse(localStorage.getItem("preferences") || "{}"),
  );
  const applyDesk = useCallback((next: Desk) => {
    setLoaded(true);
    setDesk((previous) => reconcileDesk(previous, next));
  }, []);
  const update = useCallback(
    async (op?: Record<string, unknown>) => {
      const next = await deskRequest(op);
      applyDesk(next);
      return next;
    },
    [applyDesk],
  );
  useEffect(() => {
    let alive = true,
      events: EventSource | undefined;
    void deskRequest()
      .then((next) => {
        if (!alive) return;
        applyDesk(next);
        if (!alive) return;
        events = new EventSource(workspaceUrl("/api/desk/events", session));
        events.onmessage = (e) => {
          applyDesk(JSON.parse(e.data));
        };
      })
      .catch((e) => setError(e.message));
    return () => {
      alive = false;
      events?.close();
    };
  }, [session, applyDesk]);
  useEffect(() => {
    const resize = () => {
      setViewport(innerWidth);
      if (innerWidth < 1024 !== viewport < 1024) setCompact(innerWidth < 1024);
      setDrawer(false);
    };
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [viewport < 1024]);
  useEffect(() => {
    const fn = () => {
      setPage("会话");
      setSession(location.hash.slice(1));
    };
    window.addEventListener("hashchange", fn);
    return () => window.removeEventListener("hashchange", fn);
  }, []);
  useEffect(() => {
    document.documentElement.lang =
      languageTags[Math.max(0, languages.indexOf(prefs["语言"] || "中文"))];
    const scheme = matchMedia("(prefers-color-scheme: dark)");
    const syncTheme = () => {
      const theme = prefs["外观"];
      document.documentElement.dataset.theme =
        theme === "深色" || (theme !== "浅色" && scheme.matches)
          ? "dark"
          : "light";
    };
    syncTheme();
    scheme.addEventListener("change", syncTheme);
    return () => scheme.removeEventListener("change", syncTheme);
  }, [prefs]);
  const hide = useCallback(() => setPopup(null), []);
  function menu(
    anchor: HTMLElement,
    items: MenuItem[],
    layout?: Popover["layout"],
  ) {
    setPopup((old) =>
      layout === "permission" && old?.anchor === anchor
        ? null
        : { anchor, items, layout },
    );
  }
  function navigate(p: string) {
    setPage(p);
    setPopup(null);
    setDrawer(false);
  }
  function openSession(s: Session) {
    navigate("会话");
    if (s.id !== PERSONAL_SESSION_ID) {
      setWorkspace(s.workspace);
      sessionStorage.setItem("workspace", s.workspace);
    }
    setSession(s.id);
    history.pushState(null, "", "#" + s.id);
  }
  function newChat(path?: string) {
    if (path) {
      setWorkspace(path);
      sessionStorage.setItem("workspace", path);
    }
    navigate("会话");
    setSession("");
    history.pushState(null, "", location.pathname);
  }
  const current = desk.sessions.find((s) => s.id === session),
    activeFolder = current?.workspace || (desk.workspaces.includes(workspace) ? workspace : "");
  // Existing databases predate lastSelection. Only real CLI sessions can supply a fallback.
  const previousRun = desk.lastSelection ? undefined : desk.sessions.reduce<Session | undefined>(
    (recent, item) => item.model && (item.piSession || item.codexThread) &&
      (!recent || (item.updatedAt || 0) > (recent.updatedAt || 0)) ? item : recent, undefined);
  const personal = session === PERSONAL_SESSION_ID;
  const hasMessages = !!current && messageCountOf(current) > 0;
  useEffect(() => {
    if (loaded && session && !current) {
      setSession("");
      history.replaceState(null, "", location.pathname);
    }
  }, [loaded, session, current]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const loadEarlier = async () => {
    if (!current || historyLoading || !current.messages.length) return;
    const id = current.id;
    const firstId = current.messages[0].id;
    const snapshot = current.messages;
    const offset = current.messageOffset ?? 0;
    setHistoryLoading(true);
    setDesk((previous) => ({
      ...previous,
      sessions: previous.sessions.map((item) =>
        item.id === id ? { ...item, historyLoaded: true } : item,
      ),
    }));
    try {
      const page = await sessionRequest(id, firstId);
      setDesk((previous) => ({
        ...previous,
        sessions: previous.sessions.map((item) => {
          if (
            item.id !== id ||
            !item.messages.length ||
            location.hash.slice(1) !== id
          )
            return item;
          // A live turn may advance the latest page while the older page is in flight.
          const overlap = snapshot.slice(
            0,
            Math.max(0, (item.messageOffset ?? 0) - offset),
          );
          const seen = new Set<string>();
          const messages = [
            ...page.messages,
            ...overlap,
            ...item.messages,
          ].filter((message) => {
            if (seen.has(message.id)) return false;
            seen.add(message.id);
            return true;
          });
          return {
            ...item,
            messages,
            messageOffset: page.messageOffset,
            historyLoaded: true,
          };
        }),
      }));
    } catch (error) {
      setError(String(error));
    } finally {
      setHistoryLoading(false);
    }
  };
  const mobile = viewport < 768;
  const collapsed = !mobile && compact;
  function toggle() {
    if (mobile) setDrawer((v) => !v);
    else {
      setCompact(!compact);
      localStorage.setItem("mini", String(!compact));
    }
  }
  useEffect(() => {
    const listen = (e: KeyboardEvent) => {
      if (document.querySelector("[role=dialog]") || e.isComposing || !e.key)
        return;
      const action = Object.entries(readBindings()).find(
        ([, key]) => key && key === keyName(e),
      )?.[0];
      if (!action) return;
      e.preventDefault();
      switch (action) {
        case "快捷键速查":
          setDialog("shortcuts");
          break;
        case "新会话":
          newChat();
          break;
        case "展开／收起左侧栏":
          toggle();
          break;
        case "打开设置":
          setDialog("settings");
          break;
        case "添加工作区":
          setDialog("workspace");
          break;
        case "展开／收起右侧栏":
          setInspect((v) => !v);
          break;
        case "搜索会话":
          if (mobile) setDrawer(true);
          document.dispatchEvent(new Event("thindesk-search"));
          break;
      }
    };
    document.addEventListener("keydown", listen);
    return () => document.removeEventListener("keydown", listen);
  });
  return (
    <AssistantProvider
      session={current}
      scope={session}
      selectionReady={loaded && (!session || !!current)}
      lastSelection={desk.lastSelection || (previousRun && {
        agent: previousRun.agent || (previousRun.piSession ? "pi" : "codex"),
        model: previousRun.model!, effort: previousRun.effort,
      })}
      workspace={activeFolder}
      defaultPermission={prefs["权限"] || "完全权限"}
      stop={() => {
        void update({ action: "stop", session: current?.id }).catch((e) =>
          setError(e.message),
        );
      }}
      queueAction={async (operation) => {
        try {
          await update({ ...operation, session: current?.id });
        } catch (error) {
          setError(String(error));
          throw error;
        }
      }}
      send={async (
        text,
        attachments,
        mode,
        permission,
        agent,
        model,
        immediate,
        effort,
      ) => {
        try {
          const d = await update({
            action: "message",
            agent,
            model,
            immediate,
            effort,
            mode,
            permission,
            workspace: activeFolder,
            session: current?.id,
            text,
            attachments: await encodeAttachments(attachments),
          });
          const s = current
            ? d.sessions.find((x) => x.id === current.id)
            : d.sessions[0];
          if (s && (!current || location.hash.slice(1) === current.id))
            openSession(s);
        } catch (e) {
          setError(String(e));
          throw e;
        }
      }}
    >
      <TextContext.Provider value={textFor(prefs["语言"] || "中文")}>
        <div
          className={"frame" + (drawer ? " drawerOpen" : "")}
          style={
            {
              "--sidebar": (collapsed ? 56 : width) + "px",
              "--message-size": (prefs["字号大小"] || 16) + "px",
            } as CSSProperties
          }
        >
          {mobile && drawer && (
            <button
              className="drawerMask"
              aria-label="关闭侧边栏"
              onClick={toggle}
            />
          )}
          <Sidebar
            active={session}
            act={update}
            desk={desk}
            collapsed={collapsed}
            toggle={toggle}
            pick={() => setDialog("workspace")}
            select={openSession}
            menu={menu}
            personal={() => {
              void update({ action: "open-personal" }).then(d => {
                const assistant = d.sessions.find(s => s.id === PERSONAL_SESSION_ID);
                if (assistant) openSession(assistant);
              }).catch(e => setError(e.message));
            }}
            settings={() => setDialog("settings")}
            newChat={newChat}
            deleted={(id) => {
              if (location.hash.slice(1) === id) newChat();
            }}
          />
          {!mobile && !compact && (
            <div
              className="resizer"
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => {
                if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                  const w = Math.min(420, Math.max(264, e.clientX));
                  setWidth(w);
                  localStorage.setItem("sidebar", String(w));
                }
              }}
              onDoubleClick={() => {
                setWidth(280);
                localStorage.removeItem("sidebar");
              }}
            />
          )}
          <main>
            {mobile && (
              <Button
                variant="ghost"
                className="drawerToggle iconButton"
                aria-label="打开侧边栏"
                onClick={toggle}
              >
                <Icon name="sidebar" />
              </Button>
            )}
            {page === "会话" ? (
              <div
                className={"conversation " + (hasMessages ? "hasThread" : "")}
              >
                <div className="blankHeader" />
                {hasMessages && (
                  <Button
                    variant="ghost"
                    className="threadMenu iconButton"
                    aria-label="会话操作"
                    onClick={(e) =>
                      menu(e.currentTarget, [
                        { label: "新会话", action: newChat },
                        { label: "设置", action: () => setDialog("settings") },
                      ])
                    }
                  >
                    <Icon name="more" size={16} />
                  </Button>
                )}
                {activeFolder && !inspect && (
                  <Button
                    variant="ghost"
                    className="inspectorToggle iconButton"
                    aria-label="打开右侧边栏"
                    onClick={() => setInspect(true)}
                  >
                    <Icon name="sidebar" />
                  </Button>
                )}
                {current && hasMessages && !current.messages.length && (
                  <div
                    className="messages"
                    role="status"
                    aria-label="正在加载会话"
                  >
                    正在加载会话…
                  </div>
                )}
                {current && current.messages.length > 0 && (
                  <Suspense
                    fallback={
                      <div
                        className="messages"
                        role="status"
                        aria-label="正在加载会话"
                      />
                    }
                  >
                    <Thread
                      key={current.id}
                      menu={menu}
                      branch={personal ? undefined : (id) => {
                        void update({
                          action: "fork",
                          session: current.id,
                          message: id,
                        })
                          .then((d) => openSession(d.sessions[0]))
                          .catch((e) => setError(e.message));
                      }}
                      codeViews={prefs["显示代码工作视图"] !== "关"}
                      stepDisplay={prefs["工作步骤展示"] || "标准"}
                      collapseTiming={prefs["工作步骤收起时机"] || "回答结束后"}
                      replyDisplay={prefs["收起后显示的回复"] || "全部回复"}
                      session={current}
                      recover={async (message, action) => {
                        await update({ action, message, session: current.id });
                      }}
                      loadEarlier={loadEarlier}
                      historyLoading={historyLoading}
                      answer={(id, approved) => {
                        void update({
                          action: "approval",
                          session: current.id,
                          id,
                          approved,
                        }).catch((e) => setError(e.message));
                      }}
                    />
                  </Suspense>
                )}
                <div className="seat">
                  <Composer
                    reasoningTokens={current?.agent === "codex" ? current.messages.at(-1)?.tokenUsage?.reasoningOutputTokens : undefined}
                    downloadLog={async () => {
                      try {
                        const { downloadSession } =
                          await import("../features/conversation/downloadSession");
                        await downloadSession(current, activeFolder);
                      } catch (error) {
                        setError(
                          error instanceof Error
                            ? error.message
                            : "下载日志失败",
                        );
                      }
                    }}
                    personal={personal}
                    popupLayout={popup?.layout}
                    key={current?.id || "new"}
                    hero={!hasMessages}
                    workspace={activeFolder}
                    projectName={workspaceName(desk, activeFolder)}
                    session={current?.id || ""}
                    running={!!current?.running}
                    pick={(anchor) => menu(anchor, desk.workspaces.length ? desk.workspaces.map((path) => ({
                      label: workspaceName(desk, path),
                      selected: path === activeFolder,
                      action: () => newChat(path),
                    })) : [{ label: "暂无项目，请先在侧栏创建" }])}
                    menu={menu}
                  />
                  {!hasMessages && !personal && (
                    <RecentSessions
                      sessions={desk.sessions.filter(s => s.id !== PERSONAL_SESSION_ID)}
                      select={openSession}
                    />
                  )}
                </div>
                {hasMessages && current && <ThreadUsage session={current} openInsights={() => navigate("上下文洞察")} />}
              </div>
            ) : page === "自动化任务" ? (
              <Jobs desk={desk} act={update} />
            ) : (
              <Insights desk={desk} back={() => navigate("会话")} select={openSession} />
            )}
          </main>
          {page === "会话" && activeFolder && inspect && (
            <Inspector
              key={activeFolder}
              desk={desk}
              workspace={activeFolder}
              onClose={() => setInspect(false)}
            />
          )}
          {popup && <Menu menu={popup} close={hide} />}
          {dialog === "shortcuts" ? (
            <Shortcuts close={() => setDialog("")} />
          ) : dialog === "workspace" ? (
            <Picker
              close={() => setDialog("")}
              choose={async (path, name) => {
                await update({ action: "workspace", path, name });
                newChat(path);
                setDialog("");
              }}
            />
          ) : dialog === "settings" ? (
            <Settings
              workspace={activeFolder}
              values={prefs}
              openPanel={(panel) => {
                setDialog("");
                navigate(panel);
              }}
              update={(k, v) => {
                const n = { ...prefs, [k]: v };
                setPrefs(n);
                localStorage.setItem("preferences", JSON.stringify(n));
              }}
              close={() => setDialog("")}
            />
          ) : null}
          {error && (
            <div role="status" className="toast">
              {error}
              <Button
                variant="ghost"
                aria-label="关闭提示"
                onClick={() => setError("")}
              >
                <Icon name="close" size={16} />
              </Button>
            </div>
          )}
        </div>
      </TextContext.Provider>
    </AssistantProvider>
  );
}
createRoot(document.getElementById("root")!).render(<DocumentLinks><App /></DocumentLinks>);
