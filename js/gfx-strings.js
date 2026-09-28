/* Boxes & Lines — strings for the Graphics settings section, per locale.
 * Locale comes from the browser (navigator.languages); lookup falls back
 * exact tag → same language → en-US.
 */

var EN = {
  quality: 'Quality',
  auto: 'Auto (detected: {tier})',
  renderScale: 'Render scale',
  fromPreset: 'From preset ({tier})',
  adaptive: 'Adaptive resolution',
  showFps: 'Show frame rate',
  postFailed: 'Post-processing is unavailable on this device, so the board is drawn without it.',
  unavailable: '3D view unavailable',
  unknownGpu: 'unknown GPU',
  cat: {
    shadows: 'Shadows', ao: 'Ambient occlusion', bloom: 'Bloom', grade: 'Color grade',
    antialias: 'Anti-aliasing', reflections: 'Reflections', detail: 'Surface detail',
    particles: 'Particles', ambient: 'Ambient motion'
  },
  tier: {
    low: 'Low', balanced: 'Balanced', high: 'High', ultra: 'Ultra', medium: 'Medium',
    off: 'Off', on: 'On', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA',
    plain: 'Plain', detailed: 'Detailed', static: 'Still', animated: 'Animated'
  },
  summary: {
    noShadows: 'no shadows', shadows: '{n}² shadows', ao: 'ambient occlusion', aoHigh: 'full ambient occlusion',
    bloom: 'bloom', reflections: 'reflections', noAA: 'no anti-aliasing', px: '{w}×{h} px'
  }
};

function derive(base, over) {
  var out = Object.assign({}, base, over);
  ['cat', 'tier', 'summary'].forEach(function (k) { out[k] = Object.assign({}, base[k], over[k] || {}); });
  return out;
}

var ES = derive(EN, {
  quality: 'Calidad',
  auto: 'Automática (detectada: {tier})',
  renderScale: 'Escala de renderizado',
  fromPreset: 'Según el ajuste ({tier})',
  adaptive: 'Resolución adaptativa',
  showFps: 'Mostrar fotogramas por segundo',
  postFailed: 'El posprocesado no está disponible en este dispositivo, así que el tablero se dibuja sin él.',
  unavailable: 'Vista 3D no disponible',
  unknownGpu: 'GPU desconocida',
  cat: {
    shadows: 'Sombras', ao: 'Oclusión ambiental', bloom: 'Resplandor', grade: 'Corrección de color',
    antialias: 'Antialiasing', reflections: 'Reflejos', detail: 'Detalle de superficies',
    particles: 'Partículas', ambient: 'Movimiento ambiental'
  },
  tier: {
    low: 'Baja', balanced: 'Equilibrada', high: 'Alta', ultra: 'Ultra', medium: 'Media',
    off: 'No', on: 'Sí', plain: 'Simple', detailed: 'Detallado', static: 'Quieto', animated: 'Animado'
  },
  summary: {
    noShadows: 'sin sombras', shadows: 'sombras {n}²', ao: 'oclusión ambiental', aoHigh: 'oclusión ambiental completa',
    bloom: 'resplandor', reflections: 'reflejos', noAA: 'sin antialiasing'
  }
});

var ES_ES = derive(ES, {
  renderScale: 'Escala de renderizado',
  showFps: 'Mostrar FPS'
});

var DE = derive(EN, {
  quality: 'Qualität',
  auto: 'Automatisch (erkannt: {tier})',
  renderScale: 'Renderskalierung',
  fromPreset: 'Aus Voreinstellung ({tier})',
  adaptive: 'Adaptive Auflösung',
  showFps: 'Bildrate anzeigen',
  postFailed: 'Nachbearbeitung ist auf diesem Gerät nicht verfügbar, daher wird das Brett ohne sie gezeichnet.',
  unavailable: '3D-Ansicht nicht verfügbar',
  unknownGpu: 'unbekannte GPU',
  cat: {
    shadows: 'Schatten', ao: 'Umgebungsverdeckung', bloom: 'Leuchten', grade: 'Farbkorrektur',
    antialias: 'Kantenglättung', reflections: 'Reflexionen', detail: 'Oberflächendetails',
    particles: 'Partikel', ambient: 'Umgebungsbewegung'
  },
  tier: {
    low: 'Niedrig', balanced: 'Ausgewogen', high: 'Hoch', ultra: 'Ultra', medium: 'Mittel',
    off: 'Aus', on: 'An', plain: 'Einfach', detailed: 'Detailliert', static: 'Ruhig', animated: 'Animiert'
  },
  summary: {
    noShadows: 'keine Schatten', shadows: '{n}²-Schatten', ao: 'Umgebungsverdeckung', aoHigh: 'volle Umgebungsverdeckung',
    bloom: 'Leuchten', reflections: 'Reflexionen', noAA: 'keine Kantenglättung'
  }
});

var FR = derive(EN, {
  quality: 'Qualité',
  auto: 'Auto (détectée : {tier})',
  renderScale: 'Échelle de rendu',
  fromPreset: 'Selon le préréglage ({tier})',
  adaptive: 'Résolution adaptative',
  showFps: 'Afficher la fréquence d’images',
  postFailed: 'Le post-traitement n’est pas disponible sur cet appareil : le plateau est dessiné sans lui.',
  unavailable: 'Vue 3D indisponible',
  unknownGpu: 'GPU inconnu',
  cat: {
    shadows: 'Ombres', ao: 'Occlusion ambiante', bloom: 'Halo lumineux', grade: 'Étalonnage des couleurs',
    antialias: 'Anticrénelage', reflections: 'Reflets', detail: 'Détail des surfaces',
    particles: 'Particules', ambient: 'Mouvement ambiant'
  },
  tier: {
    low: 'Basse', balanced: 'Équilibrée', high: 'Haute', ultra: 'Ultra', medium: 'Moyen',
    off: 'Non', on: 'Oui', plain: 'Simple', detailed: 'Détaillé', static: 'Immobile', animated: 'Animé'
  },
  summary: {
    noShadows: 'sans ombres', shadows: 'ombres {n}²', ao: 'occlusion ambiante', aoHigh: 'occlusion ambiante complète',
    bloom: 'halo', reflections: 'reflets', noAA: 'sans anticrénelage'
  }
});

var FR_CA = derive(FR, {
  showFps: 'Afficher le nombre d’images par seconde',
  cat: { antialias: 'Anticrénelage', bloom: 'Éclat lumineux' },
  summary: { bloom: 'éclat' }
});

var PT = derive(EN, {
  quality: 'Qualidade',
  auto: 'Automática (detectada: {tier})',
  renderScale: 'Escala de renderização',
  fromPreset: 'Do predefinido ({tier})',
  adaptive: 'Resolução adaptativa',
  showFps: 'Mostrar taxa de quadros',
  postFailed: 'O pós-processamento não está disponível neste dispositivo, então o tabuleiro é desenhado sem ele.',
  unavailable: 'Visão 3D indisponível',
  unknownGpu: 'GPU desconhecida',
  cat: {
    shadows: 'Sombras', ao: 'Oclusão ambiente', bloom: 'Brilho', grade: 'Correção de cor',
    antialias: 'Suavização de bordas', reflections: 'Reflexos', detail: 'Detalhe das superfícies',
    particles: 'Partículas', ambient: 'Movimento ambiente'
  },
  tier: {
    low: 'Baixa', balanced: 'Equilibrada', high: 'Alta', ultra: 'Ultra', medium: 'Média',
    off: 'Desligado', on: 'Ligado', plain: 'Simples', detailed: 'Detalhado', static: 'Parado', animated: 'Animado'
  },
  summary: {
    noShadows: 'sem sombras', shadows: 'sombras {n}²', ao: 'oclusão ambiente', aoHigh: 'oclusão ambiente completa',
    bloom: 'brilho', reflections: 'reflexos', noAA: 'sem suavização'
  }
});

var IT = derive(EN, {
  quality: 'Qualità',
  auto: 'Automatica (rilevata: {tier})',
  renderScale: 'Scala di rendering',
  fromPreset: 'Dal preset ({tier})',
  adaptive: 'Risoluzione adattiva',
  showFps: 'Mostra frequenza fotogrammi',
  postFailed: 'La post-elaborazione non è disponibile su questo dispositivo, quindi il tabellone è disegnato senza.',
  unavailable: 'Vista 3D non disponibile',
  unknownGpu: 'GPU sconosciuta',
  cat: {
    shadows: 'Ombre', ao: 'Occlusione ambientale', bloom: 'Bagliore', grade: 'Correzione colore',
    antialias: 'Antialiasing', reflections: 'Riflessi', detail: 'Dettaglio superfici',
    particles: 'Particelle', ambient: 'Movimento ambientale'
  },
  tier: {
    low: 'Bassa', balanced: 'Bilanciata', high: 'Alta', ultra: 'Ultra', medium: 'Media',
    off: 'No', on: 'Sì', plain: 'Semplice', detailed: 'Dettagliato', static: 'Fermo', animated: 'Animato'
  },
  summary: {
    noShadows: 'senza ombre', shadows: 'ombre {n}²', ao: 'occlusione ambientale', aoHigh: 'occlusione ambientale completa',
    bloom: 'bagliore', reflections: 'riflessi', noAA: 'senza antialiasing'
  }
});

var EN_GB = derive(EN, {
  cat: { grade: 'Colour grade' }
});

export var GFX_STRINGS = {
  'en-US': EN, 'en-GB': EN_GB,
  'es-419': ES, 'es-ES': ES_ES,
  'de-DE': DE,
  'fr-FR': FR, 'fr-CA': FR_CA,
  'pt-BR': PT,
  'it-IT': IT
};

var LANG_DEFAULT = { en: 'en-US', es: 'es-419', de: 'de-DE', fr: 'fr-FR', pt: 'pt-BR', it: 'it-IT' };

/** Strings for the best-matching locale among `prefs` (e.g. navigator.languages). */
export function gfxStrings(prefs) {
  var list = Array.isArray(prefs) ? prefs : [prefs];
  for (var i = 0; i < list.length; i++) {
    var tag = String(list[i] || '');
    if (GFX_STRINGS[tag]) return GFX_STRINGS[tag];
    var lang = tag.split('-')[0].toLowerCase();
    if (lang === 'es' && tag && tag !== 'es' && !/^es-ES$/i.test(tag)) return ES; // Latin American variants
    if (LANG_DEFAULT[lang]) return GFX_STRINGS[LANG_DEFAULT[lang]];
  }
  return EN;
}
