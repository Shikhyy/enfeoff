import { useRef } from "react";
import { Link } from "react-router-dom";
import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { Bar, Glyph, Magnetic, Split } from "./ui";
import { INTRO_MS, introState } from "./Intro";
import { RUN, ROOT_CAP, TREE, short } from "./lib/data";

/* A deterministic torn edge: the same polygon on every render. */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function torn(seed: number, jag: number) {
  const r = rng(seed);
  const n = 28;
  const p = (x: number, y: number) => `${x.toFixed(2)}% ${y.toFixed(2)}%`;
  const pts: string[] = [];
  for (let i = 0; i <= n; i++) pts.push(p((i / n) * 100, r() * jag));
  for (let i = 1; i <= 10; i++) pts.push(p(100 - r() * jag * 0.6, (i / 10) * 100));
  for (let i = n; i >= 0; i--) pts.push(p((i / n) * 100, 100 - r() * jag * 1.5));
  for (let i = 9; i >= 1; i--) pts.push(p(r() * jag * 0.6, (i / 10) * 100));
  return `polygon(${pts.join(",")})`;
}
const CLIP_FRONT = torn(7, 3);
const CLIP_BACK = torn(21, 4.2);

const CHIPS = ["RecipientNotAllowed", "ExceedsParentBudget", "Revoked"];

function HeroCopy() {
  return (
    <>
      <div className="row">
        <span className="tag tag--line">network = devnet</span>
        <span className="tag tag--line">program = {short(RUN.programId)}</span>
      </div>
      <Split as="h1" className="display h-xl" text="Authority that can only *shrink.*" delay={introState.done ? 0.5 : INTRO_MS - 0.2} />
      <p>
        Enfeoff is on-chain delegation for AI agents on Solana. An agent can hand part of its mandate to a sub-agent, never more than it holds. The program enforces it, so a hijacked agent stays inside its bounds.
      </p>
      <div className="row">
        <Magnetic>
          <Link to="/playground" className="btn btn--dark">Try the delegation tree</Link>
        </Magnetic>
        <Magnetic>
          <Link to="/proof" className="btn btn--ghost">See the recorded devnet run</Link>
        </Magnetic>
      </div>
    </>
  );
}

function Scene() {
  return (
    <div className="scene on-dark">
      <div className="eyebrow">Under the paper · state after the recorded devnet run</div>
      {TREE.map((t) => (
        <Bar key={t.label} label={t.label} meta={`${t.spent} / ${t.cap} tUSDC${t.revoked ? " · revoked" : t.dead ? " · blocked" : ""}`} capPct={(t.cap / ROOT_CAP) * 100} fillPct={t.cap ? (t.spent / t.cap) * 100 : 0} tone={t.dead ? "dead" : "ok"} indent={t.depth * 22} />
      ))}
      <p className="scene__note">Captain is revoked in the last step. Everything under it is refused.</p>
    </div>
  );
}

export default function TornHero() {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress: p } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const sheetY = useTransform(p, [0, 0.62], ["0vh", "-108vh"]);
  const sheetRot = useTransform(p, [0, 0.62], [0, 1.1]);
  const backY = useTransform(p, [0, 0.62], ["0vh", "-94vh"]);
  const backRot = useTransform(p, [0, 0.62], [0, -1.5]);
  const groundY = useTransform(p, [0, 1], ["0%", "10%"]);
  const hillsY = useTransform(p, [0, 1], ["0%", "18%"]);
  const sceneO = useTransform(p, [0.03, 0.2], [0, 1]);
  const sceneY = useTransform(p, [0, 0.5], ["10vh", "0vh"]);
  const sceneS = useTransform(p, [0, 0.5], [0.94, 1]);
  const chipsY = useTransform(p, [0, 0.6], ["0vh", "-46vh"]);
  const hintO = useTransform(p, [0, 0.07], [1, 0]);

  if (reduce) {
    return (
      <section className="hero-static" aria-label="Introduction">
        <div className="hero__sheet" style={{ clipPath: CLIP_FRONT }}>
          <Glyph size={40} />
          <HeroCopy />
        </div>
        <Scene />
      </section>
    );
  }

  return (
    <section ref={ref} className="hero" aria-label="Introduction">
      <div className="hero__stick">
        <motion.div className="hero__ground" style={{ y: groundY }} />
        <motion.div className="hero__hills" style={{ y: hillsY }} />
        <motion.div className="hero__scene" style={{ opacity: sceneO, y: sceneY, scale: sceneS }}>
          <Scene />
        </motion.div>
        <motion.div className="hero__chips" style={{ y: chipsY }} aria-hidden="true">
          {CHIPS.map((c) => (
            <span key={c} className="chip">{c}</span>
          ))}
        </motion.div>
        <motion.div className="hero__sheet2" style={{ y: backY, rotate: backRot, clipPath: CLIP_BACK }} aria-hidden="true" />
        <motion.div className="hero__sheet" style={{ y: sheetY, rotate: sheetRot, clipPath: CLIP_FRONT }}>
          <Glyph size={44} draw />
          <HeroCopy />
        </motion.div>
        <motion.div className="hero__hint" style={{ opacity: hintO }} aria-hidden="true">
          Scroll to tear
          <i />
        </motion.div>
      </div>
    </section>
  );
}
