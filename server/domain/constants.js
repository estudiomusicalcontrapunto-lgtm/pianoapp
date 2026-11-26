const ROLES = {
    ACADEMY: 'academy',
    TEACHER: 'teacher',
    STUDENT: 'student',
};

const LESSON_STATUS = {
    PROGRAMADA: 'programada',
    TOMADA: 'tomada',
    PERDIDA: 'perdida', // No-show or late cancellation; counts as taken
    REPROGRAMADA_POR_ESTUDIANTE: 'reprogramada_por_estudiante', // Uses one reschedule of the cycle
    CANCELADA_POR_PROFESOR: 'cancelada_por_profesor', // Does not use the limit; a make-up is owed
    CANCELADA_POR_ACADEMIA: 'cancelada_por_academia', // Closure days; a make-up is owed
};

// A make-up ("reposición") is a kind of lesson, so it can later be tomada or perdida
const LESSON_KIND = {
    REGULAR: 'regular',
    REPOSICION: 'reposicion',
};

const AVAILABILITY_TYPE = {
    CLASE: 'clase',
    REPOSICION: 'reposicion',
};

const PAYMENT_STATUS = {
    PENDIENTE: 'pendiente',
    EN_REVISION: 'en_revision',
    PAGADO: 'pagado',
    VENCIDO: 'vencido',
};

const CYCLE_STATUS = {
    PENDIENTE_PAGO: 'pendiente_pago',
    ACTIVO: 'activo',
    FINALIZADO: 'finalizado',
    CANCELADO: 'cancelado',
};

const CYCLE_PLAN = {
    PAQUETE_4: 'paquete_4',
    SUELTA: 'suelta',
};

const ASSESSMENT_STATUS = {
    AGENDADA: 'agendada',
    REALIZADA: 'realizada',
    CONVERTIDA: 'convertida',
    DESCARTADA: 'descartada',
};

const HOLD_STATUS = {
    SIN_APARTAR: 'sin_apartar',
    APARTADO: 'apartado',
    LIBERADO: 'liberado',
    CONVERTIDO: 'convertido',
};

const NOTICE_KIND = {
    SISTEMA: 'sistema',
    MANUAL: 'manual',
};

const LEVEL_REQUEST_MODALITY = {
    VIDEOS: 'videos', // A link per piece
    MUESTRA: 'muestra', // The student plays the pieces at a showcase the academy schedules
};

const LEVEL_REQUEST_STATUS = {
    PENDIENTE: 'pendiente',
    MUESTRA_PROGRAMADA: 'muestra_programada',
    APROBADA: 'aprobada',
    RECHAZADA: 'rechazada',
    CANCELADA: 'cancelada',
};

module.exports = {
    ROLES,
    LESSON_STATUS,
    LESSON_KIND,
    AVAILABILITY_TYPE,
    PAYMENT_STATUS,
    CYCLE_STATUS,
    CYCLE_PLAN,
    ASSESSMENT_STATUS,
    HOLD_STATUS,
    NOTICE_KIND,
    LEVEL_REQUEST_MODALITY,
    LEVEL_REQUEST_STATUS,
};
