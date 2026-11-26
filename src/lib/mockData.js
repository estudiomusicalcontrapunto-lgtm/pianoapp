
export const CURRENT_USER_ID = "student-1";

export const MOCK_TEACHER = {
    id: "teacher-1",
    name: "Maestro Piano",
    role: "teacher",
    email: "maestro@piano.com",
    password: "password",
    classCode: "123456"
};


export const MOCK_STUDENTS = [];


export const MOCK_ANNOUNCEMENTS = [
    {
        id: "ann-1",
        title: "Recital de Primavera",
        content: "Hola a todos, el recital será el 15 de Noviembre. ¡Preparen sus obras!",
        date: "2023-10-20",
        author: "Maestro Piano",
    },
    {
        id: "ann-2",
        title: "Clase grupal cancelada",
        content: "La clase de teoría de este viernes se mueve al sábado.",
        date: "2023-10-25",
        author: "Maestro Piano",
    },
];

// The standard ladder (STANDARD_LEVELS in server/domain/levels.js). Each instrument
// has its own ladder; this one is only for a student without an instrument.
export const LEVELS = [
    "Inicial", "1", "2", "3", "4", "5", "6", "7", "8",
    "Prodigy", "Legend", "Genius"
];
