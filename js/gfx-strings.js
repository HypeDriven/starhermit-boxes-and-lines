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

/* StarHermit account strings (title sign-in / invite, toasts). `{name}` = display name. */
export const ACCOUNT_STRINGS = {
  "en-US": {
    "signIn": "Sign in with StarHermit",
    "invite": "Invite a friend",
    "inviteCopied": "Invite link copied to the clipboard.",
    "inviteFailed": "Could not copy the invite link.",
    "offline": "Offline — progress is stored on this device.",
    "playingAs": "Playing as {name}",
    "synced": "progress synced",
    "saving": "saving…",
    "syncOff": "cloud sync unavailable",
    "signedOut": "Signed out of StarHermit — progress stays on this device.",
    "lbPosting": "Posting score to the leaderboard…",
    "lbRank": "Leaderboard rank: #{rank}",
    "lbPosted": "Score posted to the leaderboard.",
    "lbNotPosted": "Score not posted to the leaderboard."
  },
  "en-GB": {
    "signIn": "Sign in with StarHermit",
    "invite": "Invite a friend",
    "inviteCopied": "Invite link copied to the clipboard.",
    "inviteFailed": "Could not copy the invite link.",
    "offline": "Offline — progress is stored on this device.",
    "playingAs": "Playing as {name}",
    "synced": "progress synced",
    "saving": "saving…",
    "syncOff": "cloud sync unavailable",
    "signedOut": "Signed out of StarHermit — progress stays on this device.",
    "lbPosting": "Posting score to the leaderboard…",
    "lbRank": "Leaderboard rank: #{rank}",
    "lbPosted": "Score posted to the leaderboard.",
    "lbNotPosted": "Score not posted to the leaderboard."
  },
  "es-419": {
    "signIn": "Iniciar sesión con StarHermit",
    "invite": "Invitar a un amigo",
    "inviteCopied": "Enlace de invitación copiado al portapapeles.",
    "inviteFailed": "No se pudo copiar el enlace de invitación.",
    "offline": "Sin conexión: el progreso se guarda en este dispositivo.",
    "playingAs": "Jugando como {name}",
    "synced": "progreso sincronizado",
    "saving": "guardando…",
    "syncOff": "sincronización en la nube no disponible",
    "signedOut": "Sesión de StarHermit cerrada: el progreso se queda en este dispositivo.",
    "lbPosting": "Enviando el puntaje a la tabla de posiciones…",
    "lbRank": "Posición en la tabla: #{rank}",
    "lbPosted": "Puntaje enviado a la tabla de posiciones.",
    "lbNotPosted": "El puntaje no se envió a la tabla de posiciones."
  },
  "es-ES": {
    "signIn": "Iniciar sesión con StarHermit",
    "invite": "Invitar a un amigo",
    "inviteCopied": "Enlace de invitación copiado en el portapapeles.",
    "inviteFailed": "No se pudo copiar el enlace de invitación.",
    "offline": "Sin conexión: el progreso se guarda en este dispositivo.",
    "playingAs": "Jugando como {name}",
    "synced": "progreso sincronizado",
    "saving": "guardando…",
    "syncOff": "sincronización en la nube no disponible",
    "signedOut": "Sesión de StarHermit cerrada: el progreso se queda en este dispositivo.",
    "lbPosting": "Enviando la puntuación a la clasificación…",
    "lbRank": "Puesto en la clasificación: #{rank}",
    "lbPosted": "Puntuación enviada a la clasificación.",
    "lbNotPosted": "La puntuación no se ha enviado a la clasificación."
  },
  "de-DE": {
    "signIn": "Mit StarHermit anmelden",
    "invite": "Freund einladen",
    "inviteCopied": "Einladungslink in die Zwischenablage kopiert.",
    "inviteFailed": "Einladungslink konnte nicht kopiert werden.",
    "offline": "Offline – der Fortschritt wird auf diesem Gerät gespeichert.",
    "playingAs": "Du spielst als {name}",
    "synced": "Fortschritt synchronisiert",
    "saving": "wird gespeichert …",
    "syncOff": "Cloud-Synchronisierung nicht verfügbar",
    "signedOut": "Von StarHermit abgemeldet – der Fortschritt bleibt auf diesem Gerät.",
    "lbPosting": "Punktzahl wird an die Bestenliste gesendet …",
    "lbRank": "Platz in der Bestenliste: #{rank}",
    "lbPosted": "Punktzahl in die Bestenliste eingetragen.",
    "lbNotPosted": "Punktzahl wurde nicht in die Bestenliste eingetragen."
  },
  "fr-FR": {
    "signIn": "Se connecter avec StarHermit",
    "invite": "Inviter un ami",
    "inviteCopied": "Lien d’invitation copié dans le presse-papiers.",
    "inviteFailed": "Impossible de copier le lien d’invitation.",
    "offline": "Hors ligne : la progression est enregistrée sur cet appareil.",
    "playingAs": "Vous jouez en tant que {name}",
    "synced": "progression synchronisée",
    "saving": "enregistrement…",
    "syncOff": "synchronisation cloud indisponible",
    "signedOut": "Déconnecté de StarHermit : la progression reste sur cet appareil.",
    "lbPosting": "Envoi du score au classement…",
    "lbRank": "Rang au classement : #{rank}",
    "lbPosted": "Score publié au classement.",
    "lbNotPosted": "Score non publié au classement."
  },
  "fr-CA": {
    "signIn": "Se connecter avec StarHermit",
    "invite": "Inviter un ami",
    "inviteCopied": "Lien d’invitation copié dans le presse-papiers.",
    "inviteFailed": "Impossible de copier le lien d’invitation.",
    "offline": "Hors ligne : la progression est enregistrée sur cet appareil.",
    "playingAs": "Vous jouez en tant que {name}",
    "synced": "progression synchronisée",
    "saving": "enregistrement…",
    "syncOff": "synchronisation infonuagique indisponible",
    "signedOut": "Déconnecté de StarHermit : la progression reste sur cet appareil.",
    "lbPosting": "Envoi du pointage au classement…",
    "lbRank": "Rang au classement : #{rank}",
    "lbPosted": "Pointage publié au classement.",
    "lbNotPosted": "Pointage non publié au classement."
  },
  "pt-BR": {
    "signIn": "Entrar com a StarHermit",
    "invite": "Convidar um amigo",
    "inviteCopied": "Link de convite copiado para a área de transferência.",
    "inviteFailed": "Não foi possível copiar o link de convite.",
    "offline": "Offline — o progresso fica salvo neste dispositivo.",
    "playingAs": "Jogando como {name}",
    "synced": "progresso sincronizado",
    "saving": "salvando…",
    "syncOff": "sincronização na nuvem indisponível",
    "signedOut": "Você saiu da StarHermit — o progresso continua neste dispositivo.",
    "lbPosting": "Enviando a pontuação para o placar…",
    "lbRank": "Posição no placar: #{rank}",
    "lbPosted": "Pontuação enviada ao placar.",
    "lbNotPosted": "A pontuação não foi enviada ao placar."
  },
  "it-IT": {
    "signIn": "Accedi con StarHermit",
    "invite": "Invita un amico",
    "inviteCopied": "Link di invito copiato negli appunti.",
    "inviteFailed": "Impossibile copiare il link di invito.",
    "offline": "Offline: i progressi sono salvati su questo dispositivo.",
    "playingAs": "Stai giocando come {name}",
    "synced": "progressi sincronizzati",
    "saving": "salvataggio…",
    "syncOff": "sincronizzazione cloud non disponibile",
    "signedOut": "Disconnesso da StarHermit: i progressi restano su questo dispositivo.",
    "lbPosting": "Invio del punteggio alla classifica…",
    "lbRank": "Posizione in classifica: #{rank}",
    "lbPosted": "Punteggio inviato alla classifica.",
    "lbNotPosted": "Punteggio non inviato alla classifica."
  }
};

/** Account strings for the best-matching locale (same matching as gfxStrings). */
export function accountStrings(prefs) {
  var list = Array.isArray(prefs) ? prefs : [prefs];
  for (var i = 0; i < list.length; i++) {
    var tag = String(list[i] || '');
    if (ACCOUNT_STRINGS[tag]) return ACCOUNT_STRINGS[tag];
    var lang = tag.split('-')[0].toLowerCase();
    if (lang === 'es' && tag && tag !== 'es' && !/^es-ES$/i.test(tag)) return ACCOUNT_STRINGS['es-419'];
    if (LANG_DEFAULT[lang]) return ACCOUNT_STRINGS[LANG_DEFAULT[lang]];
  }
  return ACCOUNT_STRINGS['en-US'];
}
