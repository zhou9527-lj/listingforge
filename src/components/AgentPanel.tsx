import { useRef, useState } from "react";
import { Bot, Check, ChevronDown, Circle, LoaderCircle, Send, Sparkles, X } from "lucide-react";
import { Button } from "./ui";
import { analyzeProduct, hasTauriRuntime, runDeepSeekAgent } from "../lib/desktop";
import { useAppStore } from "../store/appStore";

type StepState = "done" | "active" | "waiting" | "failed";

interface AgentMessage {
  role: "user" | "agent";
  content: string;
  time: string;
}

const nowTime = () => new Date().toLocaleTimeString("zh-CN", { hour12: false });

const extractContent = (response: Record<string, unknown>): string => {
  const choices = response.choices;
  const content = Array.isArray(choices)
    ? (choices[0] as { message?: { content?: unknown } } | undefined)?.message?.content
    : undefined;
  return typeof content === "string" ? content : "Agent 未返回可用内容";
};

const parsePlanJson = (content: string): Record<string, unknown> | null => {
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as unknown;
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
};

const PLAN_SYSTEM = "你是电商商品图生成方案助手。只输出 JSON，不要输出其他内容。格式：{\"summary\":\"一句话方案摘要\",\"points\":[\"卖点1\",\"卖点2\"],\"types\":[{\"type\":\"白底主图|场景主图|卖点海报|细节长图\",\"prompt\":\"针对该类型的完整中文提示词，包含主体、场景、光影、构图要求\"}]}";

const REVIEW_SYSTEM = "你是电商图片质检专家。对用户提供的商品图进行评估，只输出 JSON：{\"scores\":{\"主体一致性\":0-100,\"平台适配\":0-100,\"文字可读性\":0-100},\"issues\":[\"问题描述\"],\"summary\":\"一句话评估总结\"}";

export function AgentPanel({ mode = "plan", reviewTarget }: { mode?: "plan" | "review"; reviewTarget?: { src: string; localPath: string; title: string } | null }) {
  const notify = useAppStore((state) => state.notify);
  const openResultInCanvas = useAppStore((state) => state.openResultInCanvas);
  const [steps, setSteps] = useState<Array<{ label: string; state: StepState; sub: string }>>(
    mode === "plan"
      ? [
          { label: "理解商品", state: "waiting", sub: "等待输入" },
          { label: "提炼卖点", state: "waiting", sub: "等待输入" },
          { label: "生成提示词", state: "waiting", sub: "等待输入" },
          { label: "批量出图", state: "waiting", sub: "提交任务后完成" },
        ]
      : [],
  );
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [planDetail, setPlanDetail] = useState<string | null>(null);
  const [reviewResult, setReviewResult] = useState<{ scores: Record<string, number>; issues: string[]; summary: string } | null>(null);
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);

  const updateStep = (index: number, patch: Partial<{ state: StepState; sub: string }>) => {
    setSteps((current) => current.map((step, i) => i === index ? { ...step, ...patch } : step));
  };

  const runSteps = async (total: number) => {
    for (let i = 0; i < total; i += 1) {
      updateStep(i, { state: "done", sub: "已完成" });
    }
  };

  const runPlanAgent = async (userText: string) => {
    if (runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    setMessages((current) => [...current, { role: "user", content: userText, time: nowTime() }]);
    try {
      updateStep(0, { state: "active", sub: "进行中…" });
      await new Promise((resolve) => window.setTimeout(resolve, 600));
      updateStep(0, { state: "done", sub: "已完成" });
      updateStep(1, { state: "active", sub: "进行中…" });
      const response = await runDeepSeekAgent(PLAN_SYSTEM, userText);
      const content = extractContent(response);
      await runSteps(2);
      updateStep(1, { state: "done", sub: "已完成" });
      updateStep(2, { state: "done", sub: "已完成" });
      const plan = parsePlanJson(content);
      const summary = plan && typeof plan.summary === "string" ? plan.summary : "提示词方案已生成";
      setMessages((current) => [...current, { role: "agent", content: summary, time: nowTime() }]);
      setPlanDetail(content);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Agent 调用失败";
      updateStep(1, { state: "failed", sub: "调用失败" });
      setMessages((current) => [...current, { role: "agent", content: `⚠ ${message}`, time: nowTime() }]);
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  };

  const runReviewAgent = async (target: { src: string; localPath: string; title: string }) => {
    if (runningRef.current) return;
    if (!hasTauriRuntime()) {
      notify("结果评估仅桌面版可用");
      return;
    }
    runningRef.current = true;
    setRunning(true);
    setReviewResult(null);
    notify(`正在评估「${target.title}」…`);
    try {
      const { readFile } = await import("@tauri-apps/plugin-fs");
      const bytes = await readFile(target.localPath);
      const blob = new Blob([bytes]);
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("读取本地图片失败"));
        reader.readAsDataURL(blob);
      });
      const response = await analyzeProduct(dataUrl, `${REVIEW_SYSTEM} 图片说明：${target.title}`);
      const content = extractContent(response);
      const parsed = parsePlanJson(content);
      if (parsed && typeof parsed.scores === "object" && parsed.scores !== null) {
        const scores = Object.fromEntries(Object.entries(parsed.scores).filter(([, value]) => typeof value === "number")) as Record<string, number>;
        setReviewResult({
          scores,
          issues: Array.isArray(parsed.issues) ? parsed.issues.filter((item): item is string => typeof item === "string") : [],
          summary: typeof parsed.summary === "string" ? parsed.summary : "评估完成",
        });
      } else {
        setReviewResult({ scores: {}, issues: [], summary: content });
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : "评估失败");
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  };

  if (mode === "review") {
    return (
      <aside className="inspector agent-panel">
        <div className="inspector__header"><span><Bot size={18} /> AI 视觉 Agent</span><ChevronDown size={16} /></div>
        <div className="agent-review">
          {!reviewTarget ? (
            <p className="agent-note">暂无可评估的结果图片，请先完成一次生成并下载结果。</p>
          ) : reviewResult ? (
            <>
              <h3>评估总结 · {reviewTarget.title}</h3>
              {Object.entries(reviewResult.scores).length > 0 ? (
                Object.entries(reviewResult.scores).map(([label, value]) => (
                  <div className="score-row" key={label}>
                    <span>{label}</span><b>{value}</b><i><em style={{ width: `${value}%` }} /></i>
                  </div>
                ))
              ) : null}
              <div className="review-issue">
                <div className="review-issue__title"><Sparkles size={16} /> 评估结果</div>
                <p>{reviewResult.summary}</p>
                {reviewResult.issues.length > 0 ? (
                  <ul>{reviewResult.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
                ) : <p className="agent-note">未检测到明显问题。</p>}
              </div>
            </>
          ) : (
            <p className="agent-note">{running ? "正在调用通义千问评估…" : `将评估「${reviewTarget.title}」的主体一致性、平台适配与文字可读性。`}</p>
          )}
          <Button variant="primary" className="full-width" disabled={!reviewTarget || running} onClick={() => void runReviewAgent(reviewTarget!)}>
            {running ? <> <LoaderCircle size={15} className="spin" /> 评估中…</> : "开始评估"}
          </Button>
          <Button className="full-width" disabled={!reviewTarget} onClick={() => { if (reviewTarget) { openResultInCanvas(reviewTarget.src, undefined, reviewTarget.localPath); notify("已打开画布，可手动修复"); } }}>打开画布修复</Button>
        </div>
      </aside>
    );
  }

  const lastAgentMessage = [...messages].reverse().find((message) => message.role === "agent");

  return (
    <aside className="inspector agent-panel">
      <div className="inspector__header"><span><Bot size={18} /> AI 视觉 Agent</span><ChevronDown size={16} /></div>
      <div className="agent-steps">
        {steps.map((step) => (
          <div className={`agent-step agent-step--${step.state}`} key={step.label}>
            <span className="agent-step__icon">{step.state === "done" ? <Check size={15} /> : step.state === "failed" ? <X size={14} /> : <Circle size={14} />}</span>
            <div><strong>{step.label}</strong><small>{step.sub}</small></div>
            <ChevronDown size={15} />
          </div>
        ))}
      </div>
      {lastAgentMessage ? (
        <div className="agent-message">
          <div className="agent-avatar"><Bot size={16} /></div>
          <div>
            <header>AI 视觉 Agent <time>{lastAgentMessage.time}</time></header>
            <p>{lastAgentMessage.content}</p>
            {planDetail ? <pre className="agent-plan-detail">{planDetail}</pre> : null}
          </div>
        </div>
      ) : (
        <div className="agent-message agent-message--placeholder">
          <div className="agent-avatar"><Bot size={16} /></div>
          <div>
            <header>AI 视觉 Agent <time>{nowTime()}</time></header>
            <p>描述你的商品或要求，Agent 会生成分类型提示词方案；随后在下方「确认并生成」提交任务。</p>
          </div>
        </div>
      )}
      <AgentComposer disabled={running} onSend={(text) => void runPlanAgent(text)} />
    </aside>
  );
}

function AgentComposer({ disabled, onSend }: { disabled: boolean; onSend: (text: string) => void }) {
  const [text, setText] = useState("");
  const submit = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    setText("");
    onSend(trimmed);
  };
  return (
    <div className="agent-composer">
      <textarea
        className="agent-composer__input"
        value={text}
        placeholder="告诉 Agent 你想调整什么…"
        disabled={disabled}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(text); } }}
      />
      <button className="agent-composer__send" aria-label="发送" disabled={disabled || !text.trim()} onClick={() => submit(text)}>{disabled ? <LoaderCircle size={17} className="spin" /> : <Send size={17} />}</button>
      <div className="agent-composer__quick">
        <button disabled={disabled} onClick={() => submit("加强卖点表现，突出便携、动力与易清洗")}>加强卖点表现</button>
        <button disabled={disabled} onClick={() => submit("更换场景风格为清新自然风格")}>更换场景风格</button>
        <button disabled={disabled} onClick={() => submit("整体色调调整为明亮清爽")}>调整色调</button>
      </div>
    </div>
  );
}
