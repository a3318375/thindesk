// Adapted from assistant-ui Elements Question Flow for native CLI text and secret answers.
import { useId, useState } from "react";
import { Check } from "lucide-react";
import { Input, TextArea } from "../../ui";
import { cn } from "../utils";
import { ghostButton, inkButton, mono, paper } from "./surfaces";
import type { AgentQuestion } from "../../../../../shared/interactions";

export function QuestionFlow({ questions, detail, onComplete, onCancel }: {
  questions: AgentQuestion[];
  detail?: string;
  onComplete: (answers: Record<string, string>) => void;
  onCancel: () => void;
}) {
  const labelId = useId();
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [customStep, setCustomStep] = useState<string>();
  const question = questions[index];
  if (!question) return null;
  const value = answers[question.id] ?? question.prefill ?? "";
  const options = question.options || [];
  const custom = !options.length || customStep === question.id ||
    (!!value && !options.some(option => option.label === value));
  const change = (value: string) => setAnswers(previous => ({ ...previous, [question.id]: value }));
  function next() {
    const result = { ...answers, [question.id]: value };
    if (index === questions.length - 1) onComplete(result);
    else { setAnswers(result); setIndex(index + 1); }
  }
  return <div data-slot="question-flow" className={cn(paper, "flex w-full max-w-sm flex-col gap-3 rounded-2xl border-solid p-2")}>
    <div className="flex items-center justify-between gap-2 px-2 pt-1">
      <span className={cn(mono, "text-muted-foreground")}>{index + 1} / {questions.length}</span>
      {index > 0 && <button type="button" className={cn(ghostButton, "px-2 text-xs")} onClick={() => setIndex(index - 1)}>上一题</button>}
    </div>
    <div role="progressbar" aria-label="提问进度" aria-valuemin={0} aria-valuemax={questions.length} aria-valuenow={index + 1}
      className="mx-2 h-[3px] overflow-hidden rounded-full bg-foreground/[0.08]">
      <div className="h-full rounded-full bg-foreground/80 transition-[width] motion-reduce:transition-none" style={{ width: (index + 1) / questions.length * 100 + "%" }} />
    </div>
    <div className="px-2">
      <p id={labelId} className="text-[13.5px] font-medium">{question.question}</p>
      {detail && <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">{detail}</p>}
    </div>
    <div role="group" aria-labelledby={labelId} className="flex flex-col gap-0.5">
      {options.map(option => <button type="button" key={option.label} aria-pressed={!custom && value === option.label}
        className="flex min-h-9 items-center justify-between gap-2 rounded-xl px-2 py-1.5 text-left text-[13.5px] hover:bg-foreground/[0.04] aria-pressed:bg-foreground/[0.06]"
        onClick={() => { setCustomStep(undefined); change(option.label); }}>
        <span>{option.label}{option.description && <small className="block text-xs text-muted-foreground">{option.description}</small>}</span>
        {!custom && value === option.label && <Check size={14} aria-hidden />}
      </button>)}
      {question.allowCustom !== false && (custom
        ? question.secret
          ? <Input aria-label="补充回答" type="password" value={value} onChange={e => change(e.target.value)} />
          : <TextArea aria-label="补充回答" placeholder="输入你的回答…" value={value} onChange={e => change(e.target.value)} />
        : <button type="button" className="min-h-9 rounded-xl px-2 text-left text-xs text-muted-foreground"
            onClick={() => { setCustomStep(question.id); change(""); }}>其他回答…</button>)}
    </div>
    <footer className="flex items-center justify-between gap-2">
      <button type="button" className={cn(ghostButton, "h-7 px-2 text-xs")} onClick={onCancel}>取消提问</button>
      <button type="button" className={cn(inkButton, "h-7 rounded-full px-3 text-xs disabled:opacity-40")}
        disabled={!value.trim()} onClick={next}>{index === questions.length - 1 ? "提交回答" : "下一题"}</button>
    </footer>
  </div>;
}
