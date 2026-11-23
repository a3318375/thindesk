import { Switch, TextArea, Button } from "../../components/ui";
import { useState } from "react";
import s from "./Lab.module.css";

const categories = [
  "逆向校验",
  "脱壳",
  "免杀载荷",
  "流量分析",
  "CTF 复现",
  "样本分析",
];
export function Lab() {
  const [prompt, setPrompt] = useState("");
  return (
    <article className={s.panel}>
      <header>
        <span>JAILBREAK</span> 未连接{" "}
        <Switch
          aria-label="注入状态"
          checked={false}
          disabled
          title="未连接 Agent"
        />
      </header>
      <TextArea
        aria-label="提示词"
        placeholder="说要做什么…"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
      />
      <div className={s.presets}>
        {categories.map((label) => (
          <Button variant="ghost" key={label} onClick={() => setPrompt(label)}>
            {label}
          </Button>
        ))}
      </div>
      <div className={s.actions}>
        <Button variant="ghost" disabled>
          运行
        </Button>
        <Button variant="ghost" disabled>
          提示词
        </Button>
        <Button variant="ghost" disabled>
          停止
        </Button>
      </div>
      <div className={s.output}>还没有回答</div>
      <details>
        <summary>详情 · 提示词 route</summary>
        <p>当前页面未连接 Agent。</p>
      </details>
    </article>
  );
}
