import { messageBody } from "../../../../shared/workspace";
import { readModels } from "../../api/models";
import type { AgentId, AgentModels, ModelSelection } from "../../../../shared/models";
import {
  AssistantRuntimeProvider,
  WebSpeechDictationAdapter,
  useExternalStoreRuntime,
  type AttachmentAdapter,
  type AppendMessage,
  type ExternalThreadQueueAdapter,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import type { Message, Session } from "../../../../shared/workspace";

const attachments: AttachmentAdapter = {
  accept: "*",
  async add({ file }) {
    return {
      id: Array.from(crypto.getRandomValues(new Uint32Array(4))).join("-"),
      name: file.name,
      type: file.type.startsWith("image/") ? "image" : "file",
      contentType: file.type,
      file,
      status: { type: "requires-action", reason: "composer-send" },
    };
  },
  async remove() {},
  async send(attachment) {
    return { ...attachment, status: { type: "complete" }, content: [] };
  },
};
function convertMessage(message: Message): ThreadMessageLike {
  return {
    id: message.id,
    role: message.role,
    content: [{ type: "text", text: messageBody(message) }],
    createdAt: message.createdAt ? new Date(message.createdAt) : undefined,
  };
}
type Options = {
  mode: string;
  permission: string;
  agent: AgentId;
  model: string;
  effort?: string;
};
const OptionsContext = createContext<{
  options: Options;
  configure: (value: Options) => void;
  selectionReady: boolean;
  draftScope: { current: string | null };
} | null>(null);
export function useComposerOptions() {
  const context = useContext(OptionsContext);
  if (!context) throw Error("缺少会话运行环境");
  return context;
}
const PendingQueueContext = createContext<{
  paused: boolean;
  entries?: Session["queue"];
  error?: string;
  resume: () => void;
}>({ paused: false, resume: () => {} });
export const usePendingQueue = () => useContext(PendingQueueContext);
export function AssistantProvider({
  session,
  workspace,
  lastSelection,
  selectionReady,
  scope,
  defaultPermission,
  send,
  stop,
  queueAction,
  children,
}: {
  session?: Session;
  workspace: string;
  lastSelection?: ModelSelection;
  selectionReady: boolean;
  scope: string;
  defaultPermission: string;
  children: ReactNode;
  send: (
    text: string,
    files: File[],
    mode: string,
    permission: string,
    agent: AgentId,
    model: string,
    immediate?: boolean,
    effort?: string,
  ) => Promise<void>;
  stop: () => void;
  queueAction: (operation: Record<string, unknown>) => Promise<void>;
}) {
  const draftScope = useRef<string | null>(null);
  const [mode, setMode] = useState("标准模式");
  const [permission, setPermission] = useState(defaultPermission);
  useEffect(() => setPermission(defaultPermission), [defaultPermission]);
  const [legacySelection] = useState<ModelSelection | undefined>(() => {
    try {
      const value = JSON.parse(localStorage.getItem("agent-selection") || "null");
      if ((value?.agent === "pi" || value?.agent === "codex") && typeof value.model === "string")
        return value;
    } catch { /* Older browsers may not have a saved selection. */ }
  });
  const [override, setOverride] = useState<ModelSelection>();
  const [previousScope, setPreviousScope] = useState(scope);
  if (previousScope !== scope) {
    setPreviousScope(scope);
    setOverride(undefined);
  }
  const selection = override || (session
    ? { agent: session.agent || (session.piSession ? "pi" : "codex"), model: session.model || "", effort: session.effort }
    : lastSelection || legacySelection);
  const agent = selection?.agent || "codex";
  const [catalog, setCatalog] = useState<AgentModels[]>([]);
  const needDefault = selectionReady && !selection?.model && !session?.codexThread && !session?.piSession;
  useEffect(() => {
    if (needDefault) void readModels().then(setCatalog).catch(() => {});
  }, [needDefault]);
  const model = selection?.model || (needDefault ? catalog.find(group => group.id === agent)?.defaultModel : "") || "";
  const options: Options = {
    mode, agent, model, effort: selection?.effort,
    permission: agent === "pi" && permission === "工作区内修改" ? "仅可查看" : permission,
  };
  function configure(value: Options) {
    if (value.agent !== agent || value.model !== model || value.effort !== options.effort)
      setOverride({ agent: value.agent, model: value.model, effort: value.effort });
    setPermission(value.permission);
    setMode(value.mode);
  }
  const dictation = useMemo(
    () =>
      WebSpeechDictationAdapter.isSupported()
        ? new WebSpeechDictationAdapter({ language: "zh-CN", continuous: true })
        : undefined,
    [],
  );
  const [submitting, setSubmitting] = useState(false);
  async function dispatch(message: AppendMessage, immediate = false) {
    const text = message.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n");
    const files =
      message.attachments?.flatMap((attachment) =>
        attachment.file ? [attachment.file] : [],
      ) ?? [];
    setSubmitting(true);
    try {
      await send(
        text,
        files,
        options.mode,
        options.permission,
        options.agent,
        options.model,
        immediate,
        options.effort,
      );
      setOverride(current => current === override ? undefined : current);
    } catch {
      const existing = runtime.thread.composer.getState().text;
      runtime.thread.composer.setText(existing ? text + "\n" + existing : text);
      for (const file of files)
        await runtime.thread.composer.addAttachment(file);
    } finally {
      setSubmitting(false);
    }
  }
  function act(operation: Record<string, unknown>) {
    void queueAction(operation).catch(() => {});
  }
  const queue: ExternalThreadQueueAdapter = {
    items: (session?.queue ?? []).map((item) => {
      const text =
        item.text || item.attachments.map((file) => file.name).join("、");
      return {
        id: item.id,
        prompt: text,
        parts: [{ type: "text" as const, text }],
      };
    }),
    steerItems: [],
    enqueue: (message) => {
      void dispatch(message);
    },
    // Normal sends enter FIFO; explicit steer asks the CLI without interrupting.
    steer: (message) => {
      void dispatch(message, message.steer === true);
    },
    move: (id, placement) => act({ action: "queue-move", id, placement }),
    remove: (id) => act({ action: "queue-remove", id }),
    edit: (id, message) =>
      act({
        action: "queue-edit",
        id,
        text: message.content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n"),
      }),
  };
  const runtime = useExternalStoreRuntime({
    messages: session?.messages ?? [],
    convertMessage,
    isRunning: !!session?.running,
    isSendDisabled: !selectionReady || !workspace || submitting,
    onCancel: async () => stop(),
    adapters: { attachments, dictation },
    onNew: dispatch,
    queue,
  });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <PendingQueueContext.Provider
        value={{
          paused: !!session?.queuePaused,
          entries: session?.queue,
          error: session?.queueError,
          resume: () => act({ action: "queue-resume" }),
        }}
      >
        <OptionsContext.Provider value={{ options, configure, draftScope, selectionReady }}>
          {children}
        </OptionsContext.Provider>
      </PendingQueueContext.Provider>
    </AssistantRuntimeProvider>
  );
}
