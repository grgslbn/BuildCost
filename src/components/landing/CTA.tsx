'use client';

import { useState } from 'react';
import { LandingI18N } from '@/i18n/landing';

export default function CTA({ L }: { L: LandingI18N }) {
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [company, setCompany] = useState('');
  const [email, setEmail] = useState('');
  const [volume, setVolume] = useState('');
  const [region, setRegion] = useState('');

  const t = L.cta;

  async function handleSubmit() {
    if (!email || !company) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/public/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          company,
          volume: volume || null,
          region: region || null,
          intent: 'beta_signup',
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Something went wrong');
      } else {
        setSubmitted(true);
      }
    } catch {
      setError('Network error — please try again');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section id="beta" className="cta-section">
      <div className="section-label">{t.label}</div>
      <h2 className="section-title">{t.title}</h2>
      <p className="section-sub">{t.sub}</p>
      {!submitted ? (
        <div className="cta-form">
          <input
            type="text"
            placeholder={t.company}
            required
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            disabled={loading}
          />
          <input
            type="email"
            placeholder={t.email}
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={loading}
          />
          <select
            required
            value={volume}
            onChange={(e) => setVolume(e.target.value)}
            disabled={loading}
          >
            <option value="" disabled>{t.volume}</option>
            {t.volume_opts.map((o, i) => <option key={i} value={o}>{o}</option>)}
          </select>
          <select
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            disabled={loading}
          >
            <option value="" disabled>{t.region}</option>
            {t.region_opts.map((o, i) => <option key={i} value={o}>{o}</option>)}
          </select>
          {error && (
            <div style={{ color: '#e24b4a', fontSize: '0.85rem', textAlign: 'center' }}>
              {error}
            </div>
          )}
          <button
            className="btn btn-primary btn-lg"
            onClick={handleSubmit}
            disabled={loading || !email || !company}
          >
            {loading ? 'Submitting…' : t.submit}
          </button>
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
