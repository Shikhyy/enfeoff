import { useEffect, useRef, useState } from "react";
import { Link, Route, Routes, useLocation } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import Lenis from "lenis";
import { Cursor, Glyph, PageHead, ScrollProgress } from "./ui";
import { Footer, Nav } from "./Nav";
import Intro, { INTRO_ON } from "./Intro";
import Home from "./pages/Home";
import Playground from "./pages/Playground";
import Invariants from "./pages/Invariants";
import Proof from "./pages/Proof";
import Agent from "./pages/Agent";
import Integrate from "./pages/Integrate";
import Limits from "./pages/Limits";

type LenisWindow = Window & { __lenis?: Lenis };

function NotFound() {
  return (
    <>
      <PageHead tag="404" title="That page is *not here.*" lede="The link may be old. Try one of the pages in the menu." />
      <div className="container section">
        <Link to="/" className="btn btn--dark">Back to the start</Link>
      </div>
    </>
  );
}

export default function App() {
  const loc = useLocation();
  const reduce = useReducedMotion();
  const [intro, setIntro] = useState(INTRO_ON);
  const [navs, setNavs] = useState(0);
  const prevPath = useRef(loc.pathname);
  useEffect(() => {
    if (prevPath.current !== loc.pathname) {
      prevPath.current = loc.pathname;
      setNavs((n) => n + 1);
    }
  }, [loc.pathname]);

  useEffect(() => {
    if (reduce) return;
    const lenis = new Lenis({ lerp: 0.1, smoothWheel: true });
    (window as LenisWindow).__lenis = lenis;
    let raf = 0;
    const loop = (t: number) => {
      lenis.raf(t);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      lenis.destroy();
      delete (window as LenisWindow).__lenis;
    };
  }, [reduce]);

  useEffect(() => {
    const lenis = (window as LenisWindow).__lenis;
    if (loc.hash) {
      const el = document.getElementById(loc.hash.slice(1));
      if (el) {
        const t = window.setTimeout(() => (lenis ? lenis.scrollTo(el, { offset: -90 }) : el.scrollIntoView()), 350);
        return () => window.clearTimeout(t);
      }
    }
    if (lenis) lenis.scrollTo(0, { immediate: true });
    else window.scrollTo(0, 0);
  }, [loc.pathname, loc.hash]);

  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <ScrollProgress />
      <Cursor />
      <div className="grain" aria-hidden="true" />
      {intro && <Intro onDone={() => setIntro(false)} />}
      {!reduce && navs > 0 && (
        <motion.div key={navs} className="sweep" aria-hidden="true" initial={{ y: "0%" }} animate={{ y: "-104%" }} transition={{ duration: 0.85, ease: [0.7, 0, 0.2, 1], delay: 0.08 }}>
          <Glyph size={72} draw />
        </motion.div>
      )}
      <Nav />
      <main id="main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/playground" element={<Playground />} />
          <Route path="/invariants" element={<Invariants />} />
          <Route path="/proof" element={<Proof />} />
          <Route path="/agent" element={<Agent />} />
          <Route path="/integrate" element={<Integrate />} />
          <Route path="/limits" element={<Limits />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <Footer />
    </>
  );
}
