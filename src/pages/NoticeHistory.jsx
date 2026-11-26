import React, { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { api } from '../lib/api';
import { useApiData } from '../lib/useApiData';
import { cn } from '../lib/utils';
import { Card, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { AnnouncementItem, NotificationItem } from '../components/NoticeList';

const TABS = [
    { id: 'announcements', label: 'Anuncios' },
    { id: 'notifications', label: 'Notificaciones' },
];

// Every announcement (also the ones no longer shown) and every notice
export function NoticeHistory({ onBack }) {
    const { data, error } = useApiData(() => api.getNoticeHistory(), []);
    const [tab, setTab] = useState('announcements');
    const list = data?.[tab] || [];

    return (
        <div className="space-y-6 max-w-3xl">
            <div className="flex items-center gap-3">
                <Button variant="ghost" size="icon" aria-label="Volver" onClick={onBack}><ArrowLeft size={18} /></Button>
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Historial de avisos</h2>
                    <p className="text-muted-foreground">Incluye los anuncios que ya no se muestran y las notificaciones antiguas.</p>
                </div>
            </div>

            <div className="flex gap-1 rounded-lg border p-1 w-fit" role="tablist">
                {TABS.map(t => (
                    <button
                        key={t.id}
                        type="button"
                        role="tab"
                        aria-selected={tab === t.id}
                        onClick={() => setTab(t.id)}
                        className={cn("rounded-md px-3 py-1.5 text-sm font-medium", tab === t.id ? "bg-primary text-primary-foreground" : "hover:bg-accent")}
                    >
                        {t.label}{data && ` (${data[t.id].length})`}
                    </button>
                ))}
            </div>

            {error && <p className="text-sm text-red-500">{error}</p>}
            <Card>
                <CardContent className="p-4 space-y-3">
                    {tab === 'announcements'
                        ? list.map(a => <AnnouncementItem key={a.id} announcement={a} showStatus />)
                        : list.map(n => <NotificationItem key={n.recipientId} notice={n} />)}
                    {data && list.length === 0 && <p className="text-sm text-muted-foreground">No hay nada aquí todavía.</p>}
                </CardContent>
            </Card>
        </div>
    );
}
