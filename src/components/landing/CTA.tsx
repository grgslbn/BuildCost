'use client';

import { useState } from 'react';
import { LandingI18N } from '@/i18n/landing';

export default function CTA({ L }: { L: LandingI18N }) {
  const [submitted, setSubmitted] = useState(false);
  const t = L.cta;
  return (
    <section id="beta" className="cta-section">
      <div className="section-label">{t.label}</div>
      <h2 className="section-title">{t.title}</h2>
      <p className="section-sub">{t.sub}</p>
      {!submitted ? (
        <div className="cta-form">
          <input type="text" placeholder={t.company} required/>
          <input type="email" placeholder={t.email} required/>
          <select required defaultValue="">
            <option value="" disabled>{t.volume}</option>
            {t.volume_opts.map((o, i) => <option key={i}>{o}</option>)}
          </select>
          <select defaultValue="">
            <option value="" disabled>{t.region}</option>
            {t.region_opts.map((o, i) => <option key={i}>{o}</option>)}
          </select>
          <button className="btn btn-primary btn-lg" onClick={() => setSubmitted(true)}>{t.submit}</button>
        </div>
      ) : (
        <div className="cta-thanks">{t.thanks}</div>
      )}
      <div className="cta-perks">
        {t.perks.map((p, i) => <span key={i}>{p}</span>)}
      </div>
    </section>
  );
}
