import { useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Glyph, Magnetic } from "./ui";
import { MINT_URL, PROGRAM_URL, RUN, short } from "./lib/data";

const LINKS: [string, string][] = [
  ["/playground", "Delegation tree"],
  ["/invariants", "Invariants"],
  ["/proof", "Proof"],
  ["/agent", "Agent run"],
  ["/integrate", "Integrate"],
  ["/limits", "Limits"],
];

export function Nav() {
  const [open, setOpen] = useState(false);
  const [stuck, setStuck] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    const f = () => setStuck(window.scrollY > 24);
    f();
    window.addEventListener("scroll", f, { passive: true });
    return () => window.removeEventListener("scroll", f);
  }, []);
  return (
    <header className={`nav${stuck ? " nav--stuck" : ""}`}>
      <Link to="/" className="nav__brand" aria-label="Enfeoff home">
        <Glyph size={30} />
        <span>Enfeoff</span>
      </Link>
      <nav className="nav__links" aria-label="Main">
        {LINKS.map(([to, t]) => (
          <NavLink key={to} to={to} className={({ isActive }) => (isActive ? "is-active" : "")}>
            {t}
          </NavLink>
        ))}
        <Magnetic>
          <Link to="/playground" className="btn btn--dark btn--sm">Open the demo</Link>
        </Magnetic>
      </nav>
      <button type="button" className="nav__burger" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} onClick={() => setOpen(!open)}>
        <span />
        <span />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div className="nav__panel" initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.25 }}>
            {LINKS.map(([to, t]) => (
              <Link key={to} to={to}>{t}</Link>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer__grid">
          <div>
            <h4>Enfeoff</h4>
            <p>Authority that can only shrink. Unaudited devnet code, test mint only.</p>
          </div>
          <div>
            <h4>Pages</h4>
            {LINKS.map(([to, t]) => (
              <Link key={to} to={to}>{t}</Link>
            ))}
          </div>
          <div>
            <h4>Devnet</h4>
            <a href={PROGRAM_URL} target="_blank" rel="noreferrer noopener">Program {short(RUN.programId)} ↗</a>
            <a href={MINT_URL} target="_blank" rel="noreferrer noopener">tUSDC mint {short(RUN.mint)} ↗</a>
          </div>
        </div>
        <div className="footer__big" aria-hidden="true">Enfeoff</div>
      </div>
    </footer>
  );
}
