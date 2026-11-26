
import React, { useState } from 'react';
import { api } from '../lib/api';
import { inputClass } from '../lib/utils';
import { Modal, Field } from './ui/Modal';
import { Button } from './ui/Button';

// Shown on first login with a temporary password; cannot be dismissed
export function ChangePasswordModal({ onChanged }) {
    const [form, setForm] = useState({ current: '', next: '', repeat: '' });
    const [error, setError] = useState('');
    const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        if (form.next !== form.repeat) {
            setError('Las contraseñas nuevas no coinciden.');
            return;
        }
        try {
            await api.changePassword(form.current, form.next);
            onChanged();
        } catch (err) {
            setError(err.message);
        }
    };

    return (
        <Modal title="Crea tu contraseña">
            <form onSubmit={handleSubmit} className="space-y-4">
                <p className="text-sm text-muted-foreground">Estás usando la contraseña temporal que te dio la academia. Elige una nueva para continuar.</p>
                <Field label="Contraseña temporal"><input type="password" className={inputClass} value={form.current} onChange={set('current')} required /></Field>
                <Field label="Nueva contraseña" hint="Mínimo 8 caracteres."><input type="password" minLength={8} className={inputClass} value={form.next} onChange={set('next')} required /></Field>
                <Field label="Repite la nueva contraseña"><input type="password" className={inputClass} value={form.repeat} onChange={set('repeat')} required /></Field>
                {error && <p className="text-sm text-red-500">{error}</p>}
                <Button type="submit" className="w-full">Guardar contraseña</Button>
            </form>
        </Modal>
    );
}
