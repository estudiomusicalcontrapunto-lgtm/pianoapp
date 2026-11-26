const test = require('node:test');
const assert = require('node:assert/strict');
const {
    canViewStudent,
    canManageStudentBookings,
    canManageTeacherAgenda,
    canBookMakeupAsTeacher,
} = require('../domain/permissions');

const academy = { id: 'a1', role: 'academy' };
const teacherA = { id: 't1', role: 'teacher' };
const teacherB = { id: 't2', role: 'teacher' };
const student = { id: 's1', role: 'student', teacherId: 't1' };
const otherStudent = { id: 's2', role: 'student', teacherId: 't2' };

test('un profesor solo ve a sus estudiantes', () => {
    assert.equal(canViewStudent(teacherA, student), true);
    assert.equal(canViewStudent(teacherA, otherStudent), false);
    assert.equal(canViewStudent(teacherB, student), false);
});

test('un estudiante solo se ve a sí mismo; la academia ve a todos', () => {
    assert.equal(canViewStudent(student, student), true);
    assert.equal(canViewStudent(student, otherStudent), false);
    assert.equal(canViewStudent(academy, otherStudent), true);
});

test('reprogramar y pagar: el propio estudiante o la academia, nunca el profesor', () => {
    assert.equal(canManageStudentBookings(student, student), true);
    assert.equal(canManageStudentBookings(otherStudent, student), false);
    assert.equal(canManageStudentBookings(teacherA, student), false);
    assert.equal(canManageStudentBookings(academy, student), true);
});

test('la agenda de un profesor solo la edita él o la academia', () => {
    assert.equal(canManageTeacherAgenda(teacherA, 't1'), true);
    assert.equal(canManageTeacherAgenda(teacherB, 't1'), false);
    assert.equal(canManageTeacherAgenda(student, 't1'), false);
    assert.equal(canManageTeacherAgenda(academy, 't1'), true);
});

test('un profesor puede agendar la reposición de una clase suya', () => {
    assert.equal(canBookMakeupAsTeacher(teacherA, { teacherId: 't1' }), true);
    assert.equal(canBookMakeupAsTeacher(teacherB, { teacherId: 't1' }), false);
});
