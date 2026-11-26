// Who can see or act on what. Actors and students are plain objects
// ({ id, role, teacherId }), so these rules are testable without a database.
const { ROLES } = require('./constants');

const isAcademy = (actor) => actor?.role === ROLES.ACADEMY;

// Academy sees everyone; a teacher sees their assigned students; a student sees themself
const canViewStudent = (actor, student) => {
    if (!actor || !student || student.role !== ROLES.STUDENT) return false;
    if (isAcademy(actor)) return true;
    if (actor.role === ROLES.TEACHER) return student.teacherId === actor.id;
    if (actor.role === ROLES.STUDENT) return student.id === actor.id;
    return false;
};

// Rescheduling, booking make-ups and uploading receipts. The student account
// (used together with the parent) does it; the academy can do it on their behalf.
const canManageStudentBookings = (actor, student) => {
    if (!actor || !student || student.role !== ROLES.STUDENT) return false;
    return isAcademy(actor) || (actor.role === ROLES.STUDENT && actor.id === student.id);
};

// Availability, fixed schedules, cancellations and attendance belong to a teacher
const canManageTeacherAgenda = (actor, teacherId) => {
    if (!actor) return false;
    return isAcademy(actor) || (actor.role === ROLES.TEACHER && actor.id === teacherId);
};

// A teacher may book a make-up for a lesson they teach
const canBookMakeupAsTeacher = (actor, lesson) =>
    actor?.role === ROLES.TEACHER && lesson?.teacherId === actor.id;

module.exports = {
    isAcademy,
    canViewStudent,
    canManageStudentBookings,
    canManageTeacherAgenda,
    canBookMakeupAsTeacher,
};
