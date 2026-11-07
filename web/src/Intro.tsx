import { useEffect } from "react";
import { motion } from "framer-motion";
import { Glyph } from "./ui";

/** Seconds from load until the intro has fully cleared. The hero headline waits for this. */
export const INTRO_MS = 2.5;
export const INTRO_ON = typeof window !== "undefined" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
/** Set once the intro has finished, so later visits to the home page do not wait for it. */
export const introState = { done: !INTRO_ON };

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One jagged vertical tear, top to bottom, as the left piece and the right piece. */
function tear(seed: number) {
  const r = rng(seed);
  const n = 24;
  const line: string[] = [];
  for (let i = 0; i <= n; i++) {
    const x = 50 + (r() - 0.5) * 8 + Math.sin(i * 0.9) * 2.4;
    line.push(`${x.toFixed(2)}% ${((i / n) * 100).toFixed(2)}%`);
  }
  return {
    left: `polygon(0% 0%, ${line.join(",")}, 0% 100%)`,
    right: `polygon(${line.join(",")}, 100% 100%, 100% 0%)`,
  };
}
const POLY = tear(11);
const EASE_TEAR = [0.7, 0, 0.2, 1] as const;
const TEAR_AT = 1.25;

function Mark() {
  return (
    <div className="intro__mark">
      <motion.span className="intro__dot" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ duration: 0.5, delay: 0.1, ease: [0.2, 0.7, 0.2, 1] }} />
      <Glyph size={64} draw />
      <span className="intro__word">Enfeoff</span>
    </div>
  );
}

function Half({ side }: { side: "left" | "right" }) {
  const left = side === "left";
  return (
    <motion.div
      className="intro__half"
      initial={{ x: "0%", y: "0%", rotate: 0 }}
      animate={{ x: ["0%", left ? "-1.6%" : "1.6%", left ? "-66%" : "66%"], y: ["0%", "0%", left ? "4%" : "-3%"], rotate: [0, 0, left ? -5 : 6] }}
      transition={{ duration: 1.15, delay: TEAR_AT, times: [0, 0.16, 1], ease: EASE_TEAR }}
    >
      <div className="intro__paper" style={{ clipPath: left ? POLY.left : POLY.right }}>
        <Mark />
      </div>
    </motion.div>
  );
}

export default function Intro({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = "hidden";
    const finish = () => {
      introState.done = true;
      onDone();
    };
    const t = window.setTimeout(finish, INTRO_MS * 1000);
    const skip = (e: KeyboardEvent) => e.key === "Escape" && finish();
    window.addEventListener("keydown", skip);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", skip);
      html.style.overflow = prev;
    };
  }, [onDone]);

  return (
    <div className="intro" aria-hidden="true" onClick={() => { introState.done = true; onDone(); }}>
      <motion.div className="intro__ground" initial={{ opacity: 1 }} animate={{ opacity: 0 }} transition={{ duration: 0.6, delay: 1.95 }}>
        <div className="hero__hills" />
      </motion.div>
      <Half side="left" />
      <Half side="right" />
    </div>
  );
}
