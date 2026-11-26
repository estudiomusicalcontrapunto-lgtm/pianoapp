
import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';

// Shows a new account's temporary password once, so the academy can hand it over
export function TempPasswordModal({ name, email, password, onClose }) {
    const [copied, setCopied] = useState(false);

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(`PianoApp\nUsuario: ${email}\nContraseña temporal: ${password}`);
            setCopied(true);
        } catch {
            setCopied(false);
        }
    };

    return (
        <Modal title="Cuenta lista" onClose={onClose}>
            <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                    Entrégale estos datos a {name}. Al entrar por primera vez se le pedirá cambiar la contraseña.
                    Esta contraseña no se volverá a mostrar.
                </p>
                <div className="rounded-lg border bg-secondary/40 p-4 space-y-1 font-mono text-sm">
                    <p><span className="text-muted-foreground">Usuario:</span> {email}</p>
                    <p><span className="text-muted-foreground">Contraseña:</span> {password}</p>
                </div>
                <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={copy} className="gap-2">
                        {copied ? <Check size={16} /> : <Copy size={16} />}
                        {copied ? 'Copiado' : 'Copiar'}
                    </Button>
                    <Button onClick={onClose}>Listo</Button>
                </div>
            </div>
        </Modal>
    );
}
