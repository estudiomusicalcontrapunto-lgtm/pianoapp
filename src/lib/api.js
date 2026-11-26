// Development: the API runs apart on port 5000. Production: the same server serves
// the app and the API, so the address is relative. VITE_API_URL overrides both.
const API_URL = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:5000/api' : '/api');

const getHeaders = () => {
    const token = localStorage.getItem('pianoApp_token');
    return {
        'Content-Type': 'application/json',
        ...(token && { 'Authorization': `Bearer ${token}` })
    };
};

// Errors carry the server's message (in Spanish) plus its code and details
const handleResponse = async (response) => {
    const data = await response.json().catch(() => null);
    if (!response.ok) {
        const error = new Error(data?.message || 'Algo salió mal. Inténtalo de nuevo en un momento.');
        error.code = data?.code;
        error.details = data?.details;
        error.status = response.status;
        throw error;
    }
    return data;
};

// No connection: a clear message instead of the browser's technical one
const safeFetch = async (url, options) => {
    try {
        return await fetch(url, options);
    } catch {
        throw new Error('No pudimos conectarnos. Revisa tu conexión a internet e inténtalo de nuevo.');
    }
};

const request = async (method, path, body) => {
    const res = await safeFetch(`${API_URL}${path}`, {
        method,
        headers: getHeaders(),
        ...(body !== undefined && { body: JSON.stringify(body) })
    });
    return handleResponse(res);
};

// Opens a protected file in a new tab (it needs the auth header, so it goes through a blob)
const openProtectedFile = async (path, failMessage) => {
    const tab = window.open('', '_blank');
    const res = await fetch(`${API_URL}${path}`, { headers: getHeaders() });
    if (!res.ok) {
        tab?.close();
        const data = await res.json().catch(() => null);
        throw new Error(data?.message || failMessage);
    }
    const url = URL.createObjectURL(await res.blob());
    if (tab) tab.location.href = url;
    else window.location.href = url;
};

// multipart/form-data upload: the browser sets the Content-Type with its boundary
const uploadForm = async (path, form) => {
    const token = localStorage.getItem('pianoApp_token');
    const res = await safeFetch(`${API_URL}${path}`, {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        body: form
    });
    return handleResponse(res);
};

const query = (params) => {
    const entries = Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null && v !== '');
    return entries.length ? `?${new URLSearchParams(entries).toString()}` : '';
};

export const api = {
    // Auth
    login: async (email, password) => {
        const res = await fetch(`${API_URL}/auth/login`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ email, password })
        });
        return handleResponse(res);
    },
    
    changePassword: async (currentPassword, newPassword) => {
        const res = await fetch(`${API_URL}/auth/change-password`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ currentPassword, newPassword })
        });
        return handleResponse(res);
    },

    getProfile: async () => {
        const res = await fetch(`${API_URL}/users/me`, {
            headers: getHeaders()
        });
        return handleResponse(res);
    },

    getStudents: async () => {
        const res = await fetch(`${API_URL}/users/students`, {
            headers: getHeaders()
        });
        return handleResponse(res);
    },

    // The student marks today as practiced: { streak, lastPractice }
    practice: () => request('POST', '/users/practice'),
    // One week of practice: { weekStart, today, streak, days: [{ date, practiced }] }
    getPracticeWeek: (studentId, weekStart) => request('GET', `/users/${studentId}/practice${query({ weekStart })}`),

    // Repertoire
    assignRepertoire: async (studentId, pieceData) => {
        const res = await fetch(`${API_URL}/repertoire/${studentId}`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify(pieceData)
        });
        return handleResponse(res);
    },

    updateRepertoire: async (studentId, repertoireId, updates) => {
        const res = await fetch(`${API_URL}/repertoire/${studentId}/${repertoireId}`, {
            method: 'PUT',
            headers: getHeaders(),
            body: JSON.stringify(updates)
        });
        return handleResponse(res);
    },

    deleteRepertoire: async (studentId, repertoireId) => {
        const res = await fetch(`${API_URL}/repertoire/${studentId}/${repertoireId}`, {
            method: 'DELETE',
            headers: getHeaders()
        });
        return handleResponse(res);
    },

    // Announcements the academy or a teacher manages (readers get them in getNoticeFeed)
    getAnnouncements: () => request('GET', '/announcements'),
    createAnnouncement: (data) => request('POST', '/announcements', data),
    updateAnnouncement: (id, data) => request('PUT', `/announcements/${id}`, data),
    endAnnouncement: (id) => request('POST', `/announcements/${id}/end`),
    deleteAnnouncement: (id) => request('DELETE', `/announcements/${id}`),

    // Academy
    getTeachers: async () => {
        const res = await fetch(`${API_URL}/academy/teachers`, {
            headers: getHeaders()
        });
        return handleResponse(res);
    },

    deleteTeacher: (id) => request('DELETE', `/academy/teachers/${id}`),
    setTeacherInstruments: (id, instrumentIds) => request('PUT', `/academy/teachers/${id}/instruments`, { instrumentIds }),

    // Instruments
    getInstruments: (all = false) => request('GET', `/instruments${all ? '?all=1' : ''}`),
    createInstrument: (name) => request('POST', '/instruments', { name }),
    updateInstrument: (id, data) => request('PUT', `/instruments/${id}`, data),
    // Levels of an instrument, lowest first; every write answers { levels }
    getInstrumentLevels: (id) => request('GET', `/instruments/${id}/levels`),
    addInstrumentLevel: (id, name, position) => request('POST', `/instruments/${id}/levels`, { name, position }),
    renameInstrumentLevel: (id, from, to) => request('PUT', `/instruments/${id}/levels/rename`, { from, to }),
    reorderInstrumentLevels: (id, names) => request('PUT', `/instruments/${id}/levels/order`, { names }),
    deleteInstrumentLevel: (id, name) => request('DELETE', `/instruments/${id}/levels/${encodeURIComponent(name)}`),
    getArchivePreview: (id) => request('GET', `/students/${id}/archive-preview`),
    archiveStudent: (id) => request('POST', `/students/${id}/archive`),
    restoreStudent: (id) => request('POST', `/students/${id}/restore`),
    deleteStudent: (id) => request('DELETE', `/students/${id}`),
    getArchivedStudents: () => request('GET', '/students?archived=1'),
    getAcademyOverview: (month) => request('GET', `/academy/overview${query({ month })}`),
    runMaintenance: () => request('POST', '/academy/maintenance/run'),

    createTeacher: async (teacherData) => {
        const res = await fetch(`${API_URL}/academy/teachers`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify(teacherData)
        });
        return handleResponse(res);
    },

    // Settings (academy rules)
    getSettings: async () => {
        const res = await fetch(`${API_URL}/settings`, {
            headers: getHeaders()
        });
        return handleResponse(res);
    },

    updateSettings: async (values) => {
        const res = await fetch(`${API_URL}/settings`, {
            method: 'PUT',
            headers: getHeaders(),
            body: JSON.stringify(values)
        });
        return handleResponse(res);
    },

    // Cities ("sedes") with their fees and payment text
    getCities: () => request('GET', '/cities'),
    createCity: (data) => request('POST', '/cities', data),
    updateCity: (id, data) => request('PUT', `/cities/${id}`, data),
    deleteCity: (id) => request('DELETE', `/cities/${id}`),
    // A teacher's city and own payment text (empty = the city's). Prices are per city only.
    updateTeacherBilling: (id, data) => request('PUT', `/academy/teachers/${id}/billing`, data),

    // Rooms and their weekly calendar
    getRooms: () => request('GET', '/rooms'),
    createRoom: (data) => request('POST', '/rooms', data),
    updateRoom: (id, data) => request('PUT', `/rooms/${id}`, data),
    deleteRoom: (id) => request('DELETE', `/rooms/${id}`),
    setRoomTeachers: (id, teacherIds) => request('PUT', `/rooms/${id}/teachers`, { teacherIds }),
    getRoomWeek: (id, date) => request('GET', `/rooms/${id}/week${query({ date })}`),

    // Students (academy)
    getAcademyStudents: () => request('GET', '/students'),
    createStudent: (data) => request('POST', '/students', data),
    updateStudent: (id, data) => request('PUT', `/students/${id}`, data),
    resetStudentPassword: (id) => request('POST', `/students/${id}/reset-password`),

    // Assessments ("valoraciones")
    getAssessments: () => request('GET', '/assessments'),
    createAssessment: (data) => request('POST', '/assessments', data),
    updateAssessment: (id, data) => request('PUT', `/assessments/${id}`, data),
    holdAssessmentSlot: (id, slot) => request('POST', `/assessments/${id}/hold`, slot),
    releaseAssessmentHold: (id) => request('POST', `/assessments/${id}/release`),
    convertAssessment: (id, data) => request('POST', `/assessments/${id}/convert`, data),

    // Cycles ("mensualidades")
    getCycles: (filters) => request('GET', `/cycles${query(filters)}`),
    suggestCycleStart: (studentId) => request('GET', `/cycles/suggest-start${query({ studentId })}`),
    createCycle: (data) => request('POST', '/cycles', data),
    confirmCycle: (id, keepDates = false) => request('POST', `/cycles/${id}/confirm`, { keepDates }),
    rejectCycle: (id, reason) => request('POST', `/cycles/${id}/reject`, { reason }),
    cancelCycle: (id) => request('POST', `/cycles/${id}/cancel`),

    // Teacher agenda: windows, fixed schedules and lessons
    getAvailability: (teacherId) => request('GET', `/availability${query({ teacherId })}`),
    createAvailability: (data) => request('POST', '/availability', data),
    updateAvailability: (id, data) => request('PUT', `/availability/${id}`, data),
    deleteAvailability: (id) => request('DELETE', `/availability/${id}`),
    getFixedSchedules: (studentId) => request('GET', `/fixed-schedules${query({ studentId })}`),
    createFixedSchedule: (data) => request('POST', '/fixed-schedules', data),
    previewFixedSchedule: (data) => request('POST', '/fixed-schedules/preview', data),
    updateFixedSchedule: (id, data) => request('PUT', `/fixed-schedules/${id}`, data),
    endFixedSchedule: (id, endDate) => request('DELETE', `/fixed-schedules/${id}`, { endDate }),
    getLessons: (params) => request('GET', `/lessons${query(params)}`),
    getPendingMakeups: () => request('GET', '/lessons/pending-makeups'),
    // Register of teacher cancellations (academy)
    getCancellations: (month, teacherId) => request('GET', `/lessons/cancellations${query({ month, teacherId: teacherId || undefined })}`),
    cancelLessons: (lessonIds, reason) => request('POST', '/lessons/cancel', { lessonIds, reason }),
    markAttendance: (lessonId, status) => request('POST', `/lessons/${lessonId}/attendance`, { status }),
    getRescheduleOptions: (lessonId) => request('GET', `/lessons/${lessonId}/reschedule-options`),
    // option: { availabilityId | fixedScheduleId (5th-week slot), startsAt }
    rescheduleLesson: (lessonId, option) => request('POST', `/lessons/${lessonId}/reschedule`, {
        availabilityId: option.availabilityId || undefined, fixedScheduleId: option.fixedScheduleId || undefined, startsAt: option.startsAt,
    }),
    getMakeupOptions: (lessonId) => request('GET', `/lessons/${lessonId}/makeup-options`),
    bookMakeup: (lessonId, target) => request('POST', `/lessons/${lessonId}/makeup`, target),
    moveLesson: (lessonId, target) => request('POST', `/lessons/${lessonId}/move`, target),

    // Student
    getStudentOverview: () => request('GET', '/students/me/overview'),
    uploadReceipt: (cycleId, file) => {
        const form = new FormData();
        form.append('receipt', file);
        return uploadForm(`/cycles/${cycleId}/receipt`, form);
    },

    // Notices ("avisos")
    // { announcements, notifications, unread }: what the "Avisos" card shows
    getNoticeFeed: () => request('GET', '/notices/feed'),
    getNoticeHistory: () => request('GET', '/notices/history'),
    // { noticeIds?, announcementIds? }; with neither, everything is marked as read
    markNoticesRead: (ids = {}) => request('POST', '/notices/read', ids),

    // Level-up requests ("ascensos"): the teacher asks, the academy decides
    getLevelRequests: (params) => request('GET', `/level-requests${query(params)}`),
    createLevelRequest: (data) => request('POST', '/level-requests', data),
    cancelLevelRequest: (id) => request('POST', `/level-requests/${id}/cancel`),
    scheduleShowcase: (id, showcaseAt, showcasePlace) => request('POST', `/level-requests/${id}/schedule`, { showcaseAt, showcasePlace }),
    approveLevelRequest: (id, note) => request('POST', `/level-requests/${id}/approve`, { note }),
    rejectLevelRequest: (id, reason) => request('POST', `/level-requests/${id}/reject`, { reason }),

    // Teacher absences and substitutes ("reemplazos"), academy only
    getAbsences: (all = false) => request('GET', `/substitutions/absences${all ? '?all=1' : ''}`),
    createAbsence: (data) => request('POST', '/substitutions/absences', data),
    getAbsence: (id) => request('GET', `/substitutions/absences/${id}`),
    deleteAbsence: (id) => request('DELETE', `/substitutions/absences/${id}`),
    cancelUncovered: (id, reason) => request('POST', `/substitutions/absences/${id}/cancel-uncovered`, { reason }),
    // substitute: { teacherId } or { name, phone }
    assignSubstitute: (lessonIds, substitute) => request('POST', '/substitutions/assign', { lessonIds, substitute }),
    removeSubstitute: (lessonIds) => request('POST', '/substitutions/remove', { lessonIds }),
    getSubstitutionReport: (month) => request('GET', `/substitutions/report${query({ month })}`),

    // "Grados": requirements and attachments per instrument and level
    getLevelGuide: (instrumentId) => request('GET', `/level-guide/${instrumentId}`),
    saveLevelRequirement: (instrumentId, level, description) =>
        request('PUT', `/level-guide/${instrumentId}/${encodeURIComponent(level)}`, { description }),
    addLevelLink: (instrumentId, level, title, url) =>
        request('POST', `/level-guide/${instrumentId}/${encodeURIComponent(level)}/links`, { title, url }),
    uploadLevelPdf: (instrumentId, level, file, title) => {
        const form = new FormData();
        form.append('title', title || '');
        form.append('file', file);
        return uploadForm(`/level-guide/${instrumentId}/${encodeURIComponent(level)}/files`, form);
    },
    deleteLevelResource: (id) => request('DELETE', `/level-guide/resources/${id}`),
    openLevelResource: (id) => openProtectedFile(`/level-guide/resources/${id}/file`, 'No se pudo abrir el documento'),

    openReceipt: (cycleId) => openProtectedFile(`/cycles/${cycleId}/receipt`, 'No se pudo abrir el comprobante'),

    // Terms and conditions
    getTerms: () => request('GET', '/terms/current'),
    acceptTerms: (versionId) => request('POST', '/terms/accept', { versionId }),
    getTermsOverview: () => request('GET', '/terms'),
    publishTerms: (content, acceptBy) => request('POST', '/terms', { content, acceptBy: acceptBy || undefined }),

    // Payments (monthly billing)
    getMyPayments: () => request('GET', '/payments/me'),
    getPayments: (filters) => request('GET', `/payments${query(filters)}`),
    uploadPaymentReceipt: (paymentId, file) => {
        const form = new FormData();
        form.append('receipt', file);
        return uploadForm(`/payments/${paymentId}/receipt`, form);
    },
    openPaymentReceipt: (paymentId, receiptId) => openProtectedFile(`/payments/${paymentId}/receipts/${receiptId}`, 'No se pudo abrir el comprobante'),
    approvePayment: (paymentId) => request('POST', `/payments/${paymentId}/approve`),
    rejectPayment: (paymentId, reason) => request('POST', `/payments/${paymentId}/reject`, { reason }),
    addPaymentAdjustment: (paymentId, amount, reason) => request('POST', `/payments/${paymentId}/adjustments`, { amount, reason }),
    getPaymentHistory: (paymentId) => request('GET', `/payments/${paymentId}/history`),
    chargeSingleClass: (studentId, date) => request('POST', '/payments/single-class', { studentId, date }),
    // The academy gives `count` single classes of a month in one charge; classes: dates already agreed (optional)
    bookSingleClasses: (studentId, period, count, classes = []) => request('POST', '/payments/single-classes', { studentId, period, count, classes }),
    getPendingSingleClasses: () => request('GET', '/payments/single-classes/pending'),
    scheduleSingleClass: (paymentId, target) => request('POST', `/payments/${paymentId}/classes`, target),
    chargeMonthByHand: (studentId, period) => request('POST', '/payments/monthly', { studentId, period }),
};
