import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Bot, Check, CheckCircle2, ChevronDown, Circle, History, LoaderCircle, Plus, RefreshCcw, Send, Sparkles, Square, Trash2, X } from "lucide-react";
import { Button } from "./ui";
import { analyzeProduct, cancelDeepSeekAgent, hasTauriRuntime, streamDeepSeekAgent } from "../lib/desktop";
import {
  addAgentMessage,
  createAgentConversation,
  deleteAgentConversation,
  listAgentConversations,
  listAgentMessages,
  listCustomGenerationTypes,
  renameAgentConversation,
  updateAgentMessage,
  type AgentConversationRecord,
  type AgentMessageRecord,
  type AgentMode,
} from "../lib/database";
import { createId } from "../lib/ids";
import { useAppStore } from "../store/appStore";
import type { ScreenId } from "../types";

type StepState = "done" | "active" | "waiting" | "failed";

interface AgentStep {
  label: string;
  state: StepState;
  sub: string;
}

interface OperatorAction {
  type: "navigate" | "set_platform" | "set_category" | "set_brief" | "set_generation_type";
  label: string;
  value?: string;
  screen?: ScreenId;
  typeId?: string;
  selected?: boolean;
  count?: number;
}

interface AgentPayload {
  summary?: string;
  details?: string[];
  suggestions?: string[];
  actions?: OperatorAction[];
}

const MODE_COPY: Record<AgentMode, { title: string; description: string }> = {
  advisor: { title: "方案顾问", description: "只分析商品、规划系列图和给出建议，不会修改项目。" },
  operator: { title: "操作助手", description: "把你的要求转换为本地操作计划；只有你确认后才会执行。" },
};

const ADVISOR_SYSTEM = `你是 ListingForge 电商视觉方案顾问。只做分析和规划，不执行任何操作。只输出 JSON：
{"summary":"一句话结论","details":["分析1","分析2"],"suggestions":["建议1","建议2"]}。
回答要结合当前项目和对话历史，简明、具体，不虚构商品参数。`;

const OPERATOR_SYSTEM = `你是 ListingForge 本地项目操作助手。你只生成操作计划，绝不声称已经执行。只输出 JSON：
{"summary":"计划摘要","actions":[{"type":"navigate|set_platform|set_category|set_brief|set_generation_type","label":"用户可理解的动作说明","screen":"projects|materials|generate|results|canvas|tasks|settings|exports","value":"字符串值","typeId":"图片类型ID","selected":true,"count":1}]}。
只允许这些动作：切换页面、设置生成平台、设置类目、填写生成要求、选择图片类型及候选数量。不要输出文件删除、付费提交、API 调用或其他高风险动作。缺少信息时 actions 返回空数组并在 summary 中说明。`;

const REVIEW_SYSTEM = "你是电商图片质检专家。对用户提供的商品图进行评估，只输出 JSON：{\"scores\":{\"主体一致性\":0-100,\"平台适配\":0-100,\"文字可读性\":0-100},\"issues\":[\"问题描述\"],\"summary\":\"一句话评估总结\"}";

const parseJsonObject = (content: string): Record<string, unknown> | null => {
  const normalized = content.trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  try {
    const parsed = JSON.parse(normalized) as unknown;
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    const match = normalized.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      const parsed = JSON.parse(match[0]) as unknown;
      return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
    } catch {
      return null;
    }
  }
};

const parseAgentPayload = (content: string): AgentPayload | null => {
  const parsed = parseJsonObject(content);
  if (!parsed) return null;
  return {
    summary: typeof parsed.summary === "string" ? parsed.summary : undefined,
    details: Array.isArray(parsed.details) ? parsed.details.filter((item): item is string => typeof item === "string") : [],
    suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.filter((item): item is string => typeof item === "string") : [],
    actions: Array.isArray(parsed.actions) ? parsed.actions.filter((item): item is OperatorAction => Boolean(item && typeof item === "object" && typeof (item as OperatorAction).type === "string" && typeof (item as OperatorAction).label === "string")) : [],
  };
};

const extractContent = (response: Record<string, unknown>): string => {
  const choices = response.choices;
  const content = Array.isArray(choices) ? (choices[0] as { message?: { content?: unknown } } | undefined)?.message?.content : undefined;
  return typeof content === "string" ? content : "Agent 未返回可用内容";
};

export function AgentPanel({ mode = "plan", reviewTarget }: { mode?: "plan" | "review"; reviewTarget?: { src: string; localPath: string; title: string } | null }) {
  if (mode === "review") return <ReviewAgent reviewTarget={reviewTarget ?? null} />;
  return <ProjectAgent />;
}

function ProjectAgent() {
  const notify = useAppStore((state) => state.notify);
  const currentProject = useAppStore((state) => state.currentProject);
  const setScreen = useAppStore((state) => state.setScreen);
  const [agentMode, setAgentMode] = useState<AgentMode>("advisor");
  const [conversations, setConversations] = useState<AgentConversationRecord[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AgentMessageRecord[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [running, setRunning] = useState(false);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [lastInput, setLastInput] = useState("");
  const [pendingPlan, setPendingPlan] = useState<{ messageId: string; payload: AgentPayload } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [knownTypes, setKnownTypes] = useState<Array<{ id: string; name: string }>>([]);
  const runningRef = useRef(false);
  const streamContentRef = useRef("");

  const refreshConversations = async (preferredId?: string | null) => {
    if (!hasTauriRuntime() || !currentProject) return;
    const list = await listAgentConversations(agentMode);
    setConversations(list);
    const nextId = preferredId ?? (conversationId && list.some((item) => item.id === conversationId) ? conversationId : list[0]?.id ?? null);
    setConversationId(nextId);
    setMessages(nextId ? await listAgentMessages(nextId) : []);
  };

  useEffect(() => {
    if (!hasTauriRuntime() || !currentProject) {
      const timer = window.setTimeout(() => {
        setConversations([]);
        setConversationId(null);
        setMessages([]);
      }, 0);
      return () => window.clearTimeout(timer);
    }
    let cancelled = false;
    const load = async () => {
      try {
        const [list, customTypes] = await Promise.all([listAgentConversations(agentMode), listCustomGenerationTypes()]);
        if (cancelled) return;
        setKnownTypes([
          { id: "white", name: "白底主图" },
          { id: "scene", name: "场景主图" },
          { id: "poster", name: "卖点海报" },
          { id: "detail", name: "细节长图" },
          ...customTypes.map((item) => ({ id: item.id, name: item.name })),
        ]);
        setConversations(list);
        const nextId = list[0]?.id ?? null;
        setConversationId(nextId);
        setMessages(nextId ? await listAgentMessages(nextId) : []);
        setPendingPlan(null);
      } catch (error) {
        if (!cancelled) notify(error instanceof Error ? error.message : "读取 Agent 对话失败");
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [agentMode, currentProject, notify]);

  const openConversation = async (id: string) => {
    setConversationId(id);
    setMessages(await listAgentMessages(id));
    setHistoryOpen(false);
    setPendingPlan(null);
  };

  const newConversation = () => {
    setConversationId(null);
    setMessages([]);
    setHistoryOpen(false);
    setPendingPlan(null);
    setSteps([]);
  };

  const updateStep = (index: number, patch: Partial<AgentStep>) => setSteps((current) => current.map((step, i) => i === index ? { ...step, ...patch } : step));

  const runAgent = async (input: string) => {
    if (runningRef.current || !input.trim()) return;
    if (!hasTauriRuntime() || !currentProject) {
      notify("请先在桌面应用中打开一个项目");
      return;
    }
    runningRef.current = true;
    setRunning(true);
    setLastInput(input.trim());
    setPendingPlan(null);
    setSteps([
      { label: "读取项目上下文", state: "done", sub: currentProject.name },
      { label: "调用 DeepSeek", state: "active", sub: "正在接收流式响应…" },
      { label: "解析方案", state: "waiting", sub: "等待完整响应" },
      ...(agentMode === "operator" ? [{ label: "等待用户确认", state: "waiting" as StepState, sub: "不会自动执行" }] : []),
    ]);
    try {
      let activeConversationId = conversationId;
      if (!activeConversationId) {
        const created = await createAgentConversation(agentMode, input.trim().slice(0, 24));
        activeConversationId = created.id;
        setConversationId(created.id);
        setConversations((current) => [created, ...current]);
      } else if (messages.length === 0) {
        await renameAgentConversation(activeConversationId, input.trim().slice(0, 24));
      }

      const history = messages.filter((item) => item.status === "complete").slice(-20).map((item) => ({ role: item.role === "agent" ? "assistant" as const : "user" as const, content: item.content }));
      const userMessage = await addAgentMessage(activeConversationId, "user", input.trim());
      const agentMessage = await addAgentMessage(activeConversationId, "agent", "", "streaming");
      setMessages((current) => [...current, userMessage, agentMessage]);

      const requestId = createId();
      setActiveRequestId(requestId);
      streamContentRef.current = "";
      const context = `当前项目：${currentProject.name}。可用图片类型：${knownTypes.map((item) => `${item.id}=${item.name}`).join("，")}。用户要求：${input.trim()}`;
      const system = agentMode === "advisor" ? ADVISOR_SYSTEM : OPERATOR_SYSTEM;
      const streamState: { status: AgentMessageRecord["status"] } = { status: "complete" };
      await streamDeepSeekAgent(system, context, history, requestId, (event) => {
        if (event.event === "delta" && event.delta) {
          streamContentRef.current += event.delta;
          const content = streamContentRef.current;
          setMessages((current) => current.map((item) => item.id === agentMessage.id ? { ...item, content } : item));
        }
        if (event.event === "stopped") streamState.status = "stopped";
      });

      const content = streamContentRef.current;
      const payload = parseAgentPayload(content);
      updateStep(1, { state: streamState.status === "stopped" ? "failed" : "done", sub: streamState.status === "stopped" ? "已停止" : "响应完成" });
      if (streamState.status === "stopped") {
        updateStep(2, { state: "failed", sub: "响应未完成" });
      } else if (!payload) {
        streamState.status = "failed";
        updateStep(2, { state: "failed", sub: "返回内容不是有效 JSON" });
      } else {
        updateStep(2, { state: "done", sub: "方案已解析" });
        if (agentMode === "operator") {
          setPendingPlan({ messageId: agentMessage.id, payload });
          updateStep(3, { state: "active", sub: `${payload.actions?.length ?? 0} 个动作待确认` });
        }
      }
      await updateAgentMessage(agentMessage.id, { content, status: streamState.status, metadata: payload as Record<string, unknown> | null });
      await refreshConversations(activeConversationId);
    } catch (error) {
      const message = typeof error === "string" ? error : error instanceof Error ? error.message : "Agent 调用失败";
      updateStep(1, { state: "failed", sub: message });
      setMessages((current) => [...current, { id: createId(), conversationId: conversationId ?? "", role: "agent", content: `调用失败：${message}`, status: "failed", metadata: null, createdAt: new Date().toISOString() }]);
      notify(message);
    } finally {
      runningRef.current = false;
      setRunning(false);
      setActiveRequestId(null);
    }
  };

  const stop = async () => {
    if (!activeRequestId) return;
    try {
      await cancelDeepSeekAgent(activeRequestId);
      updateStep(1, { state: "active", sub: "正在停止…" });
    } catch (error) {
      notify(error instanceof Error ? error.message : "停止 Agent 失败");
    }
  };

  const executePlan = async () => {
    if (!pendingPlan) return;
    const actions = pendingPlan.payload.actions ?? [];
    const generationActions = actions.filter((action) => action.type !== "navigate");
    if (generationActions.length) window.dispatchEvent(new CustomEvent("listingforge:agent-actions", { detail: { actions: generationActions } }));
    const navigation = [...actions].reverse().find((action) => action.type === "navigate" && action.screen);
    if (navigation?.screen) setScreen(navigation.screen);
    updateStep(3, { state: "done", sub: `已执行 ${actions.length} 个本地动作` });
    setPendingPlan(null);
    if (conversationId) {
      const record = await addAgentMessage(conversationId, "agent", `已按你的确认执行 ${actions.length} 个本地动作。`, "complete", { executedActions: actions });
      setMessages((current) => [...current, record]);
    }
    notify(actions.length ? `已执行 ${actions.length} 个本地操作` : "计划中没有可执行动作");
  };

  const clearConversation = async () => {
    if (!conversationId) return;
    await deleteAgentConversation(conversationId);
    setConfirmClear(false);
    setConversationId(null);
    setMessages([]);
    setPendingPlan(null);
    await refreshConversations(null);
    notify("当前 Agent 对话已清空");
  };

  const renderedMessages = useMemo(() => messages.filter((message) => message.content || message.status === "streaming"), [messages]);

  return <aside className="inspector agent-panel agent-panel--project">
    <div className="inspector__header"><span><Bot size={18} /> AI Agent</span><div><button aria-label="对话历史" className={historyOpen ? "is-active" : ""} onClick={() => setHistoryOpen((value) => !value)}><History size={16} /></button><button aria-label="新建对话" onClick={newConversation}><Plus size={16} /></button></div></div>
    <div className="agent-mode-switch">
      {(Object.keys(MODE_COPY) as AgentMode[]).map((item) => <button key={item} className={agentMode === item ? "is-active" : ""} onClick={() => setAgentMode(item)}><strong>{MODE_COPY[item].title}</strong><span>{item === "advisor" ? "只建议" : "确认后执行"}</span></button>)}
      <p>{MODE_COPY[agentMode].description}</p>
    </div>
    {historyOpen ? <div className="agent-history"><header><strong>本项目对话</strong><button onClick={newConversation}>新对话</button></header>{conversations.length ? conversations.map((conversation) => <button key={conversation.id} className={conversation.id === conversationId ? "is-active" : ""} onClick={() => void openConversation(conversation.id)}><span>{conversation.title}</span><time>{new Date(conversation.updatedAt).toLocaleDateString("zh-CN")}</time></button>) : <p>暂无历史对话</p>}</div> : null}
    {!currentProject ? <div className="agent-blocked"><AlertTriangle size={20} /><strong>请先打开项目</strong><p>Agent 对话和操作记录按项目独立保存。</p></div> : <>
      {steps.length ? <div className="agent-steps">{steps.map((step) => <div className={`agent-step agent-step--${step.state}`} key={step.label}><span className="agent-step__icon">{step.state === "done" ? <Check size={15} /> : step.state === "failed" ? <X size={14} /> : <Circle size={14} />}</span><div><strong>{step.label}</strong><small>{step.sub}</small></div></div>)}</div> : null}
      <div className="agent-chat">
        {renderedMessages.length ? renderedMessages.map((message) => <ChatMessage key={message.id} message={message} />) : <div className="agent-welcome"><Bot size={22} /><strong>{MODE_COPY[agentMode].title}</strong><p>{MODE_COPY[agentMode].description}</p></div>}
      </div>
      {pendingPlan ? <div className="operator-confirm"><header><CheckCircle2 size={16} /><strong>待执行计划</strong></header><p>{pendingPlan.payload.summary ?? "请核对以下本地操作"}</p>{pendingPlan.payload.actions?.length ? <ol>{pendingPlan.payload.actions.map((action, index) => <li key={`${action.type}-${index}`}>{action.label}</li>)}</ol> : <p className="agent-note">没有可执行动作，需要补充信息。</p>}<footer><Button size="sm" onClick={() => { setPendingPlan(null); updateStep(3, { state: "failed", sub: "用户已取消" }); }}>取消</Button><Button size="sm" variant="primary" disabled={!pendingPlan.payload.actions?.length} onClick={() => void executePlan()}>确认并执行</Button></footer></div> : null}
      <AgentComposer running={running} onSend={(text) => void runAgent(text)} onStop={() => void stop()} />
      <div className="agent-footer-actions"><button disabled={!lastInput || running} onClick={() => void runAgent(lastInput)}><RefreshCcw size={13} /> 重试上次</button><button disabled={!conversationId || running} onClick={() => setConfirmClear(true)}><Trash2 size={13} /> 清空对话</button></div>
    </>}
    {confirmClear ? <div className="agent-inline-confirm"><p>确定清空当前对话吗？该操作不可恢复。</p><div><Button size="sm" onClick={() => setConfirmClear(false)}>取消</Button><Button size="sm" variant="danger" onClick={() => void clearConversation()}>确认清空</Button></div></div> : null}
  </aside>;
}

function ChatMessage({ message }: { message: AgentMessageRecord }) {
  const payload = message.role === "agent" ? parseAgentPayload(message.content) : null;
  return <article className={`agent-chat-message agent-chat-message--${message.role} agent-chat-message--${message.status}`}>
    <header><strong>{message.role === "user" ? "你" : "AI Agent"}</strong><time>{new Date(message.createdAt).toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit" })}</time></header>
    {message.status === "streaming" && !message.content ? <p><LoaderCircle className="spin" size={14} /> 正在生成…</p> : payload ? <div><p>{payload.summary ?? "方案已生成"}</p>{payload.details?.length ? <ul>{payload.details.map((item) => <li key={item}>{item}</li>)}</ul> : null}{payload.suggestions?.length ? <ul>{payload.suggestions.map((item) => <li key={item}>{item}</li>)}</ul> : null}</div> : <p>{message.content}</p>}
    {message.status === "failed" ? <small className="agent-error">响应失败，可点击“重试上次”</small> : message.status === "stopped" ? <small>已由用户停止</small> : null}
  </article>;
}

function AgentComposer({ running, onSend, onStop }: { running: boolean; onSend: (text: string) => void; onStop: () => void }) {
  const [text, setText] = useState("");
  const submit = () => { const value = text.trim(); if (!value || running) return; setText(""); onSend(value); };
  return <div className="agent-composer"><textarea className="agent-composer__input" value={text} placeholder="描述你希望 Agent 分析或操作的内容…" disabled={running} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(); } }} />{running ? <button className="agent-composer__send agent-composer__stop" aria-label="停止生成" onClick={onStop}><Square size={15} fill="currentColor" /></button> : <button className="agent-composer__send" aria-label="发送" disabled={!text.trim()} onClick={submit}><Send size={17} /></button>}</div>;
}

function ReviewAgent({ reviewTarget }: { reviewTarget: { src: string; localPath: string; title: string } | null }) {
  const notify = useAppStore((state) => state.notify);
  const openResultInCanvas = useAppStore((state) => state.openResultInCanvas);
  const [running, setRunning] = useState(false);
  const [reviewResult, setReviewResult] = useState<{ scores: Record<string, number>; issues: string[]; summary: string } | null>(null);

  const runReview = async () => {
    if (!reviewTarget || !hasTauriRuntime()) return;
    setRunning(true);
    setReviewResult(null);
    try {
      const { readFile } = await import("@tauri-apps/plugin-fs");
      const bytes = await readFile(reviewTarget.localPath);
      const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("读取本地图片失败")); reader.readAsDataURL(new Blob([bytes])); });
      const content = extractContent(await analyzeProduct(dataUrl, `${REVIEW_SYSTEM} 图片说明：${reviewTarget.title}`));
      const parsed = parseJsonObject(content);
      const rawScores = parsed?.scores && typeof parsed.scores === "object" ? parsed.scores as Record<string, unknown> : {};
      setReviewResult({ scores: Object.fromEntries(Object.entries(rawScores).filter((entry): entry is [string, number] => typeof entry[1] === "number")), issues: Array.isArray(parsed?.issues) ? parsed.issues.filter((item): item is string => typeof item === "string") : [], summary: typeof parsed?.summary === "string" ? parsed.summary : content });
    } catch (error) {
      notify(error instanceof Error ? error.message : "评估失败");
    } finally {
      setRunning(false);
    }
  };

  return <aside className="inspector agent-panel"><div className="inspector__header"><span><Bot size={18} /> AI 视觉质检</span><ChevronDown size={16} /></div><div className="agent-review">{!reviewTarget ? <p className="agent-note">暂无可评估的结果图片。</p> : reviewResult ? <><h3>评估总结 · {reviewTarget.title}</h3>{Object.entries(reviewResult.scores).map(([label, value]) => <div className="score-row" key={label}><span>{label}</span><b>{value}</b><i><em style={{ width: `${value}%` }} /></i></div>)}<div className="review-issue"><div className="review-issue__title"><Sparkles size={16} /> 评估结果</div><p>{reviewResult.summary}</p>{reviewResult.issues.length ? <ul>{reviewResult.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul> : null}</div></> : <p className="agent-note">{running ? "正在调用通义千问评估…" : `将评估「${reviewTarget.title}」的主体一致性、平台适配与文字可读性。`}</p>}<Button variant="primary" className="full-width" disabled={!reviewTarget || running} onClick={() => void runReview()}>{running ? <><LoaderCircle size={15} className="spin" /> 评估中…</> : "开始评估"}</Button><Button className="full-width" disabled={!reviewTarget} onClick={() => { if (reviewTarget) { openResultInCanvas(reviewTarget.src, undefined, reviewTarget.localPath); notify("已打开画布，可手动修复"); } }}>打开画布修复</Button></div></aside>;
}
