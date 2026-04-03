"use client";

import { useEffect, useRef, useState } from "react";

type Direction = "up" | "left" | "scale";

interface AnimateSectionProps {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  direction?: Direction;
  threshold?: number;
}

const hiddenStyles: Record<Direction, string> = {
  up:    "opacity-0 translate-y-8",
  left:  "opacity-0 translate-x-6",
  scale: "opacity-0 scale-95",
};

const visibleStyles: Record<Direction, string> = {
  up:    "opacity-100 translate-y-0",
  left:  "opacity-100 translate-x-0",
  scale: "opacity-100 scale-100",
};

export function AnimateSection({
  children,
  className = "",
  delay = 0,
  direction = "up",
  threshold = 0.1,
}: AnimateSectionProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          observer.unobserve(el);
        }
      },
      { threshold },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold]);

  return (
    <div
      ref={ref}
      style={{ transitionDelay: `${delay}ms` }}
      className={`transition-all duration-700 ease-out ${
        visible ? visibleStyles[direction] : hiddenStyles[direction]
      } ${className}`}
    >
      {children}
    </div>
  );
}
