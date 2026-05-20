'use client';

import { useState, useEffect } from 'react';
import { I18N, Lang } from '@/i18n/landing';
import AnimatedHeroCards from './AnimatedHeroCards';
import UploadDemo from './UploadDemo';
import FAQ from './FAQ';
import CTA from './CTA';
import './landing.css';

export default function LandingPage() {
  const [lang, setLang] = useState<Lang>('en');
  const L = I18N[lang];

  useEffect(() => {
    const obs = new IntersectionObserver(
      entries => { entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); }); },
      { threshold: 0.12 }
    );
    document.querySelectorAll('.landing-root .reveal').forEach(el => obs.observe(el));
    return () => obs.disconnect();
  }, [lang]);

  useEffect(() => {
    const nav = document.getElementById('rb-nav');
    const onScroll = () => nav?.classList.toggle('scrolled', window.scrollY > 8);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const scrollToDemo = () => document.getElementById('demo')?.scrollIntoView({ behavior: 'smooth', block: 'start' });


  return (
    <div className="landing-root">

      {/* NAV */}
      <nav id="rb-nav" className="nav">
        <div className="nav-inner">
          <a href="#" className="nav-brand">Re<em>Built</em><span className="dot"/></a>
          <div className="nav-links">
            <a href="#features">{L.nav.product}</a>
            <a href="#demo">{L.nav.tryit}</a>
            <a href="#how">How it works</a>
            <a href="#faq">{L.nav.faq}</a>
          </div>
          <div className="nav-right">
            <div className="lang-switch" role="tablist">
              {(['en', 'fr', 'nl'] as Lang[]).map(l => (
                <button key={l} aria-pressed={lang === l} onClick={() => setLang(l)}>{l}</button>
              ))}
            </div>
            <button className="nav-cta" onClick={scrollToDemo}>{L.nav.cta}</button>
          </div>
        </div>
      </nav>

      {/* HERO */}
      <section className="hero">
        <div className="container hero-inner">
          <div className="hero-grid">
            <div>
              <div className="hero-badge">{L.hero.badge}</div>
              <h1>
                <span className="ln">{L.hero.h1_a}</span>
                <span className="ln"><em>{L.hero.h1_b}</em></span>
                <span className="ln">{L.hero.h1_c}</span>
              </h1>
              <p className="hero-sub">{L.hero.sub}</p>
              <div className="hero-actions">
                <button className="btn btn-primary btn-lg" onClick={scrollToDemo}>
                  {L.hero.try_btn}
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
                  </svg>
                </button>
                <span className="hero-try-hint">↳ {L.hero.try_hint}</span>
              </div>
              <div className="hero-proof">
                {L.hero.proof.split(' · ').map((b, i) => <span key={i}>{b}</span>)}
              </div>
            </div>
            <div className="hero-visual">
              <AnimatedHeroCards/>
            </div>
          </div>
        </div>
      </section>

      {/* TRUST BAR */}
      <div className="trust-bar">
        <div className="container">
          <div className="trust-title">{L.trust.title}</div>
          <div className="trust-logos">
            {L.trust.logos.map((logo, i) => <div key={i} className="trust-logo">{logo}</div>)}
          </div>
        </div>
      </div>

      {/* DEMO */}
      <section id="demo" className="demo-section section-bg-deep">
        <div className="container">
          <div style={{ maxWidth: 920, margin: '0 auto' }}>
            <div className="section-label">{L.demo.label}</div>
            <h2 className="section-title">{L.demo.title}</h2>
            <p className="section-sub">{L.demo.sub}</p>
            <UploadDemo t={L.demo}/>
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section id="features">
        <div className="container">
          <div className="section-label">{L.features.label}</div>
          <h2 className="section-title">{L.features.title}</h2>
          <p className="section-sub">{L.features.sub}</p>
          <div className="features-grid">
            {L.features.cards.map((c, i) => (
              <div key={i} className={`feature-card reveal reveal-d${i % 3}`}>
                <div className="feature-icon">{c.tag}</div>
                <h3>{c.h}</h3>
                <p>{c.p}</p>
                <div className="stat">{c.stat}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how" className="section-bg-deep">
        <div className="container">
          <div className="section-label">{L.how.label}</div>
          <h2 className="section-title">{L.how.title}</h2>
          <p className="section-sub">{L.how.sub}</p>
          <div className="steps-grid">
            {L.how.steps.map((s, i) => (
              <div key={i} className={`step-card reveal reveal-d${i}`}>
                <div className="step-label">{s.tag}</div>
                <h3>{s.h}</h3>
                <p>{s.p}</p>
                <div className="step-detail">{s.detail}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* BELGIUM */}
      <section id="belgium">
        <div className="container">
          <div className="section-label">{L.belgium.label}</div>
          <h2 className="section-title">{L.belgium.title}</h2>
          <p className="section-sub">{L.belgium.sub}</p>
          <div className="belgium-grid">
            <ul className="belgium-list">
              {L.belgium.bullets.map((b, i) => <li key={i}>{b}</li>)}
            </ul>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="section-bg-deep">
        <div className="container">
          <div className="section-label">{L.faq.label}</div>
          <h2 className="section-title">{L.faq.title}</h2>
          <div style={{ marginTop: 24 }}/>
          <FAQ items={L.faq.items}/>
        </div>
      </section>

      {/* CTA */}
      <CTA L={L}/>

      {/* FOOTER */}
      <footer>
        <div className="container">
          <div className="footer-inner">
            <div className="footer-left">
              <div className="footer-brand">Re<em style={{ fontStyle: 'normal', color: 'var(--accent)' }}>Built</em><span className="dot"/></div>
              <div className="footer-tagline">{L.footer.tagline}</div>
            </div>
            <div className="footer-links">
              {L.footer.links.map((link, i) => (
                <a key={i} href={i === 0 ? '#features' : i === 1 ? '#how' : i === 2 ? '#faq' : i === 3 ? '#beta' : '#'}>{link}</a>
              ))}
            </div>
          </div>
          <div className="footer-copy">
            <span>{L.footer.copy}</span>
            <span>hello@rebuilt.be</span>
          </div>
        </div>
      </footer>

    </div>
  );
}
