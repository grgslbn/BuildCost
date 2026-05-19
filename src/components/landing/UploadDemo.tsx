'use client';

import { useState, useRef, useEffect } from 'react';
import { SAMPLE_PLAN_DATA, SamplePlan, fmtEUR, fmtArea } from '@/data/samplePlans';
import { LandingI18N } from '@/i18n/landing';

type DemoState = 'idle' | 'processing' | 'results';

interface MockFile {
  name: string;
  size: number;
  type: string;
}

function DetailedReport({ data }: { data: SamplePlan }) {
  const totalArea = data.rooms.reduce((s, [, a]) => s + a, 0);
  const totalCost = totalArea * data.basePrice * data.finishing.coef;
  const finishPct = ((data.finishing.coef - 0.7) / (1.5 - 0.7)) * 100;
  const [gf, setGf] = useState(0);

  useEffect(() => {
    const id = setTimeout(() => setGf(finishPct), 80);
    return () => clearTimeout(id);
  }, [finishPct]);

  return (
    <div className="detailed-report">
      <div className="report-card">
        <h5>Surface extraction</h5>
        <ul className="room-list">
          {data.rooms.map(([n, a], i) => (
            <li key={i} className="room-item">
              <span className="name">{n}</span>
              <span className="area">{fmtArea(a)}</span>
            </li>
          ))}
        </ul>
        <div className="room-total">
          <span>Total livable area</span>
          <span className="value">{fmtArea(totalArea)}</span>
        </div>
      </div>
      <div className="report-card">
        <h5>Cost estimation</h5>
        <div className="gauge">
          <div className="gauge-label">
            <span>Finishing level</span>
            <span className="level">{data.finishing.level} · ×{data.finishing.coef.toFixed(2)}</span>
          </div>
          <div className="gauge-track">
            <div className="gauge-fill" style={{ width: gf + '%' }} />
          </div>
          <div className="gauge-labels">
            <span>Basic</span><span>Standard</span><span>Comfort</span><span>Luxury</span><span>Premium</span>
          </div>
        </div>
        <div>
          <div className="cost-line"><span className="label">Livable area</span><span className="value">{fmtArea(totalArea)}</span></div>
          <div className="cost-line"><span className="label">Base · {data.postcode}</span><span className="value">€ {data.basePrice.toLocaleString('de-DE')}/m²</span></div>
          <div className="cost-line"><span className="label">ABEX {data.abex}</span><span className="value">× 1,0000</span></div>
          <div className="cost-line"><span className="label">Finishing coefficient</span><span className="value">× {data.finishing.coef.toFixed(2)}</span></div>
        </div>
        <div style={{ marginTop: 16, padding: 18, background: 'var(--accent-light)', borderRadius: 'var(--radius-sm)', textAlign: 'center' }}>
          <div style={{ fontSize: '.72rem', fontWeight: 600, color: 'var(--accent-deep)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }}>Reconstruction cost</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', color: 'var(--accent-deep)' }}>{fmtEUR(totalCost)}</div>
        </div>
      </div>
    </div>
  );
}

export default function UploadDemo({ t }: { t: LandingI18N['demo'] }) {
  const [state, setState] = useState<DemoState>('idle');
  const [file, setFile] = useState<MockFile | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [stepIdx, setStepIdx] = useState(-1);
  const [data, setData] = useState<SamplePlan | null>(null);
  const [emailed, setEmailed] = useState(false);
  const [emailValue, setEmailValue] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const steps = [t.step_scale, t.step_rooms, t.step_qqp, t.step_cost];
  const delays = [700, 1400, 1300, 900];

  const beginProcessing = (f: MockFile | File) => {
    const keys = Object.keys(SAMPLE_PLAN_DATA);
    let chosen = SAMPLE_PLAN_DATA.villa;
    const n = (f.name || '').toLowerCase();
    if (n.includes('apt') || n.includes('appart')) chosen = SAMPLE_PLAN_DATA.apartment;
    else if (n.includes('town') || n.includes('rij')) chosen = SAMPLE_PLAN_DATA.townhouse;
    else { const idx = Math.abs(f.size || 0) % keys.length; chosen = SAMPLE_PLAN_DATA[keys[idx]]; }

    setData(chosen);
    setState('processing');
    setStepIdx(0);

    let i = 0;
    const tick = () => {
      if (i >= steps.length) { setTimeout(() => setState('results'), 400); return; }
      setStepIdx(i);
      setTimeout(() => { i++; tick(); }, delays[i] || 1000);
    };
    setTimeout(tick, 300);
  };

  const handleFile = (f: File) => {
    if (!f) return;
    const mock: MockFile = { name: f.name, size: f.size, type: f.type };
    setFile(mock);
    setPreviewUrl(f.type?.startsWith('image/') ? URL.createObjectURL(f) : null);
    beginProcessing(f);
  };

  const onSample = () => {
    const s: MockFile = { name: 'sample-villa-ixelles.pdf', size: 234567, type: 'application/pdf' };
    setFile(s);
    setPreviewUrl(null);
    beginProcessing(s);
  };

  const reset = () => {
    setState('idle');
    setFile(null);
    setPreviewUrl(null);
    setStepIdx(-1);
    setData(null);
    setEmailed(false);
    setEmailValue('');
  };

  if (state === 'idle') return (
    <div
      className={`demo-zone upload${dragOver ? ' drag-over' : ''}`}
      onClick={() => inputRef.current?.click()}
      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f); }}
      style={{ cursor: 'pointer' }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,.tiff,image/*,application/pdf"
        style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
      />
      <div className="upload-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="17 8 12 3 7 8"/>
          <line x1="12" y1="3" x2="12" y2="15"/>
        </svg>
      </div>
      <div className="upload-title">{t.drop_title}</div>
      <p className="upload-sub">{t.drop_sub}</p>
      <button className="btn btn-primary" onClick={e => { e.stopPropagation(); inputRef.current?.click(); }}>{t.drop_btn}</button>
      <div>
        <span className="upload-sample-link" onClick={e => { e.stopPropagation(); onSample(); }}>{t.drop_sample}</span>
      </div>
      <p className="upload-formats">{t.drop_note}</p>
    </div>
  );

  if (state === 'processing') return (
    <div className="demo-zone processing">
      <div className="processing-layout">
        <div className="plan-preview">
          {previewUrl
            ? <img src={previewUrl} alt="plan"/>
            : <div className="placeholder-doc"><i/><i/><i/><i/></div>}
          <div className="scan-line"/>
          {file && <div className="file-label">{file.name}</div>}
        </div>
        <div>
          <div className="result-header" style={{ marginBottom: 16 }}>
            <span className="label">{t.label}</span>
            <span className="status" style={{ color: 'var(--accent)' }}>
              {Math.round(((stepIdx + 1) / steps.length) * 100)}%
            </span>
          </div>
          <ul className="processing-steps">
            {steps.map((s, i) => (
              <li key={i} className={i < stepIdx ? 'done' : i === stepIdx ? 'active' : ''}>{s}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );

  if (!data) return null;
  const total = data.area * data.basePrice * data.finishing.coef;
  const lo = total * 0.92;
  const hi = total * 1.08;

  return (
    <div className="demo-zone results">
      <div className="result-layout">
        <div className="plan-preview" style={{ maxHeight: 280 }}>
          {previewUrl
            ? <img src={previewUrl} alt="plan"/>
            : <div className="placeholder-doc"><i/><i/><i/><i/></div>}
          {file && <div className="file-label">{file.name}</div>}
        </div>
        <div className="result-block">
          <div className="result-header">
            <span className="label">{t.result_label}</span>
            <span className="status">{t.label}</span>
          </div>
          <div className="result-row">
            <span className="k">{t.result_area}</span>
            <span className="v">{fmtArea(data.area)}</span>
          </div>
          <div className="result-row">
            <span className="k">{t.result_finishing}</span>
            <span className="v"><span className={`finishing-badge ${data.finishing.cls}`}>{data.finishing.level}</span></span>
          </div>
          <div className="result-row" style={{ alignItems: 'baseline' }}>
            <span className="k">{t.result_cost}</span>
            <span style={{ textAlign: 'right' }}>
              <div className="v big">{fmtEUR(total)}</div>
              <div className="range">{t.result_range}: {fmtEUR(lo)} – {fmtEUR(hi)}</div>
            </span>
          </div>
        </div>
      </div>

      <div className={`email-gate${emailed ? '' : ' locked'}`}>
        {!emailed ? (
          <>
            <h4>{t.gate_title}</h4>
            <p>{t.gate_sub}</p>
            <div className="gate-form">
              <input
                type="email"
                placeholder={t.gate_placeholder}
                value={emailValue}
                onChange={e => setEmailValue(e.target.value)}
              />
              <button
                className="btn btn-primary"
                onClick={() => { if (emailValue.match(/.+@.+\..+/)) setEmailed(true); }}
              >{t.gate_btn}</button>
            </div>
          </>
        ) : (
          <div className="success">{t.gate_after}</div>
        )}
      </div>

      {emailed && <DetailedReport data={data} />}

      <div style={{ marginTop: 24, display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
        <button className="btn btn-secondary" onClick={reset}>↺ Try another plan</button>
      </div>
    </div>
  );
}
