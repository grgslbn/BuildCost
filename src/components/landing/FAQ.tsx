'use client';

import { useState } from 'react';

interface FAQItem {
  q: string;
  a: string;
}

export default function FAQ({ items }: { items: FAQItem[] }) {
  const [openIdx, setOpenIdx] = useState(0);
  return (
    <div className="faq-list">
      {items.map((it, i) => (
        <div key={i} className={`faq-item${openIdx === i ? ' open' : ''}`}>
          <button className="faq-q" onClick={() => setOpenIdx(openIdx === i ? -1 : i)}>
            <span>{it.q}</span>
            <span className="toggle">+</span>
          </button>
          <div className="faq-a"><p>{it.a}</p></div>
        </div>
      ))}
    </div>
  );
}
