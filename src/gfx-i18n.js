// Localized strings for the Settings → Graphics section. The rest of the game is English-only;
// this panel picks its locale from navigator.language (see pickLocale).

const EN = {
  sh_signIn: 'Sign in with StarHermit', sh_signInHint: 'Sync your progress and settings.', sh_invite: 'Invite a friend', sh_inviteHint: 'Copy your invite link.', sh_copied: 'Invite link copied to the clipboard.', sh_copyFailed: 'Could not copy the invite link.', sh_signedOut: 'Signed out — playing locally.',
  sh_lbPosting: 'Posting score to the leaderboard…', sh_lbRank: 'Leaderboard rank: #{rank}', sh_lbPosted: 'Score posted to the leaderboard.', sh_lbNotPosted: 'Score not posted to the leaderboard.',
  graphics: 'Graphics', quality: 'Quality', auto: 'Auto (detected: {tier})',
  tier_low: 'Low', tier_balanced: 'Balanced', tier_high: 'High', tier_ultra: 'Ultra',
  scale: 'Render scale', fromPreset: 'From preset ({tier})',
  cat_shadows: 'Shadows', cat_ao: 'Ambient occlusion', cat_bloom: 'Bloom', cat_grade: 'Color grade',
  cat_antialias: 'Anti-aliasing', cat_reflections: 'Reflections', cat_detail: 'Scenery detail',
  cat_particles: 'Merge particles', cat_background: 'Background motion',
  t_off: 'Off', t_on: 'On', t_low: 'Low', t_medium: 'Medium', t_high: 'High',
  t_fxaa: 'FXAA', t_smaa: 'SMAA', t_msaa: 'MSAA', t_plain: 'Plain', t_detailed: 'Detailed',
  t_static: 'Static', t_animated: 'Animated',
  adaptive: 'Adaptive resolution', fps: 'Show frame rate',
  postFailed: 'Post-processing is unavailable on this device, so the game renders without it.',
  gpuUnknown: 'unknown GPU', fpsUnit: 'fps',
  sum_noShadows: 'no shadows', sum_shadows: 'shadows', sum_ao: 'ambient occlusion', sum_aoHigh: 'full ambient occlusion',
  sum_bloom: 'bloom', sum_reflections: 'reflections', sum_noAA: 'no anti-aliasing', sum_particles: 'particles',
};

const ES = {
  sh_signIn: 'Iniciar sesión con StarHermit', sh_signInHint: 'Sincroniza tu progreso y tus ajustes.', sh_invite: 'Invitar a un amigo', sh_inviteHint: 'Copia tu enlace de invitación.', sh_copied: 'Enlace de invitación copiado al portapapeles.', sh_copyFailed: 'No se pudo copiar el enlace de invitación.', sh_signedOut: 'Sesión cerrada: juegas en modo local.',
  sh_lbPosting: 'Publicando la puntuación en la clasificación…', sh_lbRank: 'Puesto en la clasificación: #{rank}', sh_lbPosted: 'Puntuación publicada en la clasificación.', sh_lbNotPosted: 'No se pudo publicar la puntuación en la clasificación.',
  graphics: 'Gráficos', quality: 'Calidad', auto: 'Automática (detectada: {tier})',
  tier_low: 'Baja', tier_balanced: 'Equilibrada', tier_high: 'Alta', tier_ultra: 'Ultra',
  scale: 'Escala de renderizado', fromPreset: 'Según calidad ({tier})',
  cat_shadows: 'Sombras', cat_ao: 'Oclusión ambiental', cat_bloom: 'Resplandor', cat_grade: 'Corrección de color',
  cat_antialias: 'Antialiasing', cat_reflections: 'Reflejos', cat_detail: 'Detalle del escenario',
  cat_particles: 'Partículas de fusión', cat_background: 'Movimiento de fondo',
  t_off: 'No', t_on: 'Sí', t_low: 'Bajo', t_medium: 'Medio', t_high: 'Alto',
  t_fxaa: 'FXAA', t_smaa: 'SMAA', t_msaa: 'MSAA', t_plain: 'Sencillo', t_detailed: 'Detallado',
  t_static: 'Estático', t_animated: 'Animado',
  adaptive: 'Resolución adaptativa', fps: 'Mostrar fotogramas por segundo',
  postFailed: 'El posprocesado no está disponible en este dispositivo; el juego se muestra sin él.',
  gpuUnknown: 'GPU desconocida', fpsUnit: 'FPS',
  sum_noShadows: 'sin sombras', sum_shadows: 'sombras', sum_ao: 'oclusión ambiental', sum_aoHigh: 'oclusión ambiental completa',
  sum_bloom: 'resplandor', sum_reflections: 'reflejos', sum_noAA: 'sin antialiasing', sum_particles: 'partículas',
};

const FR = {
  sh_signIn: 'Se connecter avec StarHermit', sh_signInHint: 'Synchronisez progression et réglages.', sh_invite: 'Inviter un ami', sh_inviteHint: 'Copier votre lien d’invitation.', sh_copied: 'Lien d’invitation copié dans le presse-papiers.', sh_copyFailed: 'Impossible de copier le lien d’invitation.', sh_signedOut: 'Déconnecté — vous jouez en local.',
  sh_lbPosting: 'Envoi du score au classement…', sh_lbRank: 'Rang au classement : #{rank}', sh_lbPosted: 'Score envoyé au classement.', sh_lbNotPosted: 'Score non envoyé au classement.',
  graphics: 'Graphismes', quality: 'Qualité', auto: 'Auto (détectée : {tier})',
  tier_low: 'Basse', tier_balanced: 'Équilibrée', tier_high: 'Haute', tier_ultra: 'Ultra',
  scale: 'Échelle de rendu', fromPreset: 'Selon la qualité ({tier})',
  cat_shadows: 'Ombres', cat_ao: 'Occlusion ambiante', cat_bloom: 'Halo lumineux', cat_grade: 'Étalonnage des couleurs',
  cat_antialias: 'Anticrénelage', cat_reflections: 'Reflets', cat_detail: 'Détail du décor',
  cat_particles: 'Particules de fusion', cat_background: 'Animation du décor',
  t_off: 'Non', t_on: 'Oui', t_low: 'Bas', t_medium: 'Moyen', t_high: 'Élevé',
  t_fxaa: 'FXAA', t_smaa: 'SMAA', t_msaa: 'MSAA', t_plain: 'Simple', t_detailed: 'Détaillé',
  t_static: 'Fixe', t_animated: 'Animé',
  adaptive: 'Résolution adaptative', fps: 'Afficher les images par seconde',
  postFailed: 'Le post-traitement est indisponible sur cet appareil ; le jeu s’affiche sans lui.',
  gpuUnknown: 'GPU inconnu', fpsUnit: 'i/s',
  sum_noShadows: 'sans ombres', sum_shadows: 'ombres', sum_ao: 'occlusion ambiante', sum_aoHigh: 'occlusion ambiante complète',
  sum_bloom: 'halo', sum_reflections: 'reflets', sum_noAA: 'sans anticrénelage', sum_particles: 'particules',
};

export const GFX_STRINGS = {
  'en-US': EN,
  'en-GB': { ...EN, sh_copyFailed: 'Couldn’t copy the invite link.', cat_grade: 'Colour grade' },
  'es-419': ES,
  'es-ES': { ...ES, sh_lbNotPosted: 'No se ha podido publicar la puntuación en la clasificación.', sh_copyFailed: 'No se ha podido copiar el enlace de invitación.', sh_signedOut: 'Sesión cerrada: juegas en local.', fps: 'Mostrar imágenes por segundo' },
  'de-DE': {
    sh_signIn: 'Mit StarHermit anmelden', sh_signInHint: 'Fortschritt und Einstellungen synchronisieren.', sh_invite: 'Freund einladen', sh_inviteHint: 'Einladungslink kopieren.', sh_copied: 'Einladungslink in die Zwischenablage kopiert.', sh_copyFailed: 'Einladungslink konnte nicht kopiert werden.', sh_signedOut: 'Abgemeldet – du spielst lokal weiter.',
    sh_lbPosting: 'Punktzahl wird in die Bestenliste eingetragen…', sh_lbRank: 'Platz in der Bestenliste: #{rank}', sh_lbPosted: 'Punktzahl in die Bestenliste eingetragen.', sh_lbNotPosted: 'Punktzahl wurde nicht in die Bestenliste eingetragen.',
    graphics: 'Grafik', quality: 'Qualität', auto: 'Automatisch (erkannt: {tier})',
    tier_low: 'Niedrig', tier_balanced: 'Ausgewogen', tier_high: 'Hoch', tier_ultra: 'Ultra',
    scale: 'Renderskalierung', fromPreset: 'Laut Stufe ({tier})',
    cat_shadows: 'Schatten', cat_ao: 'Umgebungsverdeckung', cat_bloom: 'Leuchteffekt', cat_grade: 'Farbkorrektur',
    cat_antialias: 'Kantenglättung', cat_reflections: 'Spiegelungen', cat_detail: 'Szenendetails',
    cat_particles: 'Verschmelzungspartikel', cat_background: 'Hintergrundbewegung',
    t_off: 'Aus', t_on: 'An', t_low: 'Niedrig', t_medium: 'Mittel', t_high: 'Hoch',
    t_fxaa: 'FXAA', t_smaa: 'SMAA', t_msaa: 'MSAA', t_plain: 'Schlicht', t_detailed: 'Detailliert',
    t_static: 'Statisch', t_animated: 'Animiert',
    adaptive: 'Adaptive Auflösung', fps: 'Bildrate anzeigen',
    postFailed: 'Nachbearbeitung ist auf diesem Gerät nicht verfügbar, das Spiel wird ohne sie dargestellt.',
    gpuUnknown: 'unbekannte GPU', fpsUnit: 'FPS',
    sum_noShadows: 'keine Schatten', sum_shadows: 'Schatten', sum_ao: 'Umgebungsverdeckung', sum_aoHigh: 'volle Umgebungsverdeckung',
    sum_bloom: 'Leuchten', sum_reflections: 'Spiegelungen', sum_noAA: 'keine Kantenglättung', sum_particles: 'Partikel',
  },
  'fr-FR': FR,
  'fr-CA': { ...FR, sh_lbPosting: 'Envoi du pointage au classement…', sh_lbPosted: 'Pointage envoyé au classement.', sh_lbNotPosted: 'Pointage non envoyé au classement.', sh_signInHint: 'Synchronisez votre progression et vos paramètres.', cat_bloom: 'Effet de lueur', sum_bloom: 'lueur' },
  'pt-BR': {
    sh_signIn: 'Entrar com StarHermit', sh_signInHint: 'Sincronize seu progresso e suas configurações.', sh_invite: 'Convidar um amigo', sh_inviteHint: 'Copie seu link de convite.', sh_copied: 'Link de convite copiado para a área de transferência.', sh_copyFailed: 'Não foi possível copiar o link de convite.', sh_signedOut: 'Sessão encerrada — jogando localmente.',
    sh_lbPosting: 'Enviando pontuação para o placar…', sh_lbRank: 'Posição no placar: #{rank}', sh_lbPosted: 'Pontuação enviada para o placar.', sh_lbNotPosted: 'A pontuação não foi enviada para o placar.',
    graphics: 'Gráficos', quality: 'Qualidade', auto: 'Automática (detectada: {tier})',
    tier_low: 'Baixa', tier_balanced: 'Equilibrada', tier_high: 'Alta', tier_ultra: 'Ultra',
    scale: 'Escala de renderização', fromPreset: 'Conforme a qualidade ({tier})',
    cat_shadows: 'Sombras', cat_ao: 'Oclusão ambiente', cat_bloom: 'Brilho', cat_grade: 'Correção de cor',
    cat_antialias: 'Antisserrilhado', cat_reflections: 'Reflexos', cat_detail: 'Detalhe do cenário',
    cat_particles: 'Partículas de fusão', cat_background: 'Movimento do fundo',
    t_off: 'Desligado', t_on: 'Ligado', t_low: 'Baixo', t_medium: 'Médio', t_high: 'Alto',
    t_fxaa: 'FXAA', t_smaa: 'SMAA', t_msaa: 'MSAA', t_plain: 'Simples', t_detailed: 'Detalhado',
    t_static: 'Estático', t_animated: 'Animado',
    adaptive: 'Resolução adaptativa', fps: 'Mostrar taxa de quadros',
    postFailed: 'O pós-processamento não está disponível neste dispositivo; o jogo é exibido sem ele.',
    gpuUnknown: 'GPU desconhecida', fpsUnit: 'FPS',
    sum_noShadows: 'sem sombras', sum_shadows: 'sombras', sum_ao: 'oclusão ambiente', sum_aoHigh: 'oclusão ambiente completa',
    sum_bloom: 'brilho', sum_reflections: 'reflexos', sum_noAA: 'sem antisserrilhado', sum_particles: 'partículas',
  },
  'it-IT': {
    sh_signIn: 'Accedi con StarHermit', sh_signInHint: 'Sincronizza progressi e impostazioni.', sh_invite: 'Invita un amico', sh_inviteHint: 'Copia il tuo link di invito.', sh_copied: 'Link di invito copiato negli appunti.', sh_copyFailed: 'Impossibile copiare il link di invito.', sh_signedOut: 'Disconnesso: giochi in locale.',
    sh_lbPosting: 'Invio del punteggio alla classifica…', sh_lbRank: 'Posizione in classifica: #{rank}', sh_lbPosted: 'Punteggio inviato alla classifica.', sh_lbNotPosted: 'Punteggio non inviato alla classifica.',
    graphics: 'Grafica', quality: 'Qualità', auto: 'Automatica (rilevata: {tier})',
    tier_low: 'Bassa', tier_balanced: 'Bilanciata', tier_high: 'Alta', tier_ultra: 'Ultra',
    scale: 'Scala di rendering', fromPreset: 'Dalla qualità ({tier})',
    cat_shadows: 'Ombre', cat_ao: 'Occlusione ambientale', cat_bloom: 'Bagliore', cat_grade: 'Correzione colore',
    cat_antialias: 'Antialiasing', cat_reflections: 'Riflessi', cat_detail: 'Dettaglio dello scenario',
    cat_particles: 'Particelle di fusione', cat_background: 'Movimento dello sfondo',
    t_off: 'No', t_on: 'Sì', t_low: 'Basso', t_medium: 'Medio', t_high: 'Alto',
    t_fxaa: 'FXAA', t_smaa: 'SMAA', t_msaa: 'MSAA', t_plain: 'Semplice', t_detailed: 'Dettagliato',
    t_static: 'Statico', t_animated: 'Animato',
    adaptive: 'Risoluzione adattiva', fps: 'Mostra frequenza fotogrammi',
    postFailed: 'La post-elaborazione non è disponibile su questo dispositivo, quindi il gioco viene mostrato senza.',
    gpuUnknown: 'GPU sconosciuta', fpsUnit: 'FPS',
    sum_noShadows: 'senza ombre', sum_shadows: 'ombre', sum_ao: 'occlusione ambientale', sum_aoHigh: 'occlusione ambientale completa',
    sum_bloom: 'bagliore', sum_reflections: 'riflessi', sum_noAA: 'senza antialiasing', sum_particles: 'particelle',
  },
};

/** Best supported locale for a BCP 47 tag (exact, then same language, then en-US). */
export function pickLocale(tag) {
  const t = String(tag || 'en-US');
  const exact = Object.keys(GFX_STRINGS).find(k => k.toLowerCase() === t.toLowerCase());
  if (exact) return exact;
  const lang = t.split('-')[0].toLowerCase();
  const region = (t.split('-')[1] || '').toUpperCase();
  if (lang === 'en') return ['GB', 'UK', 'IE', 'AU', 'NZ', 'ZA', 'IN'].includes(region) ? 'en-GB' : 'en-US';
  if (lang === 'es') return region === 'ES' || region === '' ? 'es-ES' : 'es-419';
  if (lang === 'fr') return region === 'CA' ? 'fr-CA' : 'fr-FR';
  if (lang === 'pt') return 'pt-BR';
  if (lang === 'de') return 'de-DE';
  if (lang === 'it') return 'it-IT';
  return 'en-US';
}

/** Translator for a locale: t(key, {tier}) with {placeholders}. */
export function translator(locale) {
  const dict = GFX_STRINGS[locale] || EN;
  return (key, vars) => {
    let s = dict[key] ?? EN[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, v);
    return s;
  };
}
