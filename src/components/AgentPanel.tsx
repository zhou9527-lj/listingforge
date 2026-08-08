import { Bot, Check, ChevronDown, Circle, Send, Sparkles } from "lucide-react";
import { Button } from "./ui";

export function AgentPanel({ mode = "plan" }: { mode?: "plan" | "review" }) {
  if (mode === "review") {
    return (
      <aside className="inspector agent-panel">
        <div className="inspector__header"><span><Bot size={18} /> AI 视觉 Agent</span><ChevronDown size={16} /></div>
        <div className="agent-review">
          <h3>评估总结</h3>
          {[["主体一致性", 92], ["平台适配", 96], ["文字可读性", 84]].map(([label, value]) => (
            <div className="score-row" key={String(label)}>
              <span>{label}</span><b>{value}</b><i><em style={{ width: `${value}%` }} /></i>
            </div>
          ))}
          <div className="review-issue">
            <div className="review-issue__title"><Sparkles size={16} /> 问题检测</div>
            <p>发现 1 张图片文字存在可读性问题，建议复核并优化文案排版。</p>
            <div className="review-issue__preview"><img src="/assets/demo/product-poster.png" alt="需要文字复核的卖点海报" /><span><strong>卖点海报 3:4</strong>文字可读性 · 较低</span></div>
          </div>
          <p className="agent-note">可一键修复文字排版，或统一整体色调提升视觉一致性。</p>
          <Button variant="primary" className="full-width">修复文字</Button>
          <Button className="full-width">统一色调</Button>
          <Button className="full-width">换一批场景</Button>
        </div>
        <AgentComposer />
      </aside>
    );
  }

  const steps = [
    { label: "理解商品", state: "done", sub: "已完成" },
    { label: "提炼卖点", state: "done", sub: "已完成" },
    { label: "生成提示词", state: "active", sub: "进行中…" },
    { label: "批量出图", state: "waiting", sub: "等待中" },
  ];

  return (
    <aside className="inspector agent-panel">
      <div className="inspector__header"><span><Bot size={18} /> AI 视觉 Agent</span><ChevronDown size={16} /></div>
      <div className="agent-steps">
        {steps.map((step) => (
          <div className={`agent-step agent-step--${step.state}`} key={step.label}>
            <span className="agent-step__icon">{step.state === "done" ? <Check size={15} /> : <Circle size={14} />}</span>
            <div><strong>{step.label}</strong><small>{step.sub}</small></div>
            <ChevronDown size={15} />
          </div>
        ))}
      </div>
      <div className="agent-message">
        <div className="agent-avatar"><Bot size={16} /></div>
        <div>
          <header>AI 视觉 Agent <time>10:24</time></header>
          <p>已为您生成各图片类型的提示词，侧重突出便携、无线、强劲动力与易清洗等卖点，适配淘宝主图规范与平台风格。</p>
          <button>查看提示词详情</button>
        </div>
      </div>
      <AgentComposer />
    </aside>
  );
}

function AgentComposer() {
  return (
    <div className="agent-composer">
      <div className="agent-composer__input">告诉 Agent 你想调整什么… <Send size={17} /></div>
      <div className="agent-composer__quick"><button>加强卖点表现</button><button>更换场景风格</button><button>调整色调</button></div>
    </div>
  );
}
