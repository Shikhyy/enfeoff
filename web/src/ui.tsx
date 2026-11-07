import { useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { animate, motion, useInView, useReducedMotion, useScroll, useSpring } from "framer-motion";

const EASE = [0.2, 0.7, 0.2, 1] as const;

/* ---------- brand mark: a circle of vertical lines that shorten left to right ---------- */
const GLYPH: [number, number, number][] = [
  [5, 10, 30], [8, 6.6, 33.4], [11, 4.4, 35.6], [14, 3, 37], [17, 2.3, 37.7], [20, 2, 38],
  [23, 4.9, 35.1], [26, 8.1, 31.9], [29, 11.4, 28.6], [32, 14.6, 25.4], [35, 17.5, 22.5],
];

export function Glyph({ size = 34, draw = false }: { size?: number; draw?: boolean }) {
  const reduce = useReducedMotion();
  const animated = draw && !reduce;
  const origin = { transformBox: "view-box", transformOrigin: "20px 20px" } as CSSProperties;
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" className="glyph">
      <g stroke="currentColor" strokeWidth="1.7">
        {GLYPH.map(([x, a, b], i) =>
          animated ? (
            <motion.line key={i} x1={x} x2={x} y1={a} y2={b} initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} transition={{ duration: 0.7, delay: 0.25 + i * 0.05, ease: EASE }} style={origin} />
          ) : (
            <line key={i} x1={x} x2={x} y1={a} y2={b} />
          )
        )}
      </g>
    </svg>
  );
}

/* ---------- text and block reveals ---------- */
type Tag = "h1" | "h2" | "h3" | "p" | "div";

/** Word-by-word masked reveal. Wrap words in *asterisks* to colour them with the accent. */
export function Split({ text, as = "h2", className = "", delay = 0 }: { text: string; as?: Tag; className?: string; delay?: number }) {
  const reduce = useReducedMotion();
  const words: { w: string; accent: boolean }[] = [];
  text.split(/(\*[^*]+\*)/).filter(Boolean).forEach((part) => {
    const accent = part.startsWith("*");
    (accent ? part.slice(1, -1) : part).split(/\s+/).filter(Boolean).forEach((w) => words.push({ w, accent }));
  });
  const M = (motion as unknown as Record<string, typeof motion.div>)[as];
  return (
    <M
      className={className}
      aria-label={text.replace(/\*/g, "")}
      initial={reduce ? false : "hidden"}
      whileInView="show"
      viewport={{ once: true, margin: "0px 0px -8% 0px" }}
      transition={{ staggerChildren: 0.055, delayChildren: delay }}
    >
      {words.map(({ w, accent }, i) => (
        <span key={i}>
          <span className="split__w" aria-hidden="true">
            <motion.span className={`split__i${accent ? " accent" : ""}`} variants={{ hidden: { y: "118%" }, show: { y: 0, transition: { duration: 0.85, ease: EASE } } }}>
              {w}
            </motion.span>
          </span>{" "}
        </span>
      ))}
    </M>
  );
}

export function Reveal({ children, delay = 0, y = 28, className }: { children: ReactNode; delay?: number; y?: number; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -8% 0px" }}
      transition={{ duration: 0.8, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

/* ---------- pointer effects ---------- */
export function Magnetic({ children, strength = 0.25 }: { children: ReactNode; strength?: number }) {
  const reduce = useReducedMotion();
  const x = useSpring(0, { stiffness: 220, damping: 18, mass: 0.4 });
  const y = useSpring(0, { stiffness: 220, damping: 18, mass: 0.4 });
  const move = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (reduce) return;
    const r = e.currentTarget.getBoundingClientRect();
    x.set((e.clientX - (r.left + r.width / 2)) * strength);
    y.set((e.clientY - (r.top + r.height / 2)) * strength);
  };
  const leave = () => {
    x.set(0);
    y.set(0);
  };
  return (
    <motion.div style={{ x, y, display: "inline-block" }} onMouseMove={move} onMouseLeave={leave}>
      {children}
    </motion.div>
  );
}

export function Tilt({ children, max = 6, className }: { children: ReactNode; max?: number; className?: string }) {
  const reduce = useReducedMotion();
  const rx = useSpring(0, { stiffness: 180, damping: 18 });
  const ry = useSpring(0, { stiffness: 180, damping: 18 });
  const move = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (reduce) return;
    const r = e.currentTarget.getBoundingClientRect();
    ry.set(((e.clientX - r.left) / r.width - 0.5) * max * 2);
    rx.set(-((e.clientY - r.top) / r.height - 0.5) * max * 2);
  };
  const leave = () => {
    rx.set(0);
    ry.set(0);
  };
  return (
    <motion.div className={className} onMouseMove={move} onMouseLeave={leave} style={{ rotateX: rx, rotateY: ry, transformPerspective: 900, height: "100%" }}>
      {children}
    </motion.div>
  );
}

/** Surfaces where the sage dot would vanish, so the cursor switches to paper colour. */
const DARK_SURFACES = ".section--ink, .section--sage, .panel, .footer, .scene, .marquee, .hero__scene, .hero__stick, .card--ink, .memo, .intro__ground";

/** A solid sage dot with a softer ring that trails it, like the dot beside the wordmark in the moodboard. */
export function Cursor() {
  const [on, setOn] = useState(false);
  const [big, setBig] = useState(false);
  const [dark, setDark] = useState(false);
  const dx = useSpring(-100, { stiffness: 1400, damping: 60, mass: 0.2 });
  const dy = useSpring(-100, { stiffness: 1400, damping: 60, mass: 0.2 });
  const rx = useSpring(-100, { stiffness: 260, damping: 28, mass: 0.5 });
  const ry = useSpring(-100, { stiffness: 260, damping: 28, mass: 0.5 });
  useEffect(() => {
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    setOn(true);
    document.documentElement.classList.add("has-cursor");
    const move = (e: MouseEvent) => {
      dx.set(e.clientX);
      dy.set(e.clientY);
      rx.set(e.clientX);
      ry.set(e.clientY);
    };
    const over = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      setBig(!!t.closest("a, button, label, select, [data-cursor]"));
      setDark(!!t.closest(DARK_SURFACES) && !t.closest(".hero__sheet"));
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseover", over);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseover", over);
      document.documentElement.classList.remove("has-cursor");
    };
  }, [dx, dy, rx, ry]);
  if (!on) return null;
  const mods = `${big ? " cursor--big" : ""}${dark ? " cursor--dark" : ""}`;
  return (
    <>
      <motion.div className={`cursor__ring${mods}`} style={{ x: rx, y: ry }} aria-hidden="true" />
      <motion.div className={`cursor__dot${mods}`} style={{ x: dx, y: dy }} aria-hidden="true" />
    </>
  );
}

export function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 120, damping: 30, mass: 0.3 });
  return <motion.div className="progress" style={{ scaleX }} aria-hidden="true" />;
}

/* ---------- data display ---------- */
export function Counter({ to, decimals = 0, suffix = "", duration = 1.6 }: { to: number; decimals?: number; suffix?: string; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "0px 0px -10% 0px" });
  const reduce = useReducedMotion();
  const [v, setV] = useState(reduce ? to : 0);
  useEffect(() => {
    if (!inView || reduce) return;
    const c = animate(0, to, { duration, ease: EASE, onUpdate: setV });
    return () => c.stop();
  }, [inView, to, duration, reduce]);
  return (
    <span ref={ref} className="tnum">
      {v.toFixed(decimals)}
      {suffix}
    </span>
  );
}

export function Marquee({ items, hot = [] }: { items: string[]; hot?: string[] }) {
  const loop = [...items, ...items];
  return (
    <div className="marquee" aria-label="Error codes the program can return">
      <div className="marquee__track" aria-hidden="true">
        {loop.map((t, i) => (
          <span key={i} className={`marquee__item${hot.includes(t) ? " marquee__item--hot" : ""}`}>
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

export function Bar({
  label, meta, capPct, fillPct, tone = "ok", indent = 0, selected = false, onClick, ghost = false,
}: {
  label: string; meta?: string; capPct: number; fillPct: number; tone?: "ok" | "dead"; indent?: number; selected?: boolean; onClick?: () => void; ghost?: boolean;
}) {
  const ref = useRef<HTMLDivElement & HTMLButtonElement>(null);
  const inView = useInView(ref, { once: true, margin: "0px 0px -5% 0px" });
  const reduce = useReducedMotion();
  const shown = inView || reduce ? Math.max(0, Math.min(100, fillPct)) : 0;
  const body = (
    <>
      <span className="bar__head" style={{ marginLeft: indent }}>
        <span>{label}</span>
        {meta && <span className="bar__meta">{meta}</span>}
      </span>
      <span className="bar__track" style={{ display: "block", marginLeft: indent, width: `calc(${capPct}% - ${indent}px)` }}>
        <motion.span className="bar__fill" style={{ display: "block" }} initial={false} animate={{ width: `${shown}%` }} transition={{ type: "spring", stiffness: 140, damping: 22 }} />
      </span>
    </>
  );
  const cls = `bar bar--${tone}${selected ? " bar--sel" : ""}${ghost ? " bar--ghost" : ""}`;
  return onClick ? (
    <button ref={ref} type="button" className={cls} onClick={onClick} aria-pressed={selected}>
      {body}
    </button>
  ) : (
    <div ref={ref} className={cls}>
      {body}
    </div>
  );
}

export function Badge({ tone = "mute", children }: { tone?: "ok" | "err" | "slate" | "mute"; children: ReactNode }) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

export function Ext({ href, children, className = "ext" }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className={className}>
      {children}
      <span aria-hidden="true"> ↗</span>
    </a>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch {
        /* nothing else to try */
      }
      ta.remove();
    }
    setDone(true);
    window.setTimeout(() => setDone(false), 1600);
  };
  return (
    <button type="button" className="btn btn--sm btn--ghost" onClick={copy}>
      {done ? "Copied" : label}
    </button>
  );
}

/* ---------- code ---------- */
function tokens(lang: "ts" | "sh") {
  const kw = "\\b(?:const|let|await|new|import|from|export|async|return|type|interface)\\b";
  const src = lang === "sh" ? `(#.*$|"[^"\\n]*"|'[^'\\n]*')` : `(\\/\\/.*$|"[^"\\n]*"|'[^'\\n]*'|\`[^\`\\n]*\`|${kw}|\\b\\d[\\d_.]*\\b)`;
  return new RegExp(src, "gm");
}
const tokenClass = (t: string) => (/^(\/\/|#)/.test(t) ? "tk-c" : /^["'`]/.test(t) ? "tk-s" : /^\d/.test(t) ? "tk-n" : "tk-k");

export function CodeBlock({ code, title, lang = "ts" }: { code: string; title: string; lang?: "ts" | "sh" }) {
  const re = tokens(lang);
  const lines = code.split("\n");
  return (
    <div className="codebox">
      <div className="codebox__head">
        <span>{title}</span>
        <CopyButton text={code} />
      </div>
      <pre className="code" tabIndex={0}>
        <code>
          {lines.map((line, li) => (
            <span key={li}>
              {line.split(re).map((p, i) => (i % 2 ? <span key={i} className={tokenClass(p)}>{p}</span> : p))}
              {li < lines.length - 1 ? "\n" : ""}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}

export function PageHead({ tag, title, lede, children }: { tag: string; title: string; lede?: string; children?: ReactNode }) {
  return (
    <header className="container pagehead">
      <Reveal>
        <span className="tag">{tag}</span>
      </Reveal>
      <Split as="h1" className="display h-lg" text={title} />
      {lede && (
        <Reveal delay={0.15}>
          <p className="lede">{lede}</p>
        </Reveal>
      )}
      {children}
    </header>
  );
}
