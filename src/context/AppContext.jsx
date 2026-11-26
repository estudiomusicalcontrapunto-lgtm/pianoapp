import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';

const AppContext = createContext();

export const AppProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [students, setStudents] = useState([]); 
    const [teachers, setTeachers] = useState([]); // For academy
    const [loading, setLoading] = useState(true);

    // Initial load
    const loadData = useCallback(async () => {
        setLoading(true);
        const token = localStorage.getItem('pianoApp_token');
        if (!token) {
            setLoading(false);
            return;
        }

        try {
            const profile = await api.getProfile();
            setUser(profile);

            if (profile.role === 'teacher') {
                const studentsData = await api.getStudents();
                setStudents(studentsData);
            } else if (profile.role === 'academy') {
                const teachersData = await api.getTeachers();
                setTeachers(teachersData);
            } else {
                setStudents([profile]);
            }
        } catch (error) {
            console.error("Error loading data:", error);
            // If token is invalid
            localStorage.removeItem('pianoApp_token');
            setUser(null);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadData();
    }, [loadData]);

    // Auth Actions
    const login = async (email, password) => {
        try {
            const data = await api.login(email, password);
            localStorage.setItem('pianoApp_token', data.token);
            await loadData();
            return { success: true };
        } catch (error) {
            return { success: false, message: error.message };
        }
    };

    const logout = () => {
        localStorage.removeItem('pianoApp_token');
        setUser(null);
        setStudents([]);
    };

    const markPasswordChanged = () => {
        setUser(prev => (prev ? { ...prev, mustChangePassword: false } : prev));
    };

    // Helper to update student locally
    const updateLocalStudent = (studentId, updatedData) => {
        setStudents(prev => prev.map(s => s.id === studentId ? { ...s, ...updatedData } : s));
        if (user && user.id === studentId) {
            setUser(prev => ({ ...prev, ...updatedData }));
        }
    };

    // Helper to update repertoire locally
    const updateLocalRepertoire = (studentId, repertoireId, updates) => {
        setStudents(prev => prev.map(s => {
            if (s.id !== studentId) return s;
            return {
                ...s,
                repertoire: s.repertoire.map(rep => 
                    rep.id === repertoireId ? { ...rep, ...updates } : rep
                )
            };
        }));

        if (user && user.id === studentId) {
            setUser(prev => ({
                ...prev,
                repertoire: prev.repertoire.map(rep => 
                    rep.id === repertoireId ? { ...rep, ...updates } : rep
                )
            }));
        }
    };

    // Student Actions
    const updateProgress = async (studentId, repertoireId, newProgress) => {
        // Optimistic UI update
        updateLocalRepertoire(studentId, repertoireId, { progress: newProgress });
        try {
            await api.updateRepertoire(studentId, repertoireId, { progress: newProgress });
        } catch (error) {
            console.error("Failed to update progress:", error);
            await loadData(); // Revert on failure
        }
    };

    const incrementRepetitions = async (studentId, repertoireId, count = 1) => {
        // Optimistic update
        setStudents(prev => prev.map(s => {
            if (s.id !== studentId) return s;
            return {
                ...s,
                repertoire: s.repertoire.map(rep => 
                    rep.id === repertoireId ? { ...rep, repetitions: (rep.repetitions || 0) + count } : rep
                )
            };
        }));
        if (user && user.id === studentId) {
            setUser(prev => ({
                ...prev,
                repertoire: prev.repertoire.map(rep => 
                    rep.id === repertoireId ? { ...rep, repetitions: (rep.repetitions || 0) + count } : rep
                )
            }));
        }

        try {
            await api.updateRepertoire(studentId, repertoireId, { increment: count, repetitions: 0 }); // Passing increment flag
        } catch (error) {
            console.error("Failed to increment repetitions:", error);
            await loadData();
        }
    };

    const updateStudentNotes = async (studentId, repertoireId, notes) => {
        updateLocalRepertoire(studentId, repertoireId, { studentNotes: notes });
        try {
            await api.updateRepertoire(studentId, repertoireId, { studentNotes: notes });
        } catch (error) {
            console.error("Failed to update student notes", error);
        }
    };

    // Marks today (America/Bogota) as practiced; the server computes the streak
    const togglePracticeStreak = async (studentId) => {
        try {
            const { streak, lastPractice } = await api.practice();
            updateLocalStudent(studentId, { streak, lastPractice });
        } catch (error) {
            console.error("Failed to update streak", error);
            await loadData();
        }
    };

    // Teacher Actions
    const updateTeacherNotes = async (studentId, repertoireId, notes) => {
        updateLocalRepertoire(studentId, repertoireId, { teacherNotes: notes });
        try {
            await api.updateRepertoire(studentId, repertoireId, { teacherNotes: notes });
        } catch (error) {
            console.error("Failed to update teacher notes", error);
        }
    };

    const assignRepertoire = async (studentId, pieceData) => {
        try {
            const updatedStudent = await api.assignRepertoire(studentId, pieceData);
            updateLocalStudent(studentId, { repertoire: updatedStudent.repertoire });
        } catch (error) {
            console.error("Failed to assign repertoire", error);
        }
    };

    const updateCurrentMeasure = async (studentId, repertoireId, measure) => {
        setStudents(prev => {
            const student = prev.find(s => s.id === studentId);
            if(!student) return prev;
            const rep = student.repertoire.find(r => r.id === repertoireId);
            if(!rep) return prev;
            
            const newMeasure = Math.max(0, Math.min(measure, rep.measureCount || 0));
            const newProgress = rep.measureCount > 0 ? Math.round((newMeasure / rep.measureCount) * 100) : rep.progress;

            updateLocalRepertoire(studentId, repertoireId, { currentMeasure: newMeasure, progress: newProgress });
            
            api.updateRepertoire(studentId, repertoireId, { currentMeasure: newMeasure, progress: newProgress })
                .catch(e => console.error("Failed to update measure", e));
            
            return prev; 
        });
    };

    const updateRiskMap = async (studentId, repertoireId, riskMap) => {
        updateLocalRepertoire(studentId, repertoireId, { riskMap });
        try {
            await api.updateRepertoire(studentId, repertoireId, { riskMap });
        } catch (error) {
            console.error("Failed to update risk map", error);
        }
    };

    const deleteRepertoire = async (studentId, repertoireId) => {
        // Optimistic
        setStudents(prev => prev.map(s => {
            if (s.id !== studentId) return s;
            return { ...s, repertoire: s.repertoire.filter(r => r.id !== repertoireId) };
        }));
        if (user && user.id === studentId) {
            setUser(prev => ({ ...prev, repertoire: prev.repertoire.filter(r => r.id !== repertoireId) }));
        }

        try {
            await api.deleteRepertoire(studentId, repertoireId);
        } catch (error) {
            console.error("Failed to delete repertoire", error);
            await loadData();
        }
    };

    const updateRepertoirePdf = async (studentId, repertoireId, pdfUrl) => {
        updateLocalRepertoire(studentId, repertoireId, { pdfUrl });
        try {
            await api.updateRepertoire(studentId, repertoireId, { pdfUrl });
        } catch (error) {
            console.error("Failed to update PDF", error);
        }
    };

    const createTeacher = async (teacherData) => {
        try {
            const newTeacher = await api.createTeacher(teacherData);
            // newTeacher will not have students initially, but we should add it to state
            setTeachers(prev => [...prev, { ...newTeacher, students: [] }]);
            return { success: true };
        } catch (error) {
            console.error("Failed to create teacher", error);
            return { success: false, message: error.message };
        }
    };

    const deleteTeacher = async (teacherId) => {
        try {
            await api.deleteTeacher(teacherId);
            setTeachers(prev => prev.filter(t => t.id !== teacherId));
            return { success: true };
        } catch (error) {
            return { success: false, message: error.message };
        }
    };

    // Reload teachers (e.g. after students change teacher)
    const refreshTeachers = async () => {
        try {
            setTeachers(await api.getTeachers());
        } catch (error) {
            console.error("Failed to reload teachers", error);
        }
    };

    return (
        <AppContext.Provider value={{
            user,
            students,
            loading,
            login,
            logout,
            markPasswordChanged,
            updateProgress,
            updateCurrentMeasure,
            incrementRepetitions,
            updateStudentNotes,
            togglePracticeStreak,
            updateTeacherNotes,
            assignRepertoire,
            updateRiskMap,
            deleteRepertoire,
            updateRepertoirePdf,
            teachers,
            createTeacher,
            deleteTeacher,
            refreshTeachers
        }}>
            {children}
        </AppContext.Provider>
    );
};

export const useApp = () => useContext(AppContext);
