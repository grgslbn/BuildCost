export type Lang = 'en' | 'fr' | 'nl';

export interface LandingI18N {
  nav: { product: string; tryit: string; faq: string; cta: string };
  hero: {
    badge: string; h1_a: string; h1_b: string; h1_c: string; sub: string;
    try_btn: string; try_hint: string; demo_btn: string; proof: string;
  };
  trust: { title: string; logos: string[] };
  demo: {
    label: string; title: string; sub: string;
    drop_title: string; drop_sub: string; drop_btn: string; drop_sample: string; drop_note: string;
    step_scale: string; step_rooms: string; step_qqp: string; step_cost: string;
    result_label: string; result_area: string; result_finishing: string;
    result_cost: string; result_range: string;
    gate_title: string; gate_sub: string; gate_placeholder: string; gate_btn: string; gate_after: string;
  };
  features: {
    label: string; title: string; sub: string;
    cards: { tag: string; h: string; p: string; stat: string }[];
  };
  how: {
    label: string; title: string; sub: string;
    steps: { tag: string; h: string; p: string; detail: string }[];
  };
  belgium: {
    label: string; title: string; sub: string; bullets: string[];
    table_title: string; table_head: string[];
    table_rows: [string, string, string][];
  };
  faq: { label: string; title: string; items: { q: string; a: string }[] };
  cta: {
    label: string; title: string; sub: string;
    company: string; email: string; volume: string; volume_opts: string[];
    region: string; region_opts: string[];
    submit: string; perks: string[]; thanks: string;
  };
  footer: { tagline: string; links: string[]; copy: string };
}

export const I18N: Record<Lang, LandingI18N> = {
  en: {
    nav: { product: 'Product', tryit: 'Try it free', faq: 'FAQ', cta: 'Request beta →' },
    hero: {
      badge: 'Private beta · Belgium · 2026',
      h1_a: 'Reconstruction cost.', h1_b: 'From a plan.', h1_c: 'In 30 seconds.',
      sub: 'Upload a floor plan. ReBuilt extracts every room, detects the finishing level, and returns an ABEX-indexed rebuild cost.',
      try_btn: 'Try with your plan', try_hint: 'No signup · ~30s · free', demo_btn: 'See it on a sample',
      proof: 'Built with Belgian insurance experts · ABEX-indexed · GDPR · EU-hosted',
    },
    trust: { title: 'Trusted by claims teams at', logos: ['AssurBel','Cosmos Mutual','Nordlys Re','Verzeker.be','Atrium Risk','Helios Group'] },
    demo: {
      label: 'Live demo', title: 'Drop a plan. See the cost.',
      sub: 'Real upload. Real extraction. Get a high-level rebuild cost in 30 seconds — leave your email if you want the room-by-room breakdown.',
      drop_title: 'Drop your floor plan here', drop_sub: 'or click to browse — PDF, PNG, JPG up to 20 MB',
      drop_btn: 'Upload a plan', drop_sample: 'or use a sample plan →',
      drop_note: 'Your file stays on this device. We only store it if you save the result.',
      step_scale: 'Reading scale & orientation', step_rooms: 'Extracting rooms & dimensions',
      step_qqp: 'Analysing finishing parameters', step_cost: 'Calculating reconstruction cost',
      result_label: 'High-level estimate', result_area: 'Estimated livable area',
      result_finishing: 'Detected finishing level', result_cost: 'Estimated rebuild cost',
      result_range: 'Confidence range',
      gate_title: 'Want the full room-by-room report?',
      gate_sub: "Leave your work email and we'll send the detailed PDF — 12 rooms, ABEX-indexed coefficient, audit trail.",
      gate_placeholder: 'work@company.be', gate_btn: 'Send full report →',
      gate_after: '✓ Report on its way. Check your inbox in 2 minutes.',
    },
    features: {
      label: 'What it does', title: 'Three engines. One cost.',
      sub: 'Surface extraction, finishing detection, regional pricing — fused into one auditable estimate.',
      cards: [
        { tag: 'm²', h: 'Precise surface extraction', p: 'Detects scale, segments rooms, reads dimensions across all floors. L-shaped corridors included.', stat: 'Scale detection · room segmentation · multi-floor' },
        { tag: 'AI', h: 'Finishing level, discovered', p: 'Bathroom count, kitchen size, entrance hall proportions — every signal weighted from 1 000+ dossiers.', stat: 'Self-learning QQPs · 5 finishing levels' },
        { tag: '€', h: 'ABEX-indexed rebuild cost', p: 'Surface × regional base × ABEX × finishing coefficient. Belgian postcodes, current index, no guesswork.', stat: 'Updated every semester · postcode-aware' },
        { tag: '↻', h: 'Trained on your dossiers', p: 'Upload reference dossiers with known prices. The model learns your portfolio and gets sharper every week.', stat: 'Per-tenant weights · refines monthly' },
        { tag: '⌂', h: 'Building type, auto-classified', p: 'Villa, apartment, duplex, terraced, studio — the model picks the right estimation profile.', stat: '7 building types · auto-detected' },
        { tag: '📄', h: 'Auditable PDF report', p: 'Room-by-room areas, detected QQPs, finishing justification, formula trail. Validation-ready.', stat: 'PDF export · audit trail' },
      ],
    },
    how: {
      label: 'How it works', title: 'Three steps. Thirty seconds.',
      sub: 'No site visit. No spreadsheet. Just the plan your insured already has.',
      steps: [
        { tag: 'Upload', h: 'Drop in the floor plan', p: 'PDF, scan, photo — ReBuilt handles messy inputs. Scale detected automatically.', detail: 'plan.pdf · scale 1:100\n12 rooms · 2 floors · 186.4 m²' },
        { tag: 'Analyse', h: 'AI detects the finishing level', p: 'Bathroom config, kitchen size, hall proportions, material mentions. Coefficient between 0.70 and 1.50.', detail: 'entrance · 8.2 m² → above avg\n2 bath · bath + shower → Comfort\ncoefficient · × 1.12' },
        { tag: 'Estimate', h: 'Get the rebuild cost', p: 'Surface × regional base × ABEX × coefficient. Exportable, auditable, transparent.', detail: '186.4 m² × € 1 680 × 1.0000 × 1.12\n= € 350 720' },
      ],
    },
    belgium: {
      label: 'Made for Belgium', title: 'ABEX-indexed. Postcode-aware. Expert-validated.',
      sub: 'Built on Belgian construction cost data. Not a generic calculator with a flag on top.',
      bullets: ['ABEX construction cost index, refreshed every semester','Regional base prices per m² by postcode — Brussels ≠ Charleroi','Finishing levels calibrated on Belgian conventions','Plan labels read in NL, FR, EN','Multi-tenant isolation — each insurer\'s data stays separate','GDPR-compliant, EU-hosted, data stays in Belgium'],
      table_title: 'Finishing coefficients', table_head: ['Level','Description','Coeff.'],
      table_rows: [['Basic','Simple materials, minimal equipment','0.70 – 0.85'],['Standard','Average Belgian new build','0.85 – 1.00'],['Comfort','Quality finishes, full kitchen','1.00 – 1.15'],['Luxury','High-end materials, two bathrooms','1.15 – 1.35'],['Premium','Custom everything','1.35 – 1.50']],
    },
    faq: {
      label: 'FAQ', title: 'Questions before yours.',
      items: [
        { q: 'Is this a real estate valuation tool?', a: 'No. ReBuilt calculates the reconstruction cost — what it would cost to rebuild the building from scratch after a loss. The postcode coefficient reflects construction costs, not property prices.' },
        { q: 'What plan formats do you accept?', a: 'PDF, PNG, JPG, TIFF. DWG/DXF on the roadmap. Even hand-drawn plans work if labels and dimensions are clear.' },
        { q: 'How accurate is the m² extraction?', a: 'On plans with clear dimensions or a scale bar, we hit 90%+ accuracy. Without scale, we use the standard 80 cm door width as calibration.' },
        { q: 'Can we train ReBuilt on our dossiers?', a: "Yes — that's where ReBuilt becomes uniquely yours. Upload reference dossiers and the system refines its weights for your portfolio." },
        { q: "Is each insurer's data isolated?", a: 'Yes. Each insurance company gets an isolated workspace. Row-level security, EU-hosted.' },
        { q: 'What does it cost?', a: 'Free during the beta. After: a per-estimation fee with volume discounts. Beta testers lock in preferential pricing.' },
      ],
    },
    cta: {
      label: 'Early access', title: 'Join the first insurers on ReBuilt.',
      sub: 'Free during beta. Your dossiers train the model. Your feedback shapes the product.',
      company: 'Company name', email: 'Work email', volume: 'Estimations per month',
      volume_opts: ['1 – 10','10 – 50','50 – 200','200+'],
      region: 'Region', region_opts: ['Brussels','Flanders','Wallonia','National'],
      submit: 'Request beta access →',
      perks: ['One-week onboarding','Direct line to the team','Your feedback shapes v1'],
      thanks: "✓ Got it. We'll reach out within 48 hours.",
    },
    footer: { tagline: 'Reconstruction cost intelligence for Belgian insurers', links: ['Product','How it works','FAQ','Beta','Privacy','Contact'], copy: '© 2026 ReBuilt · v0.1 Beta' },
  },
  fr: {
    nav: { product: 'Produit', tryit: 'Essayer', faq: 'FAQ', cta: 'Demander la bêta →' },
    hero: {
      badge: 'Bêta privée · Belgique · 2026',
      h1_a: 'Coût de reconstruction.', h1_b: "À partir d'un plan.", h1_c: 'En 30 secondes.',
      sub: "Importez un plan. ReBuilt extrait chaque pièce, détecte le niveau de finition et renvoie un coût de reconstruction indexé ABEX.",
      try_btn: 'Essayer avec votre plan', try_hint: 'Sans inscription · ~30s · gratuit', demo_btn: 'Voir un exemple',
      proof: 'Construit avec des experts en assurance belges · indexé ABEX · RGPD · hébergé UE',
    },
    trust: { title: 'Utilisé par les équipes sinistres de', logos: ['AssurBel','Cosmos Mutual','Nordlys Re','Verzeker.be','Atrium Risk','Helios Group'] },
    demo: {
      label: 'Démo en direct', title: 'Déposez un plan. Voyez le coût.',
      sub: "Import réel. Extraction réelle. Coût de haut niveau en 30 secondes — laissez votre email pour le détail pièce par pièce.",
      drop_title: 'Déposez votre plan ici', drop_sub: "ou cliquez pour parcourir — PDF, PNG, JPG jusqu'à 20 Mo",
      drop_btn: 'Importer un plan', drop_sample: "ou utilisez un plan d'exemple →",
      drop_note: 'Votre fichier reste sur cet appareil. Nous ne le stockons que si vous sauvegardez le résultat.',
      step_scale: "Lecture de l'échelle et de l'orientation", step_rooms: 'Extraction des pièces et dimensions',
      step_qqp: 'Analyse des paramètres de finition', step_cost: 'Calcul du coût de reconstruction',
      result_label: 'Estimation de haut niveau', result_area: 'Surface habitable estimée',
      result_finishing: 'Niveau de finition détecté', result_cost: 'Coût de reconstruction estimé',
      result_range: 'Plage de confiance',
      gate_title: 'Le rapport détaillé pièce par pièce ?',
      gate_sub: 'Laissez votre email professionnel et nous envoyons le PDF détaillé — 12 pièces, coefficient indexé ABEX, traçabilité.',
      gate_placeholder: 'travail@entreprise.be', gate_btn: 'Envoyer le rapport →',
      gate_after: '✓ Rapport en route. Vérifiez votre boîte dans 2 minutes.',
    },
    features: {
      label: "Ce qu'il fait", title: 'Trois moteurs. Un coût.',
      sub: 'Extraction de surface, détection des finitions, prix régionaux — fusionnés en une estimation auditable.',
      cards: [
        { tag: 'm²', h: 'Extraction de surface précise', p: "Détecte l'échelle, segmente les pièces, lit les dimensions sur tous les étages.", stat: 'Échelle · segmentation · multi-étages' },
        { tag: 'IA', h: 'Niveau de finition découvert', p: 'Nombre de SDB, taille de cuisine, hall — chaque signal pondéré à partir de 1 000+ dossiers.', stat: 'QQP auto-apprenants · 5 niveaux' },
        { tag: '€', h: 'Coût indexé ABEX', p: 'Surface × base régionale × ABEX × coefficient. Codes postaux belges, indice courant.', stat: 'Mis à jour chaque semestre' },
        { tag: '↻', h: 'Entraîné sur vos dossiers', p: 'Importez des dossiers de référence avec prix connus. Le modèle apprend votre portefeuille.', stat: 'Poids par tenant · raffiné mensuellement' },
        { tag: '⌂', h: 'Type de bâtiment auto-classé', p: 'Villa, appartement, duplex, maison mitoyenne, studio — le modèle choisit le bon profil.', stat: '7 types · auto-détecté' },
        { tag: '📄', h: 'Rapport PDF auditable', p: 'Surfaces pièce par pièce, QQP détectés, justification, formule. Prêt pour validation.', stat: 'Export PDF · traçabilité' },
      ],
    },
    how: {
      label: 'Comment ça marche', title: 'Trois étapes. Trente secondes.',
      sub: 'Pas de visite sur site. Pas de tableur. Juste le plan que votre assuré a déjà.',
      steps: [
        { tag: 'Import', h: 'Déposez le plan', p: 'PDF, scan, photo — ReBuilt gère les entrées brouillonnes. Échelle détectée automatiquement.', detail: 'plan.pdf · échelle 1:100\n12 pièces · 2 étages · 186,4 m²' },
        { tag: 'Analyse', h: "L'IA détecte la finition", p: 'Configuration SDB, taille cuisine, proportions hall, matériaux. Coefficient 0,70 à 1,50.', detail: 'hall · 8,2 m² → au-dessus moy.\n2 sdb · bain + douche → Confort\ncoefficient · × 1,12' },
        { tag: 'Estimation', h: 'Obtenez le coût', p: 'Surface × base régionale × ABEX × coefficient. Exportable, auditable, transparent.', detail: '186,4 m² × € 1 680 × 1,0000 × 1,12\n= € 350 720' },
      ],
    },
    belgium: {
      label: 'Conçu pour la Belgique', title: 'Indexé ABEX. Code postal. Expert-validé.',
      sub: 'Construit sur les données de coûts belges. Pas un calculateur générique avec un drapeau.',
      bullets: ['Indice ABEX, rafraîchi chaque semestre','Prix de base régionaux par code postal — Bruxelles ≠ Charleroi','Niveaux de finition calibrés sur les conventions belges','Étiquettes lues en NL, FR, EN','Isolation multi-tenant — les données de chaque assureur restent séparées','RGPD, hébergé UE, données en Belgique'],
      table_title: 'Coefficients de finition', table_head: ['Niveau','Description','Coeff.'],
      table_rows: [['Basique','Matériaux simples, équipement minimal','0,70 – 0,85'],['Standard','Construction neuve belge moyenne','0,85 – 1,00'],['Confort','Finitions qualité, cuisine complète','1,00 – 1,15'],['Luxe','Matériaux haut de gamme, deux SDB','1,15 – 1,35'],['Premium','Tout sur mesure','1,35 – 1,50']],
    },
    faq: {
      label: 'FAQ', title: 'Vos questions, anticipées.',
      items: [
        { q: "Est-ce un outil d'évaluation immobilière ?", a: "Non. ReBuilt calcule le coût de reconstruction — ce qu'il en coûterait pour rebâtir après un sinistre. Le coefficient reflète les coûts de construction, pas les prix immobiliers." },
        { q: 'Quels formats de plan acceptez-vous ?', a: 'PDF, PNG, JPG, TIFF. DWG/DXF en feuille de route. Même les plans manuscrits fonctionnent si les étiquettes et dimensions sont lisibles.' },
        { q: 'Quelle précision sur les m² ?', a: "Sur les plans avec échelle ou cotes claires, plus de 90 % de précision. Sans échelle, nous calibrons avec la largeur standard d'une porte (80 cm)." },
        { q: 'Peut-on entraîner ReBuilt sur nos dossiers ?', a: "Oui — c'est là que ReBuilt devient unique. Importez des dossiers de référence et le modèle apprend votre portefeuille." },
        { q: 'Les données de chaque assureur sont-elles isolées ?', a: 'Oui. Espace de travail isolé par assureur. Sécurité au niveau ligne, hébergé en UE.' },
        { q: 'Combien ça coûte ?', a: "Gratuit pendant la bêta. Ensuite : tarif à l'estimation avec remises au volume. Les bêta-testeurs verrouillent un tarif préférentiel." },
      ],
    },
    cta: {
      label: 'Accès anticipé', title: 'Rejoignez les premiers assureurs sur ReBuilt.',
      sub: 'Gratuit pendant la bêta. Vos dossiers entraînent le modèle. Vos retours façonnent le produit.',
      company: "Nom de l'entreprise", email: 'Email professionnel', volume: 'Estimations par mois',
      volume_opts: ['1 – 10','10 – 50','50 – 200','200+'],
      region: 'Région', region_opts: ['Bruxelles','Flandre','Wallonie','National'],
      submit: "Demander l'accès bêta →",
      perks: ['Onboarding en une semaine','Ligne directe avec l\'équipe','Vos retours façonnent v1'],
      thanks: '✓ Bien reçu. Nous revenons vers vous sous 48 heures.',
    },
    footer: { tagline: 'Intelligence du coût de reconstruction pour les assureurs belges', links: ['Produit','Comment ça marche','FAQ','Bêta','Confidentialité','Contact'], copy: '© 2026 ReBuilt · v0.1 Bêta' },
  },
  nl: {
    nav: { product: 'Product', tryit: 'Probeer', faq: 'FAQ', cta: 'Vraag beta aan →' },
    hero: {
      badge: 'Private beta · België · 2026',
      h1_a: 'Heropbouwkost.', h1_b: 'Vanuit een plan.', h1_c: 'In 30 seconden.',
      sub: 'Upload een grondplan. ReBuilt leest elke kamer, detecteert het afwerkingsniveau en geeft een ABEX-geïndexeerde heropbouwkost.',
      try_btn: 'Probeer met uw plan', try_hint: 'Geen account · ~30s · gratis', demo_btn: 'Bekijk een voorbeeld',
      proof: 'Gebouwd met Belgische verzekeringsexperts · ABEX-geïndexeerd · GDPR · EU-hosted',
    },
    trust: { title: 'Vertrouwd door schadeteams bij', logos: ['AssurBel','Cosmos Mutual','Nordlys Re','Verzeker.be','Atrium Risk','Helios Group'] },
    demo: {
      label: 'Live demo', title: 'Drop een plan. Zie de kost.',
      sub: 'Echte upload. Echte extractie. High-level heropbouwkost in 30 seconden — laat uw e-mail voor de detail-rapportage per kamer.',
      drop_title: 'Sleep uw grondplan hierheen', drop_sub: 'of klik om te bladeren — PDF, PNG, JPG tot 20 MB',
      drop_btn: 'Upload een plan', drop_sample: 'of gebruik een voorbeeldplan →',
      drop_note: 'Uw bestand blijft op dit apparaat. We bewaren het alleen als u het resultaat opslaat.',
      step_scale: 'Schaal en oriëntatie lezen', step_rooms: 'Kamers en afmetingen extraheren',
      step_qqp: 'Afwerkingsparameters analyseren', step_cost: 'Heropbouwkost berekenen',
      result_label: 'High-level schatting', result_area: 'Geschatte bewoonbare oppervlakte',
      result_finishing: 'Gedetecteerd afwerkingsniveau', result_cost: 'Geschatte heropbouwkost',
      result_range: 'Betrouwbaarheidsmarge',
      gate_title: 'Volledige kamer-per-kamer rapport?',
      gate_sub: 'Laat uw werkmail en we sturen het detail-PDF — 12 kamers, ABEX-geïndexeerde coëfficiënt, audittrail.',
      gate_placeholder: 'werk@bedrijf.be', gate_btn: 'Stuur volledig rapport →',
      gate_after: '✓ Rapport onderweg. Check uw inbox over 2 minuten.',
    },
    features: {
      label: 'Wat het doet', title: 'Drie motoren. Eén kost.',
      sub: 'Oppervlakte-extractie, afwerkingsdetectie, regionale prijzen — gefuseerd in één auditbare schatting.',
      cards: [
        { tag: 'm²', h: 'Precieze oppervlakte', p: 'Detecteert schaal, segmenteert kamers, leest afmetingen over alle verdiepingen.', stat: 'Schaal · segmentatie · multi-verdieping' },
        { tag: 'AI', h: 'Afwerking ontdekt', p: 'Aantal badkamers, keukengrootte, inkomhal — elk signaal gewogen vanuit 1 000+ dossiers.', stat: 'Zelflerende QQPs · 5 niveaus' },
        { tag: '€', h: 'ABEX-geïndexeerde kost', p: 'Oppervlakte × regionale basis × ABEX × coëfficiënt. Belgische postcodes.', stat: 'Per semester bijgewerkt' },
        { tag: '↻', h: 'Getraind op uw dossiers', p: 'Upload referentiedossiers met gekende prijzen. Het model leert uw portefeuille.', stat: 'Tenant-gewichten · maandelijks verfijnd' },
        { tag: '⌂', h: 'Gebouwtype auto-detectie', p: 'Villa, appartement, duplex, rijwoning, studio — het model kiest het juiste profiel.', stat: '7 types · automatisch' },
        { tag: '📄', h: 'Auditbaar PDF-rapport', p: 'Kamer-per-kamer, gedetecteerde QQPs, motivering, formule. Validatie-klaar.', stat: 'PDF-export · audittrail' },
      ],
    },
    how: {
      label: 'Hoe het werkt', title: 'Drie stappen. Dertig seconden.',
      sub: 'Geen plaatsbezoek. Geen Excel. Gewoon het plan dat uw verzekerde al heeft.',
      steps: [
        { tag: 'Upload', h: 'Drop het grondplan', p: 'PDF, scan, foto — ReBuilt verwerkt rommelige input. Schaal automatisch gedetecteerd.', detail: 'plan.pdf · schaal 1:100\n12 kamers · 2 verdiepingen · 186,4 m²' },
        { tag: 'Analyse', h: 'AI detecteert afwerking', p: 'Badkamerconfiguratie, keukengrootte, hal-verhoudingen, materialen. Coëfficiënt 0,70–1,50.', detail: 'hal · 8,2 m² → boven gem.\n2 bad · bad + douche → Comfort\ncoëfficiënt · × 1,12' },
        { tag: 'Schatting', h: 'Krijg de kost', p: 'Oppervlakte × regionale basis × ABEX × coëfficiënt. Exporteerbaar, auditbaar.', detail: '186,4 m² × € 1 680 × 1,0000 × 1,12\n= € 350 720' },
      ],
    },
    belgium: {
      label: 'Gemaakt voor België', title: 'ABEX-geïndexeerd. Postcode-gericht. Expert-gevalideerd.',
      sub: 'Gebouwd op Belgische bouwkostdata. Geen generieke calculator met een vlag.',
      bullets: ['ABEX bouwkostindex, elk semester ververst','Regionale basisprijzen per postcode — Brussel ≠ Charleroi','Afwerkingsniveaus gekalibreerd op Belgische conventies','Etiketten in NL, FR, EN gelezen','Multi-tenant isolatie — data van elke verzekeraar apart','GDPR, EU-hosted, data blijft in België'],
      table_title: 'Afwerkingscoëfficiënten', table_head: ['Niveau','Beschrijving','Coëff.'],
      table_rows: [['Basis','Eenvoudige materialen, minimale uitrusting','0,70 – 0,85'],['Standaard','Gemiddelde Belgische nieuwbouw','0,85 – 1,00'],['Comfort','Kwaliteitsafwerking, volledige keuken','1,00 – 1,15'],['Luxe','High-end materialen, twee badkamers','1,15 – 1,35'],['Premium','Alles op maat','1,35 – 1,50']],
    },
    faq: {
      label: 'FAQ', title: 'Vragen, beantwoord.',
      items: [
        { q: 'Is dit een vastgoedwaardering?', a: 'Nee. ReBuilt berekent de heropbouwkost — wat het zou kosten om het gebouw vanaf nul te herbouwen. De postcode reflecteert bouwkosten, geen vastgoedprijzen.' },
        { q: 'Welke planformaten aanvaarden jullie?', a: 'PDF, PNG, JPG, TIFF. DWG/DXF op de roadmap. Zelfs handgetekende plannen werken als de labels en afmetingen leesbaar zijn.' },
        { q: 'Hoe nauwkeurig zijn de m²?', a: 'Op plannen met duidelijke schaal of afmetingen halen we 90%+. Zonder schaal kalibreren we met de standaard 80 cm deurbreedte.' },
        { q: 'Kunnen we ReBuilt trainen op onze dossiers?', a: 'Ja — dat is waar ReBuilt uniek wordt. Upload referentiedossiers en het model leert uw portefeuille.' },
        { q: 'Is data per verzekeraar geïsoleerd?', a: 'Ja. Geïsoleerde werkruimte per verzekeraar. Row-level security, EU-hosted.' },
        { q: 'Wat kost het?', a: 'Gratis tijdens beta. Daarna: tarief per schatting met volumekortingen. Beta-testers blokkeren een voorkeurstarief.' },
      ],
    },
    cta: {
      label: 'Vroege toegang', title: 'Sluit aan bij de eerste verzekeraars op ReBuilt.',
      sub: 'Gratis tijdens beta. Uw dossiers trainen het model. Uw feedback vormt het product.',
      company: 'Bedrijfsnaam', email: 'Werkmail', volume: 'Schattingen per maand',
      volume_opts: ['1 – 10','10 – 50','50 – 200','200+'],
      region: 'Regio', region_opts: ['Brussel','Vlaanderen','Wallonië','Nationaal'],
      submit: 'Vraag beta-toegang aan →',
      perks: ['Onboarding in één week','Directe lijn met het team','Uw feedback vormt v1'],
      thanks: '✓ Ontvangen. We nemen binnen 48 uur contact op.',
    },
    footer: { tagline: 'Heropbouwkost-intelligentie voor Belgische verzekeraars', links: ['Product','Hoe het werkt','FAQ','Beta','Privacy','Contact'], copy: '© 2026 ReBuilt · v0.1 Beta' },
  },
};
