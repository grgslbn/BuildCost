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
    label: string; title: string[]; sub: string[]; bullets: string[];
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
        { tag: '€', h: 'ABEX-indexed rebuild cost', p: 'Regional construction costs, current ABEX index and finishing level — combined into one precise estimate.', stat: 'Updated every semester · postcode-aware' },
        { tag: '↻', h: 'Trained on your dossiers', p: 'Upload reference dossiers with known prices. The model learns your portfolio and gets sharper every week.', stat: 'Per-tenant weights · refines monthly' },
        { tag: '⌂', h: 'Building type, auto-classified', p: 'Villa, apartment, duplex, terraced, studio — the model picks the right estimation profile.', stat: '7 building types · auto-detected' },
        { tag: '📄', h: 'Clear PDF report', p: 'Rebuild cost, finishing level and key parameters — summarised in a clean report you can share straight away.', stat: 'PDF export · ready to share' },
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
      label: 'Made for Belgium', title: ['ABEX-indexed.', 'Postcode-aware.', 'Expert-validated.'],
      sub: ['Built on Belgian construction cost data.', 'Not a generic calculator with a flag on top.'],
      bullets: ['ABEX construction cost index, refreshed every semester','Regional base prices per m² by postcode — Building cost in a narrow street in Brussels Centre ≠ rural Hainaut','Finishing levels calibrated on Belgian conventions','Plan labels read in NL, FR, EN','Multi-tenant isolation — each insurer\'s data stays separate','GDPR-compliant, EU-hosted, data stays in Belgium'],
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
      badge: 'Beta privée · Belgique · 2026',
      h1_a: 'Coût de reconstruction.', h1_b: "À partir d'un plan.", h1_c: 'En 30 secondes.',
      sub: "Téléchargez un plan. ReBuilt extrait chaque pièce, détecte le niveau de finition et calcule un coût de reconstruction indexé ABEX.",
      try_btn: 'Essayez avec votre plan', try_hint: 'Sans inscription · ~30 sec · gratuit', demo_btn: 'Voir un exemple',
      proof: 'Développé avec des experts belges en assurance · Indexé ABEX · RGPD · Hébergé dans l\'UE',
    },
    trust: { title: 'Utilisé par les équipes sinistres de', logos: ['AssurBel','Cosmos Mutual','Nordlys Re','Verzeker.be','Atrium Risk','Helios Group'] },
    demo: {
      label: 'Démo en direct', title: 'Déposez un plan. Obtenez le coût.',
      sub: "Téléchargement réel. Extraction réelle. Obtenez une estimation globale du coût de reconstruction en 30 secondes — laissez votre e-mail si vous souhaitez le détail pièce par pièce.",
      drop_title: 'Déposez votre plan ici', drop_sub: "ou cliquez pour parcourir — PDF, PNG, JPG jusqu'à 20 MB",
      drop_btn: 'Télécharger un plan', drop_sample: 'ou utiliser un plan d\'exemple →',
      drop_note: 'Votre fichier reste sur cet appareil. Nous ne le conservons que si vous sauvegardez le résultat.',
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
      label: 'Ce que fait ReBuilt', title: 'Trois moteurs. Un seul coût.',
      sub: 'Extraction des surfaces, détection du niveau de finition, prix régionaux — réunis dans une estimation contrôlable.',
      cards: [
        { tag: 'm²', h: 'Extraction précise des surfaces', p: "Détecte l'échelle, segmente les pièces et lit les dimensions sur tous les étages. Couloirs en L inclus.", stat: 'Détection d\'échelle · segmentation des pièces · multi-étages' },
        { tag: 'AI', h: 'Niveau de finition détecté automatiquement', p: 'Nombre de salles de bains, taille de la cuisine, proportions du hall d\'entrée — chaque signal est pondéré sur base de plus de 1.000 dossiers.', stat: 'QQP auto-apprenants · 5 niveaux de finition' },
        { tag: '€', h: 'Coût de reconstruction indexé ABEX', p: 'Coûts de construction régionaux, index ABEX actuel et niveau de finition — combinés en une estimation précise.', stat: 'Mis à jour chaque semestre · sensible au code postal' },
        { tag: '↻', h: 'Entraîné sur vos dossiers', p: 'Téléchargez des dossiers de référence avec des prix connus. Le modèle apprend votre portefeuille et devient plus précis chaque semaine.', stat: 'Pondérations par tenant · affinement mensuel' },
        { tag: '⌂', h: 'Type de bâtiment classé automatiquement', p: 'Villa, appartement, duplex, maison mitoyenne, studio — le modèle choisit automatiquement le bon profil d\'estimation.', stat: '7 types de bâtiments · détection automatique' },
        { tag: '📄', h: 'Rapport PDF clair', p: 'Coût de reconstruction, niveau de finition et paramètres clés — résumés dans un rapport clair, prêt à partager.', stat: 'Export PDF · prêt à partager' },
      ],
    },
    how: {
      label: 'Comment ça fonctionne', title: 'Trois étapes. Trente secondes.',
      sub: 'Pas de visite sur place. Pas de tableur. Juste le plan que votre assuré possède déjà.',
      steps: [
        { tag: 'Télécharger', h: 'Déposez le plan', p: 'PDF, scan, photo — ReBuilt gère aussi les fichiers imparfaits. L\'échelle est détectée automatiquement.', detail: 'plan.pdf · échelle 1:100\n12 pièces · 2 étages · 186,4 m²' },
        { tag: 'Analyser', h: 'L\'AI détecte le niveau de finition', p: 'Configuration des salles de bains, taille de la cuisine, proportions du hall, mentions de matériaux. Coefficient entre 0,70 et 1,50.', detail: 'entrée · 8,2 m² → au-dessus de la moyenne\n2 salles de bains · bain + douche → Confort\ncoefficient · × 1,12' },
        { tag: 'Estimer', h: 'Obtenez le coût de reconstruction', p: 'Surface × base régionale × ABEX × coefficient. Exportable, contrôlable, transparent.', detail: '186,4 m² × € 1.680 × 1,0000 × 1,12\n= € 350.720' },
      ],
    },
    belgium: {
      label: 'Conçu pour la Belgique', title: ['Indexé ABEX.', 'Sensible au code postal.', 'Validé par des experts.'],
      sub: ['Construit sur des données belges de coûts de construction.', 'Pas une calculatrice générique avec un drapeau belge ajouté dessus.'],
      bullets: ['Indice ABEX des coûts de construction, actualisé chaque semestre','Prix régionaux de base au m² par code postal — construire dans une rue étroite du centre de Bruxelles ≠ construire dans le Hainaut rural','Niveaux de finition calibrés selon les conventions belges','Libellés de plans lus en NL, FR et EN','Isolation multi-tenant — les données de chaque assureur restent séparées','Conforme RGPD, hébergé dans l\'UE, données conservées en Belgique'],
      table_title: 'Coefficients de finition', table_head: ['Niveau','Description','Coeff.'],
      table_rows: [['Basique','Matériaux simples, équipement minimal','0,70 – 0,85'],['Standard','Construction neuve belge moyenne','0,85 – 1,00'],['Confort','Finitions qualité, cuisine complète','1,00 – 1,15'],['Luxe','Matériaux haut de gamme, deux SDB','1,15 – 1,35'],['Premium','Tout sur mesure','1,35 – 1,50']],
    },
    faq: {
      label: 'FAQ', title: 'Les questions avant les vôtres.',
      items: [
        { q: "Est-ce un outil d'évaluation immobilière ?", a: "Non. ReBuilt calcule le coût de reconstruction — ce qu'il coûterait de reconstruire le bâtiment à neuf après un sinistre. Le coefficient postal reflète les coûts de construction, pas les prix immobiliers." },
        { q: 'Quels formats de plans acceptez-vous ?', a: 'PDF, PNG, JPG, TIFF. DWG/DXF en feuille de route. Même les plans manuscrits fonctionnent si les étiquettes et dimensions sont lisibles.' },
        { q: 'Quelle est la précision de l\'extraction des m² ?', a: "Sur les plans avec échelle ou cotes claires, plus de 90 % de précision. Sans échelle, nous calibrons avec la largeur standard d'une porte (80 cm)." },
        { q: 'Pouvons-nous entraîner ReBuilt sur nos dossiers ?', a: "Oui — c'est là que ReBuilt devient uniquement vôtre. Importez des dossiers de référence et le modèle apprend votre portefeuille." },
        { q: 'Les données de chaque assureur sont-elles isolées ?', a: 'Oui. Espace de travail isolé par assureur. Sécurité au niveau ligne, hébergé en UE.' },
        { q: 'Combien cela coûte-t-il ?', a: "Gratuit pendant la beta. Ensuite : tarif à l'estimation avec remises au volume. Les bêta-testeurs verrouillent un tarif préférentiel." },
      ],
    },
    cta: {
      label: 'Accès anticipé', title: 'Rejoignez les premiers assureurs sur ReBuilt.',
      sub: 'Gratuit pendant la beta. Vos dossiers entraînent le modèle. Vos retours façonnent le produit.',
      company: "Nom de l'entreprise", email: 'E-mail professionnel', volume: 'Estimations par mois',
      volume_opts: ['1 – 10','10 – 50','50 – 200','200+'],
      region: 'Région', region_opts: ['Bruxelles','Flandre','Wallonie','National'],
      submit: "Demander l'accès beta →",
      perks: ['Onboarding en une semaine','Ligne directe avec l\'équipe','Vos retours façonnent la v1'],
      thanks: '✓ Bien reçu. Nous revenons vers vous sous 48 heures.',
    },
    footer: { tagline: 'Intelligence du coût de reconstruction pour les assureurs belges', links: ['Produit','Comment ça fonctionne','FAQ','Beta','Confidentialité','Contact'], copy: '© 2026 ReBuilt · v0.1 Beta' },
  },
  nl: {
    nav: { product: 'Product', tryit: 'Probeer', faq: 'FAQ', cta: 'Vraag beta aan →' },
    hero: {
      badge: 'Private beta · België · 2026',
      h1_a: 'Heropbouwwaarde.', h1_b: 'Op basis van een plan.', h1_c: 'In 30 seconden.',
      sub: 'Upload een grondplan. ReBuilt haalt elke ruimte eruit, detecteert het afwerkingsniveau en berekent een ABEX-geïndexeerde heropbouwwaarde.',
      try_btn: 'Test met je plan', try_hint: 'Geen registratie · ~30 sec · gratis', demo_btn: 'Bekijk een voorbeeld',
      proof: 'Gebouwd met Belgische verzekeringsexperts · ABEX-geïndexeerd · GDPR · Gehost in de EU',
    },
    trust: { title: 'Vertrouwd door schadeteams bij', logos: ['AssurBel','Cosmos Mutual','Nordlys Re','Verzeker.be','Atrium Risk','Helios Group'] },
    demo: {
      label: 'Live demo', title: 'Sleep een plan erin. Zie meteen de kostprijs.',
      sub: 'Echte upload. Echte extractie. Krijg een heropbouwwaarde op hoog niveau in 30 seconden — laat je e-mailadres achter voor de detailanalyse per ruimte.',
      drop_title: 'Sleep je grondplan hierheen', drop_sub: 'of klik om te bladeren — PDF, PNG, JPG tot 20 MB',
      drop_btn: 'Upload een plan', drop_sample: 'of gebruik een voorbeeldplan →',
      drop_note: 'Je bestand blijft op dit toestel. We bewaren het alleen als je het resultaat opslaat.',
      step_scale: 'Schaal en oriëntatie lezen', step_rooms: 'Ruimtes en afmetingen extraheren',
      step_qqp: 'Afwerkingsparameters analyseren', step_cost: 'Heropbouwwaarde berekenen',
      result_label: 'Raming op hoog niveau', result_area: 'Geschatte bewoonbare oppervlakte',
      result_finishing: 'Gedetecteerd afwerkingsniveau', result_cost: 'Geschatte heropbouwwaarde',
      result_range: 'Betrouwbaarheidsmarge',
      gate_title: 'Volledige ruimte-per-ruimte rapport?',
      gate_sub: 'Laat je werkmail achter en we sturen het detail-PDF — 12 ruimtes, ABEX-geïndexeerde coëfficiënt, audittrail.',
      gate_placeholder: 'werk@bedrijf.be', gate_btn: 'Stuur volledig rapport →',
      gate_after: '✓ Rapport onderweg. Check je inbox over 2 minuten.',
    },
    features: {
      label: 'Wat het doet', title: 'Drie engines. Eén kostprijs.',
      sub: 'Oppervlakte-extractie, detectie van afwerkingsniveau en regionale prijszetting — samengebracht in één controleerbare raming.',
      cards: [
        { tag: 'm²', h: 'Nauwkeurige oppervlakte-extractie', p: 'Detecteert de schaal, segmenteert ruimtes en leest afmetingen over alle verdiepingen. Ook L-vormige gangen inbegrepen.', stat: 'Schaaldetectie · ruimtesegmentatie · meerdere verdiepingen' },
        { tag: 'AI', h: 'Afwerkingsniveau automatisch herkend', p: 'Aantal badkamers, keukengrootte, verhouding inkomhal — elk signaal wordt gewogen op basis van 1.000+ dossiers.', stat: 'Zelflerende QQP\'s · 5 afwerkingsniveaus' },
        { tag: '€', h: 'ABEX-geïndexeerde heropbouwwaarde', p: 'Regionale bouwkosten, actuele ABEX-index en afwerkingsniveau — gecombineerd in één nauwkeurige raming.', stat: 'Elk semester geüpdatet · postcodebewust' },
        { tag: '↻', h: 'Getraind op je eigen dossiers', p: 'Upload referentiedossiers met gekende prijzen. Het model leert je portefeuille kennen en wordt elke week scherper.', stat: 'Weging per tenant · maandelijkse verfijning' },
        { tag: '⌂', h: 'Gebouwtype automatisch geclassificeerd', p: 'Villa, appartement, duplex, rijwoning, studio — het model kiest automatisch het juiste ramingsprofiel.', stat: '7 gebouwtypes · automatisch gedetecteerd' },
        { tag: '📄', h: 'Overzichtelijk PDF-rapport', p: 'Heropbouwwaarde, afwerkingsniveau en de belangrijkste parameters — samengevat in een helder rapport dat je direct kunt doorsturen.', stat: 'PDF-export · klaar om te delen' },
      ],
    },
    how: {
      label: 'Hoe het werkt', title: 'Drie stappen. Dertig seconden.',
      sub: 'Geen plaatsbezoek. Geen spreadsheet. Alleen het plan dat je verzekerde al heeft.',
      steps: [
        { tag: 'Upload', h: 'Laad het grondplan op', p: 'PDF, scan, foto — ReBuilt verwerkt ook rommelige input. De schaal wordt automatisch gedetecteerd.', detail: 'plan.pdf · schaal 1:100\n12 ruimtes · 2 verdiepingen · 186,4 m²' },
        { tag: 'Analyse', h: 'AI detecteert het afwerkingsniveau', p: 'Badkamerconfiguratie, keukengrootte, verhoudingen van de inkomhal, materiaalvermeldingen. Coëfficiënt tussen 0,70 en 1,50.', detail: 'inkom · 8,2 m² → boven gemiddeld\n2 badkamers · bad + douche → Comfort\ncoëfficiënt · × 1,12' },
        { tag: 'Raming', h: 'Ontvang de heropbouwwaarde', p: 'Oppervlakte × regionale basis × ABEX × coëfficiënt. Exporteerbaar, controleerbaar en transparant.', detail: '186,4 m² × € 1.680 × 1,0000 × 1,12\n= € 350.720' },
      ],
    },
    belgium: {
      label: 'Gemaakt voor België', title: ['ABEX-geïndexeerd.', 'Postcodebewust.', 'Gevalideerd door experts.'],
      sub: ['Gebouwd op Belgische bouwkostgegevens.', 'Geen generieke calculator met een Belgische vlag erop.'],
      bullets: ['ABEX-bouwkostenindex, elk semester vernieuwd','Regionale basisprijzen per m² per postcode — bouwen in een smalle straat in Brussel-Centrum ≠ landelijk Henegouwen','Afwerkingsniveaus afgestemd op Belgische conventies','Planlabels gelezen in NL, FR en EN','Multi-tenant isolatie — de data van elke verzekeraar blijft gescheiden','GDPR-conform, gehost in de EU, data blijft in België'],
      table_title: 'Afwerkingscoëfficiënten', table_head: ['Niveau','Beschrijving','Coëff.'],
      table_rows: [['Basis','Eenvoudige materialen, minimale uitrusting','0,70 – 0,85'],['Standaard','Gemiddelde Belgische nieuwbouw','0,85 – 1,00'],['Comfort','Kwaliteitsafwerking, volledige keuken','1,00 – 1,15'],['Luxe','High-end materialen, twee badkamers','1,15 – 1,35'],['Premium','Alles op maat','1,35 – 1,50']],
    },
    faq: {
      label: 'FAQ', title: 'Vragen vóór die van jou.',
      items: [
        { q: 'Is dit een vastgoedwaarderingstool?', a: 'Nee. ReBuilt berekent de heropbouwwaarde — wat het zou kosten om het gebouw volledig opnieuw op te bouwen na een schadegeval. De postcodecoëfficiënt weerspiegelt bouwkosten, geen vastgoedprijzen.' },
        { q: 'Welke planformaten aanvaarden jullie?', a: 'PDF, PNG, JPG, TIFF. DWG/DXF op de roadmap. Zelfs handgetekende plannen werken als de labels en afmetingen leesbaar zijn.' },
        { q: 'Hoe nauwkeurig is de m²-extractie?', a: 'Op plannen met duidelijke schaal of afmetingen halen we 95%+. Zonder schaal kalibreren we op standaard maten als diepte van de keuken en breedte van een deur.' },
        { q: 'Kunnen we ReBuilt trainen op onze dossiers?', a: 'Ja — dat is waar ReBuilt uniek wordt. Upload referentiedossiers en het model leert je portefeuille.' },
        { q: 'Is de data van elke verzekeraar geïsoleerd?', a: 'Ja. Geïsoleerde werkruimte per verzekeraar. Row-level security, EU-hosted.' },
        { q: 'Wat kost het?', a: 'Gratis tijdens beta. Daarna: tarief per schatting met volumekortingen. Beta-testers blokkeren een voorkeurstarief.' },
      ],
    },
    cta: {
      label: 'Early access', title: 'Word een van de eerste verzekeraars op ReBuilt.',
      sub: 'Gratis tijdens de beta. Je dossiers trainen het model. Je feedback vormt het product.',
      company: 'Bedrijfsnaam', email: 'Werkmail', volume: 'Ramingen per maand',
      volume_opts: ['1 – 10','10 – 50','50 – 200','200+'],
      region: 'Regio', region_opts: ['Brussel','Vlaanderen','Wallonië','Nationaal'],
      submit: 'Vraag beta-toegang aan →',
      perks: ['Onboarding in één week','Directe lijn met het team','Jouw feedback vormt v1'],
      thanks: '✓ Ontvangen. We nemen binnen 48 uur contact op.',
    },
    footer: { tagline: 'Reconstruction cost intelligence voor Belgische verzekeraars', links: ['Product','Hoe het werkt','FAQ','Beta','Privacy','Contact'], copy: '© 2026 ReBuilt · v0.1 Beta' },
  },
};
