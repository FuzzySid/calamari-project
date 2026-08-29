import type { MinimapData } from "@/lib/minimap";

type CountryMinimapProps = {
  data: MinimapData;
  /** Index of the emphasized point; its marker glides between scenes. */
  activeIndex: number;
  /** Makes the scene dots clickable. */
  onSelect?: (index: number) => void;
  className?: string;
};

export function CountryMinimap({ data, activeIndex, onSelect, className }: CountryMinimapProps) {
  const [activeX, activeY] = data.points[activeIndex] ?? data.points[0];

  return (
    <svg
      viewBox={`0 0 ${data.width} ${data.height}`}
      width={data.width}
      height={data.height}
      className={className}
      aria-hidden
    >
      {data.ringPaths.map((d, i) => (
        <path
          key={i}
          d={d}
          fill="rgba(0,0,0,0.4)"
          stroke="rgba(244,234,213,0.95)"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      ))}

      {data.points.length > 1 && (
        <polyline
          points={data.points.map(([x, y]) => `${x},${y}`).join(" ")}
          fill="none"
          stroke="rgba(212,177,106,0.5)"
          strokeWidth="1"
          strokeDasharray="3 3"
        />
      )}

      {data.points.map(([x, y], i) => (
        <g
          key={i}
          onClick={onSelect ? () => onSelect(i) : undefined}
          style={onSelect ? { cursor: "pointer", pointerEvents: "auto" } : undefined}
          role={onSelect ? "button" : undefined}
          aria-label={onSelect ? `Go to scene ${i + 1}` : undefined}
        >
          {/* Invisible, larger hit area so small dots are easy to tap. */}
          {onSelect && <circle cx={x} cy={y} r="9" fill="transparent" />}
          <circle cx={x} cy={y} r="2.5" fill="rgba(212,177,106,0.4)" />
        </g>
      ))}

      <g
        style={{
          transform: `translate(${activeX}px, ${activeY}px)`,
          transition: "transform 700ms cubic-bezier(0.4, 0, 0.2, 1)"
        }}
      >
        <circle r="6.5" fill="rgba(212,177,106,0.25)" />
        <circle r="3.5" fill="#d4b16a" stroke="rgba(244,234,213,0.9)" strokeWidth="1" />
      </g>
    </svg>
  );
}
