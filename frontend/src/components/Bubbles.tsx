import { useMemo } from "react";

/** Decorative rising bubbles for the ocean background. */
export default function Bubbles({ count = 14 }: { count?: number }) {
  const bubbles = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        left: `${(i * 37 + 11) % 100}%`,
        size: 8 + ((i * 13) % 26),
        duration: 14 + ((i * 7) % 12),
        delay: -((i * 3) % 14),
      })),
    [count],
  );
  return (
    <div className="bubbles" aria-hidden>
      {bubbles.map((b, i) => (
        <span
          key={i}
          className="bubble"
          style={{ left: b.left, width: b.size, height: b.size, animationDuration: `${b.duration}s`, animationDelay: `${b.delay}s` }}
        />
      ))}
    </div>
  );
}
