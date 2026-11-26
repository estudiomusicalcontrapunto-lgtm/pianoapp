
import React from 'react';
import { useApp } from '../context/AppContext';
import {
    LayoutDashboard,
    Music,
    BookOpen,
    Award,
    Users,
    Megaphone,
    LogOut,
    Menu,
    X,
    Settings,
    GraduationCap,
    ClipboardList,
    DoorOpen,
    CalendarDays,
    ListChecks,
    UserRoundCheck,
    CalendarX,
    Wallet,
    FileText,
    Home,
    UserRound
} from 'lucide-react';
import { useState } from 'react';
import { cn, ROLE_LABELS } from '../lib/utils';
import { ChangePasswordModal } from './ChangePasswordModal';

export function Layout({ children, currentView, onViewChange }) {
    const { user, logout, markPasswordChanged } = useApp();
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);

    if (!user) return <>{children}</>;

    const studentNav = [
        { id: 'dashboard', label: 'Inicio', icon: LayoutDashboard },
        { id: 'classes', label: 'Mis clases', icon: CalendarDays },
        { id: 'payments', label: 'Pagos', icon: Wallet },
        { id: 'repertoire', label: 'Repertorio', icon: Music },
        // Practice merged into Repertoire
        { id: 'level', label: 'Mi Nivel', icon: Award },
    ];

    const teacherNav = [
        { id: 'dashboard', label: 'Resumen', icon: LayoutDashboard },
        { id: 'agenda', label: 'Mi agenda', icon: CalendarDays },
        { id: 'students', label: 'Mis estudiantes', icon: GraduationCap },
        { id: 'grades', label: 'Grados', icon: ListChecks },
        { id: 'announcements', label: 'Anuncios', icon: Megaphone },
    ];

    const academyNav = [
        { id: 'dashboard', label: 'Panel', icon: LayoutDashboard },
        { id: 'payments', label: 'Pagos', icon: Wallet },
        { id: 'teachers', label: 'Profesores', icon: Users },
        { id: 'students', label: 'Estudiantes', icon: GraduationCap },
        { id: 'substitutes', label: 'Reemplazos', icon: UserRoundCheck },
        { id: 'cancellations', label: 'Cancelaciones', icon: CalendarX },
        { id: 'assessments', label: 'Valoraciones', icon: ClipboardList },
        { id: 'grades', label: 'Grados', icon: ListChecks },
        { id: 'levels', label: 'Ascensos', icon: Award },
        { id: 'announcements', label: 'Anuncios', icon: Megaphone },
        { id: 'rooms', label: 'Salones', icon: DoorOpen },
        { id: 'terms', label: 'Términos', icon: FileText },
        { id: 'settings', label: 'Ajustes', icon: Settings },
    ];

    const navItems = user.role === 'academy' ? academyNav : user.role === 'teacher' ? teacherNav : studentNav;

    // Phone: the student gets a bottom bar with 4 sections instead of the side menu
    const isStudent = user.role === 'student';
    const bottomNav = [
        { id: 'dashboard', label: 'Inicio', icon: Home, matches: ['dashboard', 'notices'] },
        { id: 'classes', label: 'Mis clases', icon: CalendarDays, matches: ['classes'] },
        { id: 'payments', label: 'Pagos', icon: Wallet, matches: ['payments'] },
        { id: 'profile', label: 'Perfil', icon: UserRound, matches: ['profile', 'level', 'repertoire'] },
    ];

    return (
        <div className="min-h-screen bg-background flex">
            {/* Mobile Sidebar Overlay */}
            {isSidebarOpen && (
                <div
                    className="fixed inset-0 z-40 bg-black/50 md:hidden"
                    onClick={() => setIsSidebarOpen(false)}
                />
            )}

            {/* Sidebar */}
            <aside className={cn(
                "fixed inset-y-0 left-0 z-50 w-64 bg-sidebar text-sidebar-foreground transition-transform duration-300 md:sticky md:top-0 md:h-screen md:translate-x-0",
                isSidebarOpen ? "translate-x-0" : "-translate-x-full"
            )}>
                <div className="p-5 h-full flex flex-col overflow-y-auto">
                    <div className="flex items-start justify-between mb-6">
                        <img
                            src="/brand/logo-cream.png"
                            alt="Contrapunto · Estudio Musical"
                            className="w-48 h-auto select-none"
                            draggable={false}
                        />
                        <button
                            onClick={() => setIsSidebarOpen(false)}
                            className="md:hidden p-1 rounded hover:bg-white/10"
                        >
                            <X size={20} />
                        </button>
                    </div>

                    <div className="mb-6 flex items-center gap-3 px-3 py-3 rounded-lg bg-white/5 border border-white/10">
                        <div className="h-10 w-10 shrink-0 rounded-full border border-sidebar-foreground/40 flex items-center justify-center font-medium text-lg">
                            {user.name.charAt(0)}
                        </div>
                        <div className="overflow-hidden">
                            <p className="text-sm font-medium truncate">{user.name}</p>
                            <p className="text-xs uppercase tracking-[0.18em] text-sidebar-muted">{ROLE_LABELS[user.role] || user.role}</p>
                        </div>
                    </div>

                    <nav className="space-y-0.5 flex-1">
                        {navItems.map((item) => {
                            const Icon = item.icon;
                            const isActive = currentView === item.id;
                            return (
                                <button
                                    key={item.id}
                                    onClick={() => {
                                        onViewChange(item.id);
                                        setIsSidebarOpen(false);
                                    }}
                                    className={cn(
                                        "w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                                        isActive
                                            ? "bg-sidebar-foreground text-sidebar font-medium"
                                            : "text-sidebar-foreground/75 hover:bg-white/10 hover:text-sidebar-foreground"
                                    )}
                                >
                                    <Icon size={18} strokeWidth={isActive ? 2.2 : 1.8} />
                                    <span className="flex-1 text-left">{item.label}</span>
                                    {/* The "punto" of the logo marks where you are */}
                                    {isActive && <span className="h-2 w-2 rounded-full bg-brand" aria-hidden="true" />}
                                </button>
                            );
                        })}
                    </nav>

                    <div className="mt-auto pt-5 border-t border-white/10">
                        <button
                            className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm text-sidebar-foreground/75 hover:bg-white/10 hover:text-sidebar-foreground transition-colors"
                            onClick={logout}
                        >
                            <LogOut size={18} strokeWidth={1.8} />
                            Cerrar sesión
                        </button>
                    </div>
                </div>
            </aside>

            {/* Main Content */}
            <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
                {/* Mobile Header */}
                <header className="md:hidden h-16 flex items-center px-4 bg-sidebar text-sidebar-foreground">
                    {!isStudent && (
                        <button
                            onClick={() => setIsSidebarOpen(true)}
                            className="h-11 w-11 -ml-2 flex items-center justify-center rounded-md hover:bg-white/10"
                            aria-label="Abrir menú"
                        >
                            <Menu size={24} />
                        </button>
                    )}
                    <img src="/brand/logo-cream.png" alt="Contrapunto · Estudio Musical" className={cn("h-11 w-auto", !isStudent && "ml-3")} />
                </header>

                <div className={cn("flex-1 overflow-auto p-4 md:p-8", isStudent && "pb-28 md:pb-8")}>
                    <div className="mx-auto max-w-6xl animate-in fade-in duration-500">
                        {children}
                    </div>
                </div>
            </main>

            {isStudent && (
                <nav
                    className="md:hidden fixed inset-x-0 bottom-0 z-40 border-t bg-card pb-[env(safe-area-inset-bottom)] shadow-[0_-2px_8px_rgba(0,0,0,0.06)]"
                    aria-label="Navegación principal"
                >
                    <ul className="grid grid-cols-4">
                        {bottomNav.map(item => {
                            const Icon = item.icon;
                            const active = item.matches.includes(currentView);
                            return (
                                <li key={item.id}>
                                    <button
                                        onClick={() => onViewChange(item.id)}
                                        className={cn(
                                            "flex h-16 w-full flex-col items-center justify-center gap-1 text-xs",
                                            active ? "text-primary font-semibold" : "text-muted-foreground"
                                        )}
                                        aria-current={active ? 'page' : undefined}
                                    >
                                        <Icon size={22} strokeWidth={active ? 2.4 : 1.8} />
                                        {item.label}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                </nav>
            )}

            {user.mustChangePassword && <ChangePasswordModal onChanged={markPasswordChanged} />}
        </div>
    );
}
