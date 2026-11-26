import React, { useState } from 'react';
import { Award, ChevronRight, FileText, KeyRound, LogOut, Music } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { api } from '../lib/api';
import { useApiData } from '../lib/useApiData';
import { inputClass } from '../lib/utils';
import { levelLabel } from '../lib/labels';
import { formatDateTime } from '../lib/time';
import { Card, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal, Field } from '../components/ui/Modal';

function PasswordModal({ onClose }) {
    const [form, setForm] = useState({ current: '', next: '', repeat: '' });
    const [error, setError] = useState('');
    const [done, setDone] = useState(false);
    const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });
    const submit = async (e) => {
        e.preventDefault();
        setError('');
        if (form.next !== form.repeat) {
            setError('Las contraseñas nuevas no coinciden.');
            return;
        }
        try {
            await api.changePassword(form.current, form.next);
            setDone(true);
        } catch (err) {
            setError(err.message);
        }
    };
    return (
        <Modal title="Cambiar contraseña" onClose={onClose}>
            {done ? (
                <div className="space-y-4">
                    <p className="text-sm text-green-700">Listo: tu contraseña quedó cambiada.</p>
                    <Button className="w-full" onClick={onClose}>Cerrar</Button>
                </div>
            ) : (
                <form onSubmit={submit} className="space-y-4">
                    <Field label="Contraseña actual"><input type="password" autoComplete="current-password" className={inputClass} value={form.current} onChange={set('current')} required /></Field>
                    <Field label="Nueva contraseña" hint="Mínimo 8 caracteres."><input type="password" autoComplete="new-password" minLength={8} className={inputClass} value={form.next} onChange={set('next')} required /></Field>
                    <Field label="Repite la nueva contraseña"><input type="password" autoComplete="new-password" className={inputClass} value={form.repeat} onChange={set('repeat')} required /></Field>
                    {error && <p className="text-sm text-red-600">{error}</p>}
                    <Button type="submit" className="w-full">Guardar contraseña</Button>
                </form>
            )}
        </Modal>
    );
}

function TermsModal({ onClose }) {
    const { data, error } = useApiData(() => api.getTerms(), []);
    return (
        <Modal title="Términos y condiciones" onClose={onClose}>
            {error && <p className="text-sm text-red-600">{error}</p>}
            {data && !data.version && <p className="text-sm text-muted-foreground">La academia aún no ha publicado términos y condiciones.</p>}
            {data?.version && (
                <div className="space-y-3">
                    <p className="text-xs text-muted-foreground">
                        Versión {data.version.version}
                        {data.status?.accepted && data.status.acceptedAt && ` · la aceptaste el ${formatDateTime(data.status.acceptedAt)}`}
                    </p>
                    <p className="text-sm whitespace-pre-line">{data.version.content}</p>
                </div>
            )}
        </Modal>
    );
}

const Row = ({ icon, label, hint, onClick, danger }) => (
    <button onClick={onClick} className={`flex w-full min-h-14 items-center gap-3 px-4 py-3 text-left hover:bg-accent ${danger ? 'text-red-700' : ''}`}>
        {React.createElement(icon, { size: 20, className: danger ? '' : 'text-primary' })}
        <span className="flex-1">
            <span className="block text-sm font-medium">{label}</span>
            {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
        </span>
        {!danger && <ChevronRight size={18} className="text-muted-foreground" />}
    </button>
);

/** "Perfil" (phone bottom bar): the student's data, level, repertoire, password and terms. */
export function StudentProfile({ onViewChange }) {
    const { user, logout } = useApp();
    const [modal, setModal] = useState(null);

    return (
        <div className="space-y-4">
            <Card>
                <CardContent className="p-4 flex items-center gap-3">
                    <div className="h-12 w-12 shrink-0 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xl font-bold">{user.name.charAt(0)}</div>
                    <div className="min-w-0">
                        <p className="font-semibold truncate">{user.name}</p>
                        <p className="text-sm text-muted-foreground truncate">{user.email}</p>
                        <p className="text-xs text-muted-foreground">{user.instrument?.name ? `${user.instrument.name} · ` : ''}{levelLabel(user.level)}</p>
                    </div>
                </CardContent>
            </Card>

            <Card className="overflow-hidden">
                <div className="divide-y">
                    <Row icon={Award} label="Mi nivel" hint="Tu nivel y los requisitos para subir" onClick={() => onViewChange('level')} />
                    <Row icon={Music} label="Repertorio y práctica" hint="Tus obras y tu racha de estudio" onClick={() => onViewChange('repertoire')} />
                    <Row icon={KeyRound} label="Cambiar contraseña" onClick={() => setModal('password')} />
                    <Row icon={FileText} label="Términos y condiciones" onClick={() => setModal('terms')} />
                    <Row icon={LogOut} label="Cerrar sesión" onClick={logout} danger />
                </div>
            </Card>

            {modal === 'password' && <PasswordModal onClose={() => setModal(null)} />}
            {modal === 'terms' && <TermsModal onClose={() => setModal(null)} />}
        </div>
    );
}
