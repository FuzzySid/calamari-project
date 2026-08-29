import type { MinimapData } from "@/lib/minimap";

type CountryMinimapProps = {
  data: MinimapData;
  /** Index of the emphasized point; its marker glides between scenes. */
  activeIndex: number;
  className?: string;
};

export function CountryMinimap({ data, activeIndex, className }: CountryMinimapProps) {
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
          fill="rgba(244,234,213,0.07)"
          stroke="rgba(244,234,213,0.75)"
          strokeWidth="1"
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
        <circle key={i} cx={x} cy={y} r="2.5" fill="rgba(212,177,106,0.4)" />
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
