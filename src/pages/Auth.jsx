
import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Button } from '../components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { KeyRound } from 'lucide-react';

// Login only: the academy creates every account
export function Auth({ onLoginSuccess }) {
    const { login } = useApp();
    const [formData, setFormData] = useState({
        email: '',
        password: ''
    });
    const [error, setError] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');

        const result = await login(formData.email, formData.password);
        if (result.success) {
            onLoginSuccess();
        } else {
            setError(result.message);
        }
    };

    return (
        <div className="relative min-h-screen flex items-center justify-center bg-sidebar p-4 overflow-hidden">
            {/* A wide staff behind the card, like the one in the logo */}
            <div
                className="staff-lines absolute inset-x-0 top-1/2 -translate-y-1/2 h-[141px] text-sidebar-foreground/10 pointer-events-none"
                aria-hidden="true"
            />

            <Card className="w-full max-w-md relative z-10 border-0 shadow-2xl">
                <CardHeader className="items-center text-center space-y-4 pt-8">
                    <img src="/brand/logo-ink.png" alt="Contrapunto · Estudio Musical" className="w-64 h-auto" />
                    <CardTitle className="text-lg font-medium uppercase tracking-[0.2em] text-muted-foreground">
                        Iniciar sesión
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Email</label>
                            <input
                                type="email"
                                className="w-full p-2 rounded-md border bg-background"
                                value={formData.email}
                                onChange={e => setFormData({ ...formData, email: e.target.value })}
                            />
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium">Contraseña</label>
                            <div className="relative">
                                <KeyRound size={16} className="absolute left-3 top-3 text-muted-foreground" />
                                <input
                                    type="password"
                                    className="w-full p-2 pl-9 rounded-md border bg-background"
                                    value={formData.password}
                                    onChange={e => setFormData({ ...formData, password: e.target.value })}
                                />
                            </div>
                        </div>

                        {error && <p className="text-destructive text-sm">{error}</p>}

                        <Button type="submit" className="w-full" size="lg">
                            Entrar
                        </Button>
                    </form>

                    <p className="mt-6 text-center text-sm text-muted-foreground">
                        ¿No tienes cuenta? La academia te la crea cuando confirmas tu mensualidad.
                    </p>
                </CardContent>
            </Card>
        </div>
    );
}
