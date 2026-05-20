'use client';

import { useState, useEffect, useRef } from 'react';
import { ANIM_CARDS, REVEAL_TICK, UPLOAD_BAR, HOLD_END, BETWEEN } from '@/data/samplePlans';

const ticksPerCard = ANIM_CARDS.map(c => 1 + c.rows.length + 2);
const totalTicks = ticksPerCard.reduce((s, x) => s + x, 0);

function stateAtTick(t: number) {
  let rem = t;
  for (let i = 0; i < ANIM_CARDS.length; i++) {
    if (rem < ticksPerCard[i]) return { cardIdx: i, withinCard: rem };
    rem -= ticksPerCard[i];
  }
  return { cardIdx: ANIM_CARDS.length, withinCard: 0 };
}

export default function AnimatedHeroCards() {
  const [tick, setTick] = useState(0);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [activeCardIdx, setActiveCardIdx] = useState(0);
  const tickRef = useRef(0);
  const stopRef = useRef(false);

  useEffect(() => {
    stopRef.current = false;
    let tid: ReturnType<typeof setTimeout>;
    let uid: ReturnType<typeof setTimeout>;

    const startUpload = (ci: number) => {
      setActiveCardIdx(ci);
      setUploadProgress(0);
      let s = 0;
      const steps = 20;
      const ms = UPLOAD_BAR / steps;
      const fill = () => {
        if (stopRef.current) return;
        s++;
        setUploadProgress((s / steps) * 100);
        if (s < steps) uid = setTimeout(fill, ms);
      };
      uid = setTimeout(fill, ms);
    };

    const run = () => {
      if (stopRef.current) return;
      tickRef.current++;
      if (tickRef.current > totalTicks) {
        tid = setTimeout(() => {
          if (stopRef.current) return;
          tickRef.current = 0;
          setTick(0);
          setUploadProgress(0);
          setActiveCardIdx(0);
          startUpload(0);
          tid = setTimeout(run, UPLOAD_BAR / 2);
        }, HOLD_END);
        return;
      }
      setTick(tickRef.current);
      const st = stateAtTick(tickRef.current);
      const prev = stateAtTick(tickRef.current - 1);
      if (st.cardIdx !== prev.cardIdx && st.cardIdx < ANIM_CARDS.length) {
        tid = setTimeout(() => {
          startUpload(st.cardIdx);
          tid = setTimeout(run, UPLOAD_BAR / 2);
        }, BETWEEN);
        return;
      }
      tid = setTimeout(run, REVEAL_TICK);
    };

    startUpload(0);
    tid = setTimeout(run, UPLOAD_BAR / 2);
    return () => { stopRef.current = true; clearTimeout(tid); clearTimeout(uid); };
  }, []);

  const state = stateAtTick(tick);

  return (
    <div className="anim-cards-wrap">
      <div className="anim-upload-bar">
        <div className="anim-upload-icon">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
          </svg>
        </div>
        <div className="anim-upload-meta">
          <div className="anim-upload-file">
            {state.cardIdx < ANIM_CARDS.length ? ANIM_CARDS[activeCardIdx].file : 'queue complete'}
          </div>
          <div className="anim-upload-status">
            {state.cardIdx < ANIM_CARDS.length
              ? `Analysing · ${activeCardIdx + 1} of ${ANIM_CARDS.length}`
              : `${ANIM_CARDS.length} estimates ready`}
          </div>
        </div>
        <div className="anim-upload-track">
          <div
            className="anim-upload-fill"
            style={{ width: state.cardIdx < ANIM_CARDS.length ? uploadProgress + '%' : '100%' }}
          />
        </div>
      </div>

      <div className="anim-cards-stack">
        {ANIM_CARDS.map((card, i) => {
          let rl: number;
          if (i < state.cardIdx) rl = 1 + card.rows.length + 2;
          else if (i === state.cardIdx) rl = state.withinCard;
          else rl = 0;
          const isActive = i === state.cardIdx;
          const isComplete = i < state.cardIdx;
          return (
            <div
              key={i}
              className={`est-card anim-est-card${isActive ? ' is-active' : ''}${isComplete ? ' is-complete' : ''}`}
              data-card-index={i}
            >
              <div className={`card-header${(isActive || rl >= 1) ? ' revealed' : ''}`}>
                <div className="card-brand">Plan Based</div>
                <div className="card-meta">{card.id}<br/>{card.date}</div>
              </div>
              <div className={`card-title${(isActive || rl >= 1) ? ' revealed' : ''}`}>
                Reconstruction estimate · {card.title}
              </div>
              <div className="card-rows">
                {card.rows.map((r, j) => {
                  const shown = rl >= 2 + j;
                  return (
                    <div key={j} className={`card-row${shown ? ' revealed' : ''}`}>
                      <span className="label">{r.label}</span>
                      <span className="value">
                        {typeof r.value === 'object'
                          ? <span className={`finishing-badge ${r.value.cls}`}>{r.value.label}</span>
                          : r.value}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className={`card-total${rl >= 2 + card.rows.length ? ' revealed' : ''}`}>
                <span className="label">{card.total[0]}</span>
                <span className="value">{card.total[1]}</span>
              </div>
              <div className={`card-footer${rl >= 3 + card.rows.length ? ' revealed' : ''}`}>
                <span>{card.footer[0]}</span>
                <span>{card.footer[1]}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
