import type { ReactNode } from "react";
import { paper } from "../../components/assistant-ui/elements/surfaces";
import { Icon } from "../../components/Icon";
import { compact, elapsed, sum } from "../usage";
import s from "./Insights.module.css";

const colors = [
  "#615fff",
  "#fe9a00",
  "#00c951",
  "#ad46ff",
  "#ff6900",
  "#00bba7",
  "#8e51ff",
  "#f6339a",
];
export function Card({
  title,
  icon,
  extra,
  children,
}: {
  title: string;
  icon: string;
  extra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={paper + " " + s.card}>
      <header>
        <strong>
          <Icon name={icon} size={14} />
          {title}
        </strong>
        {extra}
      </header>
      {children}
    </div>
  );
}
export function Ring({
  values,
  palette = colors,
  value,
  label,
}: {
  values: number[];
  palette?: string[];
  value: string;
  label: string;
}) {
  const total = sum(values);
  let position = 0;
  const slices = values.map((n, i) => {
    const share = total ? (100 * n) / total : 0;
    const offset = position;
    position += share;
    if (!share) return null;
    const painted = Math.max(share * 0.45, share - 0.45);
    return (
      <circle
        key={i}
        cx="21"
        cy="21"
        r="15.9155"
        pathLength="100"
        fill="none"
        strokeWidth="4"
        stroke={palette[i]}
        strokeDasharray={painted + " " + (100 - painted)}
        strokeDashoffset={-offset}
      />
    );
  });
  return (
    <div className={s.ring}>
      <svg viewBox="0 0 42 42" aria-hidden="true">
        <g transform="rotate(-90 21 21)">
          {total ? (
            slices
          ) : (
            <circle
              cx="21"
              cy="21"
              r="15.9155"
              fill="none"
              stroke="var(--line)"
              strokeWidth="4"
            />
          )}
        </g>
      </svg>
      <div>
        <b>{value}</b>
        <small>{label}</small>
      </div>
    </div>
  );
}
export function Distribution({
  title,
  labels,
  values,
  timed = false,
  note,
}: {
  title: string;
  labels: string[];
  values: number[];
  timed?: boolean;
  note?: string;
}) {
  const total = sum(values);
  const format = timed
    ? (value: number) => elapsed(Math.round(value))
    : compact;
  return (
    <Card title={title} icon={timed ? "clock" : "database"}>
      <div className={s.distribution}>
        <Ring
          values={values}
          value={total ? format(total) : "—"}
          label={timed ? "已记录时长" : "总用量"}
        />
        <div className={s.legend}>
          {labels.map((label, index) => (
            <div key={label}>
              <i style={{ background: colors[index % colors.length] }} />
              <span>{label}</span>
              <b>
                {total ? ((values[index] / total) * 100).toFixed(1) + "%" : "—"}
              </b>
              <small>{format(values[index])}</small>
            </div>
          ))}
        </div>
      </div>
      {note && <p className={s.note}>{note}</p>}
    </Card>
  );
}
export function Ranking({
  title,
  icon,
  counts,
  unit,
}: {
  title: string;
  icon: string;
  counts: Record<string, number>;
  unit: string;
}) {
  const list = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const total = sum(Object.values(counts));
  return (
    <Card
      title={title}
      icon={icon}
      extra={
        <small>
          {list.length} 个{unit} · {total} 次
        </small>
      }
    >
      {list.length ? (
        <dl className={s.counts}>
          {list.map(([label, count], i) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>×{count}</dd>
              <i
                style={{
                  width: (100 * count) / list[0][1] + "%",
                  background: colors[i % colors.length],
                }}
              />
            </div>
          ))}
        </dl>
      ) : (
        <p className={s.empty}>统计范围内暂无{title}</p>
      )}
    </Card>
  );
}
