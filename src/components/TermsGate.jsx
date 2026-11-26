import React, { useState } from 'react';
import { FileText } from 'lucide-react';
import { api } from '../lib/api';
import { useApiData } from '../lib/useApiData';
import { formatDay, localParts } from '../lib/time';
import { Button } from './ui/Button';

// The terms to read and accept, full screen (a phone is where most families use the app)
function TermsScreen({ terms, onAccepted, onLater, onLogout }) {
    const [checked, setChecked] = useState(false);
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const { version, status } = terms;

    const accept = async () => {
        setSaving(true);
        setError('');
        try {
            await api.acceptTerms(version.id);
            onAccepted();
        } catch (err) {
            setError(err.message);
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[60] flex flex-col bg-background" role="dialog" aria-modal="true" aria-labelledby="terms-title">
            <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col overflow-hidden p-4 md:p-8">
                <h1 id="terms-title" className="text-2xl font-bold flex items-center gap-2"><FileText className="text-primary" />Términos y condiciones</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    Versión {version.version}, publicada el {formatDay(localParts(version.publishedAt).date)}.
                </p>
                <p className="mt-3 rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-900">{status.message}</p>
                <div className="mt-3 flex-1 overflow-y-auto rounded-lg border bg-card p-4 text-sm leading-relaxed whitespace-pre-line" tabIndex={0}>
                    {version.content}
                </div>
                <label className="mt-4 flex min-h-11 items-center gap-3 cursor-pointer">
                    <input type="checkbox" className="h-5 w-5" checked={checked} onChange={e => setChecked(e.target.checked)} />
                    <span className="text-sm font-medium">Leí y acepto los términos y condiciones</span>
                </label>
                {error && <p className="text-sm text-red-600">{error}</p>}
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <Button className="min-h-11" disabled={!checked || saving} onClick={accept}>{saving ? 'Guardando...' : 'Aceptar'}</Button>
                    {status.canPostpone
                        ? <Button variant="outline" className="min-h-11" onClick={onLater}>Más tarde</Button>
                        : <Button variant="outline" className="min-h-11" onClick={onLogout}>Cerrar sesión</Button>}
                </div>
            </div>
        </div>
    );
}

/**
 * Students must accept the current terms. A new student (or one past the
 * deadline) only sees the terms until accepting; a current student may postpone
 * them until the deadline: a banner stays on and booking is blocked meanwhile.
 */
export function TermsGate({ user, onLogout, children }) {
    const isStudent = user?.role === 'student';
    const { data: terms, reload: load } = useApiData(() => (isStudent ? api.getTerms() : Promise.resolve(null)), [user?.id, isStudent]);
    const [postponed, setPostponed] = useState(false);

    const status = terms?.status;
    if (!status?.required) return children;

    if (status.blocking || !postponed) {
        return (
            <>
                {!status.blocking && children}
                <TermsScreen terms={terms} onAccepted={load} onLater={() => setPostponed(true)} onLogout={onLogout} />
            </>
        );
    }

    return (
        <>
            <div className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-2 border-b border-orange-200 bg-orange-50 px-4 py-2 text-sm text-orange-900">
                <span>
                    Tienes términos y condiciones por aceptar{status.deadline ? ` (a más tardar el ${formatDay(status.deadline)})` : ''}. Mientras tanto no puedes cambiar clases.
                </span>
                <Button size="sm" className="min-h-11" onClick={() => setPostponed(false)}>Leer y aceptar</Button>
            </div>
            {children}
        </>
    );
}
