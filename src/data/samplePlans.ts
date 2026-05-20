export type FinishingLevel = 'Basic' | 'Standard' | 'Comfort' | 'Luxury' | 'Premium';

export interface SamplePlan {
  filename: string;
  area: number;
  finishing: { level: FinishingLevel; cls: string; coef: number };
  postcode: string;
  basePrice: number;
  abex: string;
  rooms: [string, number][];
}

export const SAMPLE_PLAN_DATA: Record<string, SamplePlan> = {
  villa: {
    filename: 'plan-villa-ixelles.pdf', area: 186.4,
    finishing: { level: 'Comfort', cls: 'fb-comfort', coef: 1.12 },
    postcode: '1050 Ixelles', basePrice: 1680, abex: '2026/I',
    rooms: [['Living room',42.5],['Kitchen',18.3],['Entrance hall',8.2],['Office',12.1],['Toilet',2.4],['Bathroom 1',9.8],['Bathroom 2',5.6],['Bedroom 1',22.4],['Bedroom 2',16.8],['Bedroom 3',14.2],['Corridor',11.6],['Storage',6.4]],
  },
  apartment: {
    filename: 'plan-apt-gent.pdf', area: 124.8,
    finishing: { level: 'Luxury', cls: 'fb-luxury', coef: 1.28 },
    postcode: '9000 Gent', basePrice: 1520, abex: '2026/I',
    rooms: [['Living room',38.2],['Kitchen',16.4],['Entrance hall',5.8],['Bathroom 1',11.2],['Bathroom 2',6.4],['Bedroom 1',18.6],['Bedroom 2',14.0],['Corridor',8.8],['Terrace',5.4]],
  },
  townhouse: {
    filename: 'plan-rijwoning-liege.pdf', area: 98.2,
    finishing: { level: 'Standard', cls: 'fb-standard', coef: 0.94 },
    postcode: '4000 Liège', basePrice: 1440, abex: '2026/I',
    rooms: [['Living room',28.4],['Kitchen',11.2],['Entrance',4.6],['Bathroom',6.8],['Bedroom 1',14.8],['Bedroom 2',11.4],['Bedroom 3',9.6],['Corridor',7.8],['Storage',3.6]],
  },
};

export interface AnimCardRow {
  label: string;
  value: string | { cls: string; label: string };
}

export interface AnimCard {
  title: string;
  id: string;
  date: string;
  file: string;
  rows: AnimCardRow[];
  total: [string, string];
  footer: [string, string];
}

export const ANIM_CARDS: AnimCard[] = [
  { title: 'Villa', id: 'RB-2026-0847', date: '19·05·2026', file: 'plan-villa-ixelles.pdf',
    rows: [
      { label: 'Bewoonbare oppervlakte', value: '186,4 m²' },
      { label: 'Afwerking', value: { cls: 'fb-comfort', label: 'Comfort' } },
      { label: 'Coëfficiënt', value: '× 1,12' },
      { label: 'Basis · 1050 Elsene', value: '€ 1.680/m²' },
      { label: 'ABEX 2026/I', value: '× 1,0000' },
    ],
    total: ['Heropbouwwaarde', '€ 350.720'], footer: ['rebuilt.be', '12 ruimtes · 2 verdiepingen'] },
  { title: 'Appartement', id: 'RB-2026-0831', date: '18·05·2026', file: 'plan-apt-gent.pdf',
    rows: [
      { label: 'Bewoonbare oppervlakte', value: '124,8 m²' },
      { label: 'Afwerking', value: { cls: 'fb-luxury', label: 'Luxe' } },
      { label: 'Coëfficiënt', value: '× 1,28' },
      { label: 'Basis · 9000 Gent', value: '€ 1.520/m²' },
    ],
    total: ['Heropbouwwaarde', '€ 242.810'], footer: ['rebuilt.be', '8 ruimtes · 1 verdieping'] },
  { title: 'Rijwoning', id: 'RB-2026-0819', date: '17·05·2026', file: 'plan-rijwoning-liege.pdf',
    rows: [
      { label: 'Bewoonbare oppervlakte', value: '98,2 m²' },
      { label: 'Afwerking', value: { cls: 'fb-standard', label: 'Standaard' } },
      { label: 'Coëfficiënt', value: '× 0,94' },
      { label: 'Basis · 4000 Luik', value: '€ 1.440/m²' },
    ],
    total: ['Heropbouwwaarde', '€ 132.780'], footer: ['rebuilt.be', '7 ruimtes · 2 verdiepingen'] },
];

export const REVEAL_TICK = 700;
export const UPLOAD_BAR = 2000;
export const HOLD_END = 7000;
export const BETWEEN = 1800;

export const fmtEUR = (n: number) =>
  '€ ' + Math.round(n).toLocaleString('de-DE');

export const fmtArea = (n: number) =>
  n.toFixed(1).replace('.', ',') + ' m²';
