// Each instrument has its own ladder (InstrumentLevels). This is the one a new
// instrument starts with, and the one used for a student with no instrument yet.
// Same list as STANDARD_LEVELS in src/lib/mockData.js.
const STANDARD_LEVELS = ['Inicial', '1', '2', '3', '4', '5', '6', '7', '8', 'Prodigy', 'Legend', 'Genius'];
const LEVELS = STANDARD_LEVELS;

const PIECE_CATEGORIES = ['A', 'B', 'C'];
const MAX_LEVEL_NAME = 40;

// Position of a level in a ladder (-1 if it is not there)
const levelIndex = (level, ladder = STANDARD_LEVELS) => ladder.indexOf(String(level));

/** A level name the academy writes: trimmed, not empty, short. Returns { ok, name } or a failure. */
const normalizeLevelName = (name) => {
    const clean = String(name ?? '').trim().replace(/\s+/g, ' ');
    if (!clean) return { ok: false, code: 'nombre_requerido', message: 'Escribe el nombre del nivel.' };
    if (clean.length > MAX_LEVEL_NAME) return { ok: false, code: 'nombre_largo', message: `El nombre del nivel no puede pasar de ${MAX_LEVEL_NAME} caracteres.` };
    return { ok: true, name: clean };
};

// "Nivel 3", "Inicial" or "Prodigy"
const levelLabel = (level) => (Number.isNaN(Number(level)) ? String(level) : `Nivel ${level}`);

const isHttpUrl = (value) => {
    try {
        return ['http:', 'https:'].includes(new URL(value).protocol);
    } catch {
        return false;
    }
};

/**
 * Checks and normalizes the three pieces of a request: one per category,
 * each with a title, and with a video link when the modality is 'videos'.
 */
const normalizePieces = (pieces, modality) => {
    if (!Array.isArray(pieces)) return { ok: false, message: 'Indica las tres obras (A, B y C).' };
    const result = [];
    for (const category of PIECE_CATEGORIES) {
        const piece = pieces.find(p => p && p.category === category);
        const title = piece?.title?.trim();
        if (!title) return { ok: false, message: `Falta la obra de la categoría ${category}.` };
        const videoUrl = piece.videoUrl?.trim() || null;
        if (modality === 'videos' && !isHttpUrl(videoUrl)) {
            return { ok: false, message: `El link del video de la categoría ${category} no es válido.` };
        }
        result.push({ category, title, composer: piece.composer?.trim() || '', videoUrl: modality === 'videos' ? videoUrl : null });
    }
    return { ok: true, pieces: result };
};

module.exports = { STANDARD_LEVELS, LEVELS, PIECE_CATEGORIES, levelIndex, levelLabel, normalizeLevelName, isHttpUrl, normalizePieces };
