// Spanish labels and badge tones for the statuses the API returns
import { formatShortDay } from './time';

export const PAYMENT_LABELS = {
    pendiente: { label: 'Pago pendiente', tone: 'warning' },
    en_revision: { label: 'En revisión', tone: 'info' },
    pagado: { label: 'Pagado', tone: 'success' },
    vencido: { label: 'Vencido', tone: 'danger' },
};

// Monthly billing charges (Payments)
export const CHARGE_LABELS = {
    por_pagar: { label: 'Por pagar', tone: 'warning' },
    en_revision: { label: 'En revisión', tone: 'info' },
    aprobado: { label: 'Aprobado', tone: 'success' },
    rechazado: { label: 'Rechazado', tone: 'danger' },
    anulado: { label: 'Vencido', tone: 'neutral' },
};

export const CYCLE_LABELS = {
    pendiente_pago: { label: 'Esperando pago', tone: 'warning' },
    activo: { label: 'Activo', tone: 'primary' },
    finalizado: { label: 'Finalizado', tone: 'neutral' },
    cancelado: { label: 'Anulado', tone: 'neutral' },
};

// Badge of a cycle: an active one paid in advance says when it starts instead of "Activo"
export const cycleBadge = (cycle) => (cycle.status === 'activo' && cycle.summary?.started === false
    ? { label: `Empieza el ${formatShortDay(cycle.startDate)}`, tone: 'info' }
    : CYCLE_LABELS[cycle.status] || { label: cycle.status, tone: 'neutral' });

export const LESSON_LABELS = {
    programada: { label: 'Programada', tone: 'primary' },
    tomada: { label: 'Tomada', tone: 'success' },
    perdida: { label: 'Perdida', tone: 'danger' },
    reprogramada_por_estudiante: { label: 'Reprogramada', tone: 'neutral' },
    cancelada_por_profesor: { label: 'Cancelada por el profesor', tone: 'warning' },
    cancelada_por_academia: { label: 'Cancelada por la academia', tone: 'warning' },
    // A lesson the teacher moved (lesson.moved): its status is cancelada_por_profesor
    movida: { label: 'Movida por el profesor', tone: 'neutral' },
};

// Status key for LESSON_LABELS: a moved lesson is not shown as cancelled
export const lessonStatusKey = (lesson) => (lesson.moved ? 'movida' : lesson.status);

export const ASSESSMENT_LABELS = {
    agendada: { label: 'Agendada', tone: 'info' },
    realizada: { label: 'Realizada', tone: 'primary' },
    convertida: { label: 'Inscrito', tone: 'success' },
    descartada: { label: 'Descartada', tone: 'neutral' },
};

export const LEVEL_REQUEST_LABELS = {
    pendiente: { label: 'En revisión', tone: 'info' },
    muestra_programada: { label: 'Muestra programada', tone: 'primary' },
    aprobada: { label: 'Aprobada', tone: 'success' },
    rechazada: { label: 'Rechazada', tone: 'danger' },
    cancelada: { label: 'Cancelada', tone: 'neutral' },
};

export const MODALITY_LABELS = {
    videos: 'Videos',
    muestra: 'Muestra',
};

// Still waiting for the academy (with or without a scheduled showcase)
export const isOpenRequest = (request) => ['pendiente', 'muestra_programada'].includes(request.status);

// "Nivel 3", "Inicial" or "Prodigy"
export const levelLabel = (level) => (Number.isNaN(Number(level)) ? level : `Nivel ${level}`);

// Who reads an announcement
export const AUDIENCE_LABELS = {
    todos: 'Estudiantes y profesores',
    estudiantes: 'Solo estudiantes',
    profesores: 'Solo profesores',
    mis_estudiantes: 'Sus estudiantes',
};

export const PLAN_LABELS = {
    paquete_4: 'Paquete de 4 clases',
    suelta: 'Clase suelta',
};
