import React, { useEffect, useState } from 'react';
import { FileText, Send } from 'lucide-react';
import { api } from '../lib/api';
import { useApiData } from '../lib/useApiData';
import { inputClass } from '../lib/utils';
import { formatDateTime, formatDay, localParts } from '../lib/time';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';

// A starting point for the first version, written from the academy's rules. The academy edits it before publishing.
const TEMPLATE = `TÉRMINOS Y CONDICIONES DE CONTRAPUNTO · ESTUDIO MUSICAL

1. Clases
• Cada estudiante tiene una clase semanal en su horario fijo.
• Puedes cancelar o cambiar una clase con al menos 12 horas de anticipación. Al cambiarla eliges un cupo de reposición de tu profesor dentro del mismo mes.
• Las reposiciones se toman dentro del mismo mes; las que no se tomen se pierden al terminar el mes.
• Una reposición no se puede volver a cambiar. Si la cancelas o no asistes, se pierde.
• Si no asistes a una clase y no la cambiaste a tiempo, la clase se pierde.
• Los festivos son días normales de clase.
• Si el profesor cancela una clase, siempre se repone. El profesor la agenda a más tardar al final del mes siguiente; si no se alcanza a dar, se descuenta el valor de una clase suelta de tu siguiente pago.

2. Pagos
• La mensualidad se paga del 1 al 5 de cada mes y cubre 4 clases. Si en el mes tu día de clase cae una 5.ª vez, esa semana es para reposiciones.
• Si te inscribes a mitad de mes, pagas las clases que quedan en el mes, sin superar el valor de la mensualidad.
• Desde el día 6, si no has pagado, no puedes agendar y tu horario queda libre para otro estudiante. Las clases que hayas tomado ese mes se cobran como clases sueltas.
• No hay vacaciones del estudio: si un mes no vienes, simplemente no pagas ese mes y pierdes tu horario. Al volver te asignamos un horario según la disponibilidad.
• Envía en la app el comprobante de cada pago. La academia lo revisa y te avisa si fue aprobado o, si fue rechazado, el motivo.

3. Datos y comunicación
• La academia usa tus datos de contacto solo para la gestión de tus clases y pagos.
`;

export function AcademyTerms() {
    const { data, error, reload } = useApiData(() => api.getTermsOverview(), []);
    const [content, setContent] = useState('');
    const [acceptBy, setAcceptBy] = useState('');
    const [message, setMessage] = useState(null);
    const [saving, setSaving] = useState(false);

    // The editor starts from the current version (or the template for the first one)
    useEffect(() => {
        if (!data) return;
        setContent(data.current?.content || TEMPLATE);
        setAcceptBy(data.current ? '' : '2026-12-31');
    }, [data]);

    const pending = (data?.students || []).filter(s => !s.acceptedAt);
    const changed = content.trim() !== (data?.current?.content || '').trim();

    const publish = async () => {
        if (!confirm(`¿Publicar la versión ${(data?.current?.version || 0) + 1}? Todos los estudiantes deberán aceptarla.`)) return;
        setSaving(true);
        setMessage(null);
        try {
            const version = await api.publishTerms(content, acceptBy);
            setMessage({ type: 'ok', text: `Publicada la versión ${version.version}. Los estudiantes recibieron un aviso.` });
            reload();
        } catch (err) {
            setMessage({ type: 'error', text: err.message });
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-3xl font-bold tracking-tight">Términos y condiciones</h2>
                <p className="text-muted-foreground">
                    Los estudiantes deben aceptarlos. Cada cambio se publica como una versión nueva y queda registro de quién aceptó cuál, con fecha y hora.
                    Un estudiante nuevo no puede usar la app hasta aceptarlos; uno actual puede hacerlo hasta la fecha límite, pero mientras tanto no puede cambiar clases.
                </p>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="grid gap-4 lg:grid-cols-3">
                <Card className="lg:col-span-2">
                    <CardHeader>
                        <CardTitle className="text-lg flex items-center gap-2">
                            <FileText size={18} className="text-primary" />
                            {data?.current ? `Versión vigente: ${data.current.version}` : 'Primera versión (aún sin publicar)'}
                        </CardTitle>
                        {data?.current && (
                            <p className="text-sm text-muted-foreground">
                                Publicada el {formatDateTime(data.current.createdAt)}
                                {data.current.acceptBy && ` · aceptar a más tardar el ${formatDay(data.current.acceptBy)}`}
                            </p>
                        )}
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <textarea
                            className={`${inputClass} font-mono text-sm`}
                            rows={18}
                            value={content}
                            onChange={e => setContent(e.target.value)}
                            aria-label="Texto de los términos y condiciones"
                        />
                        <div className="space-y-1">
                            <label className="text-sm font-medium" htmlFor="accept-by">Fecha límite para los estudiantes actuales (opcional)</label>
                            <input id="accept-by" type="date" className={`${inputClass} min-h-11 sm:w-60`} value={acceptBy} onChange={e => setAcceptBy(e.target.value)} />
                            <p className="text-xs text-muted-foreground">
                                Hasta ese día pueden posponerla; desde el día siguiente no usan la app hasta aceptar. Sin fecha, solo se les bloquea cambiar clases mientras no acepten.
                            </p>
                        </div>
                        {message && <p className={`text-sm ${message.type === 'error' ? 'text-red-600' : 'text-green-700'}`}>{message.text}</p>}
                        <Button className="min-h-11 gap-2" onClick={publish} disabled={!changed || saving}>
                            <Send size={16} />Publicar nueva versión
                        </Button>
                        {!changed && data?.current && <p className="text-xs text-muted-foreground">Edita el texto para publicar una versión nueva.</p>}
                    </CardContent>
                </Card>

                <div className="space-y-4">
                    <Card>
                        <CardHeader className="pb-2"><CardTitle className="text-base">Aceptación de la versión vigente</CardTitle></CardHeader>
                        <CardContent className="space-y-2 text-sm">
                            {!data?.current && <p className="text-muted-foreground">Publica la primera versión para empezar.</p>}
                            {data?.current && (
                                <>
                                    <p><span className="font-semibold">{data.students.length - pending.length}</span> de {data.students.length} estudiantes la aceptaron.</p>
                                    {pending.length > 0 && (
                                        <div>
                                            <p className="font-medium">Faltan:</p>
                                            <ul className="mt-1 max-h-64 overflow-y-auto divide-y">
                                                {pending.map(s => <li key={s.id} className="py-1">{s.name}</li>)}
                                            </ul>
                                        </div>
                                    )}
                                </>
                            )}
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader className="pb-2"><CardTitle className="text-base">Versiones</CardTitle></CardHeader>
                        <CardContent className="divide-y text-sm">
                            {(data?.versions || []).map(v => (
                                <div key={v.id} className="py-2 flex items-center justify-between gap-2">
                                    <span>Versión {v.version} · {formatDay(localParts(v.createdAt).date)}</span>
                                    <Badge>{v.acceptedCount} aceptaciones</Badge>
                                </div>
                            ))}
                            {data?.versions?.length === 0 && <p className="text-muted-foreground py-2">Ninguna todavía.</p>}
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}
