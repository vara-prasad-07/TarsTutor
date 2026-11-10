import { memo, useRef, useState } from "react";

import type { LessonColor, LessonElement } from "../../shared/classroom";

import { revealProgress, wrapBoardText } from "./classroomMedia";

export const BOARD_COLORS: Record<LessonColor, string> = {
  ink: "#303b43",
  green: "#148667",
  blue: "#3384d6",
  coral: "#da786a",
  purple: "#8464b6",
};

export type InkStroke = { points: [number, number][] };

const BoardText = ({
  text,
  x = 0,
  y = 0,
  width,
  size = 23,
  height = 200,
}: {
  text: string;
  x?: number;
  y?: number;
  width: number;
  size?: number;
  height?: number;
}) => {
  let fontSize = size;
  let lines = wrapBoardText(
    text,
    Math.max(8, Math.floor(width / (fontSize * 0.53))),
  );
  while (lines.length * fontSize * 1.36 > height && fontSize > 13) {
    fontSize -= 1;
    lines = wrapBoardText(
      text,
      Math.max(8, Math.floor(width / (fontSize * 0.53))),
    );
  }
  return (
    <text x={x} y={y + fontSize} fontSize={fontSize}>
      {lines.map((line, i) => (
        <tspan key={i} x={x} dy={i ? fontSize * 1.36 : 0}>
          {line}
        </tspan>
      ))}
    </text>
  );
};

const HighlightedCode = ({ text }: { text: string }) => (
  <>
    {text
      .split(
        /("[^"\n]*"|'[^'\n]*'|#[^\n]*|\/\/[^\n]*|\b(?:def|class|for|while|in|if|else|elif|return|import|from|as|print|const|let|var|function|true|false|None|True|False|range|break|continue|int|float|str)\b|\b\d+(?:\.\d+)?\b)/g,
      )
      .map((token, i) => {
        const color = /^(#|\/\/)/.test(token)
          ? "#84928a"
          : /^["']/.test(token)
          ? "#19886a"
          : /^\d/.test(token)
          ? "#c57449"
          : /^(def|class|for|while|in|if|else|elif|return|import|from|as|print|const|let|var|function|true|false|None|True|False|range|break|continue|int|float|str)$/.test(
              token,
            )
          ? "#8663b3"
          : "#263e55";
        return (
          <tspan key={i} fill={color}>
            {token}
          </tspan>
        );
      })}
  </>
);

const Graph = ({
  element: e,
  amount,
}: {
  element: LessonElement;
  amount: number;
}) => {
  const left = 52;
  const top = 22;
  const width = Math.max(50, e.width - 76);
  const height = Math.max(40, e.height - 92);
  const x = (value: number) =>
    left + ((value - e.x_min) / (e.x_max - e.x_min)) * width;
  const y = (value: number) =>
    top + height - ((value - e.y_min) / (e.y_max - e.y_min)) * height;
  const id = `plot-${e.id}`;
  const tick = (value: number) => Number(value.toPrecision(3)).toString();
  return (
    <g fontFamily="TarsHand, cursive" fontSize="14">
      <defs>
        <clipPath id={id}>
          <rect
            x={left - 5}
            y={top - 5}
            width={width + 10}
            height={height + 10}
          />
        </clipPath>
      </defs>
      {[0, 1, 2, 3, 4].map((n) => (
        <g key={n}>
          <path
            d={`M ${left} ${top + (n * height) / 4} H ${left + width}`}
            stroke="#dfdfd4"
            strokeDasharray="3 6"
            fill="none"
            strokeWidth="1"
          />
          <text
            x={left - 12}
            y={top + height - (n * height) / 4 + 5}
            textAnchor="end"
            fill="#83877f"
          >
            {tick(e.y_min + ((e.y_max - e.y_min) * n) / 4)}
          </text>
          <text
            x={left + (n * width) / 4}
            y={top + height + 24}
            textAnchor="middle"
            fill="#83877f"
          >
            {tick(e.x_min + ((e.x_max - e.x_min) * n) / 4)}
          </text>
        </g>
      ))}
      <path
        d={`M ${left} ${top - 4} V ${top + height} H ${left + width + 5}`}
        stroke="#6c7772"
        strokeWidth="2"
        fill="none"
        pathLength={1}
        strokeDasharray={1}
        strokeDashoffset={1 - Math.min(1, amount * 4)}
      />
      <text
        x={left + width / 2}
        y={top + height + 54}
        textAnchor="middle"
        fontSize="16"
      >
        {e.x_label}
      </text>
      <text
        transform={`translate(12 ${top + height / 2}) rotate(-90)`}
        textAnchor="middle"
        fontSize="16"
      >
        {e.y_label}
      </text>
      <g clipPath={`url(#${id})`}>
        {e.series.map((series, si) => {
          const shown = Math.max(
            0,
            Math.min(1, (amount - 0.18 - si * 0.08) / 0.6),
          );
          return series.kind === "line" ? (
            <polyline
              key={si}
              points={series.points.map((p) => `${x(p.x)},${y(p.y)}`).join(" ")}
              fill="none"
              stroke={BOARD_COLORS[series.color]}
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              pathLength={1}
              strokeDasharray={1}
              strokeDashoffset={1 - shown}
            />
          ) : (
            <g key={si}>
              {series.points
                .slice(0, Math.ceil(series.points.length * shown))
                .map((p, pi) => (
                  <circle
                    key={pi}
                    cx={x(p.x)}
                    cy={y(p.y)}
                    r="4.5"
                    fill={BOARD_COLORS[series.color]}
                  />
                ))}
            </g>
          );
        })}
      </g>
      {e.series.length < 4 &&
        e.series.map((series, i) => (
          <g
            key={i}
            transform={`translate(${
              left + 8 + i * Math.min(130, width / e.series.length)
            },${top + 12})`}
            opacity={amount > 0.3 ? 1 : 0}
          >
            <circle r="3" fill={BOARD_COLORS[series.color]} />
            <text x="9" y="5" fontSize="12" fill={BOARD_COLORS[series.color]}>
              {series.label.slice(0, 24)}
            </text>
          </g>
        ))}
    </g>
  );
};

const Visual = ({
  element: e,
  amount,
}: {
  element: LessonElement;
  amount: number;
}) => {
  const color = BOARD_COLORS[e.color] || BOARD_COLORS.ink;
  const clipId = `reveal-${e.id}`;
  if (e.type === "arrow") {
    return (
      <g fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round">
        <defs>
          <marker
            id={`arrow-${e.id}`}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 1 1 L 9 5 L 1 9" />
          </marker>
        </defs>
        <path
          d={`M ${e.x} ${e.y} L ${e.x2} ${e.y2}`}
          markerEnd={amount > 0.95 ? `url(#arrow-${e.id})` : undefined}
          pathLength={1}
          strokeDasharray={1}
          strokeDashoffset={1 - amount}
        />
        {e.text && (
          <g fill={color} stroke="none" opacity={amount}>
            <BoardText
              text={e.text}
              x={Math.min(e.x, e.x2)}
              y={Math.min(e.y, e.y2) - 32}
              width={e.width}
              size={18}
            />
          </g>
        )}
      </g>
    );
  }
  return (
    <g transform={`translate(${e.x},${e.y})`} fill={color}>
      <defs>
        <clipPath id={clipId}>
          <rect
            x="-4"
            y="-8"
            width={e.width + 12}
            height={(e.height + 38) * amount}
          />
        </clipPath>
      </defs>
      {e.type === "graph" ? (
        <Graph element={e} amount={amount} />
      ) : e.type === "shape" ? (
        <g>
          <g
            stroke={color}
            strokeWidth="2.5"
            fill={amount >= 1 ? `${color}08` : "none"}
            pathLength={1}
            strokeDasharray={1}
            strokeDashoffset={1 - amount}
          >
            {e.shape === "ellipse" ? (
              <ellipse
                cx={e.width / 2}
                cy={e.height / 2}
                rx={e.width / 2 - 3}
                ry={e.height / 2 - 3}
                pathLength={1}
              />
            ) : e.shape === "triangle" ? (
              <path
                d={`M 3 ${e.height - 3} L ${e.width / 2} 3 L ${e.width - 3} ${
                  e.height - 3
                } Z`}
                pathLength={1}
              />
            ) : (
              <rect
                x="3"
                y="3"
                width={e.width - 6}
                height={e.height - 6}
                rx="8"
                pathLength={1}
              />
            )}
          </g>
          {e.text && (
            <g opacity={Math.max(0, (amount - 0.5) * 2)}>
              <BoardText
                text={e.text}
                x={18}
                y={e.height / 2 - 20}
                width={e.width - 36}
                height={e.height - 20}
                size={22}
              />
            </g>
          )}
        </g>
      ) : (
        <g clipPath={`url(#${clipId})`}>
          {e.type === "code" ? (
            <g fontFamily="TarsCode, monospace">
              <rect
                x="-12"
                y="-7"
                width={e.width + 20}
                height={e.height + 12}
                rx="12"
                fill="#eef1ed"
              />
              <text
                x={e.width - 12}
                y="15"
                fontFamily="Inter, sans-serif"
                fontSize="10"
                textAnchor="end"
                fill="#89928b"
              >
                {e.language.toUpperCase()}
              </text>
              {e.text.split("\n").map((line, i) => {
                const size = Math.min(
                  17,
                  Math.max(
                    10,
                    e.width /
                      Math.max(25, ...e.text.split("\n").map((l) => l.length)) /
                      0.63,
                  ),
                  (e.height - 15) /
                    Math.max(1, e.text.split("\n").length) /
                    1.6,
                );
                return (
                  <text
                    key={i}
                    x="10"
                    y={32 + i * size * 1.6}
                    fontSize={size}
                    xmlSpace="preserve"
                  >
                    <HighlightedCode text={line} />
                  </text>
                );
              })}
            </g>
          ) : e.type === "table" ? (
            <g>
              {[e.columns, ...e.rows].map((row, ri) => {
                const count = Math.max(
                  e.columns.length,
                  ...e.rows.map((r) => r.length),
                  1,
                );
                const rowHeight = Math.min(55, e.height / (e.rows.length + 1));
                return (
                  <g key={ri} transform={`translate(0 ${ri * rowHeight})`}>
                    <rect
                      width={e.width}
                      height={rowHeight}
                      fill={ri === 0 ? "#e8eee3" : "transparent"}
                      rx={ri === 0 ? 6 : 0}
                    />
                    <path
                      d={`M 0 ${rowHeight} H ${e.width}`}
                      stroke="#d5dbd0"
                      strokeWidth="1"
                    />
                    {row.map((cell, ci) => (
                      <g key={ci}>
                        <BoardText
                          text={cell}
                          x={(ci * e.width) / count + 10}
                          y={5}
                          width={e.width / count - 18}
                          height={rowHeight - 8}
                          size={ri ? 18 : 17}
                        />
                      </g>
                    ))}
                  </g>
                );
              })}
            </g>
          ) : (
            <BoardText
              text={e.text}
              width={e.width}
              height={e.height}
              size={e.type === "equation" ? 31 : 23}
            />
          )}
        </g>
      )}
      {e.caption && amount > 0.8 && (
        <g opacity={(amount - 0.8) * 5} fill="#81887a">
          <BoardText
            text={e.caption}
            y={e.height + 8}
            width={e.width}
            height={52}
            size={15}
          />
        </g>
      )}
    </g>
  );
};

export const WhiteboardView = memo(function WhiteboardView({
  title,
  objective,
  elements,
  progress,
  drawing = false,
  strokes = [],
  onStrokes,
  svgRef,
}: {
  title: string;
  objective: string;
  elements: LessonElement[];
  progress: number;
  drawing?: boolean;
  strokes?: InkStroke[];
  onStrokes?: (strokes: InkStroke[]) => void;
  svgRef?: React.RefObject<SVGSVGElement | null>;
}) {
  const localRef = useRef<SVGSVGElement>(null);
  const ref = svgRef || localRef;
  const [draft, setDraft] = useState<[number, number][]>([]);
  const active = useRef(false);
  const point = (
    event: React.PointerEvent<SVGSVGElement>,
  ): [number, number] => {
    const node = event.currentTarget;
    const p = node.createSVGPoint();
    p.x = event.clientX;
    p.y = event.clientY;
    const result = p.matrixTransform(node.getScreenCTM()?.inverse());
    return [result.x, result.y];
  };
  return (
    <svg
      ref={ref}
      className={`tc-board${drawing ? " tc-board--drawing" : ""}`}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 1000 700"
      role="img"
      aria-label={`${title}. Interactive lesson whiteboard`}
      onPointerDown={(event) => {
        if (!drawing) {
          return;
        }
        active.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        setDraft([point(event)]);
      }}
      onPointerMove={(event) => {
        if (active.current && drawing) {
          const p = point(event);
          setDraft((old) => [...old, p]);
        }
      }}
      onPointerUp={(event) => {
        if (active.current) {
          onStrokes?.([...strokes, { points: [...draft, point(event)] }]);
          setDraft([]);
          active.current = false;
        }
      }}
      onPointerCancel={() => {
        active.current = false;
        setDraft([]);
      }}
    >
      <title>{title}</title>
      <defs>
        <pattern
          id="board-dots"
          width="32"
          height="32"
          patternUnits="userSpaceOnUse"
        >
          <circle cx="16" cy="16" r="1.35" fill="#dedfd3" opacity="0.55" />
        </pattern>
      </defs>
      <rect width="1000" height="700" fill="#fcfbf7" />
      <rect width="1000" height="700" fill="url(#board-dots)" />
      <g fontFamily="TarsHand, cursive" fill="#148667">
        <BoardText
          text={title}
          x={58}
          y={32}
          width={880}
          height={70}
          size={35}
        />
      </g>
      <g fontFamily="TarsHand, cursive" fill="#838878">
        <BoardText
          text={objective}
          x={60}
          y={96}
          width={875}
          height={46}
          size={16}
        />
      </g>
      <g fontFamily="TarsHand, cursive">
        {elements.map((element, index) => {
          const amount =
            progress >= 0.999
              ? 1
              : revealProgress(
                  progress,
                  element.reveal_at,
                  elements[index + 1]?.reveal_at || 1,
                );
          return amount > 0 ? (
            <Visual
              key={element.id || index}
              element={element}
              amount={amount}
            />
          ) : null;
        })}
      </g>
      {[...strokes, ...(draft.length ? [{ points: draft }] : [])].map(
        (stroke, index) => (
          <polyline
            key={index}
            points={stroke.points.map((p) => p.join(",")).join(" ")}
            fill="none"
            stroke="#d87357"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ),
      )}
    </svg>
  );
});
