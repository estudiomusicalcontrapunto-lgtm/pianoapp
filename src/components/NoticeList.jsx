
import React, { useState } from 'react';
import { Bell, ChevronDown, Megaphone, History } from 'lucide-react';
import { api } from '../lib/api';
import { useApiData } from '../lib/useApiData';
import { cn } from '../lib/utils';
import { capitalize, formatDateTime, formatShortDay } from '../lib/time';
import { Card } from './ui/Card';
import { Button } from './ui/Button';

// An announcement written by a person: author, until when, and the full text
export function AnnouncementItem({ announcement, showStatus = false }) {
    const unread = announcement.readAt === null;
    return (
        <div className={cn("rounded-md border-l-4 border-primary/60 bg-primary/5 px-3 py-2", unread && "border-primary bg-primary/10")}>
            <div className="flex items-start justify-between gap-2">
                <span className={cn("text-sm", unread ? "font-semibold" : "font-medium")}>{announcement.title}</span>
                {showStatus && !announcement.current && <span className="text-[10px] text-muted-foreground shrink-0">Ya no se muestra</span>}
            </div>
            <p className="text-xs text-foreground/80 whitespace-pre-line mt-0.5">{announcement.content}</p>
            <p className="text-[10px] text-muted-foreground mt-1">
                {announcement.author} · {formatShortDay(announcement.date)}
                {announcement.current && announcement.visibleUntil && ` · visible hasta el ${formatShortDay(announcement.visibleUntil)}`}
            </p>
        </div>
    );
}

// A notice the system sent (class cancelled, payment confirmed, ...)
export function NotificationItem({ notice }) {
    return (
        <div className={cn("border-b last:border-0 pb-3 last:pb-0", !notice.readAt && "font-medium")}>
            <div className="flex items-center justify-between gap-2">
                <span className="text-sm">{notice.title}</span>
                <span className="text-[10px] text-muted-foreground shrink-0">{capitalize(formatDateTime(notice.createdAt))}</span>
            </div>
            <p className="text-xs text-muted-foreground font-normal">{notice.message}</p>
        </div>
    );
}

// "Avisos": the announcements still on display first, then the automatic notices.
// One line that opens; it starts open while something is unread. Old read
// notices and expired announcements only show in the history.
export function NoticeList({ limit = 5, className, onViewHistory }) {
    const { data, reload } = useApiData(() => api.getNoticeFeed(), []);
    const [open, setOpen] = useState(null);
    const announcements = data?.announcements || [];
    const notifications = data?.notifications || [];
    const unread = data?.unread || 0;
    const isOpen = open ?? unread > 0;
    const unreadNotifications = notifications.filter(n => !n.readAt);
    const shownNotifications = notifications.slice(0, Math.max(limit, unreadNotifications.length));
    const latest = announcements.find(a => !a.readAt) || unreadNotifications[0] || announcements[0] || notifications[0];
    const latestText = latest && (latest.content ?? latest.message);

    const markAll = async () => {
        await api.markNoticesRead();
        reload();
    };

    return (
        <Card className={className}>
            <button
                type="button"
                onClick={() => setOpen(!isOpen)}
                aria-expanded={isOpen}
                className="w-full flex items-center gap-3 px-4 py-3 text-left"
            >
                <Bell size={16} className="text-primary shrink-0" />
                <span className="text-sm font-semibold shrink-0">Avisos</span>
                {unread > 0 && <span className="rounded-full bg-primary px-2 text-xs text-primary-foreground shrink-0">{unread}</span>}
                <span className="flex-1 min-w-0 truncate text-sm text-muted-foreground">
                    {!isOpen && (latest
                        ? <><span className={cn(latest.readAt === null && "text-foreground font-medium")}>{latest.title}</span> · {latestText}</>
                        : 'Estás al día.')}
                </span>
                <ChevronDown size={16} className={cn("text-muted-foreground shrink-0 transition-transform", isOpen && "rotate-180")} />
            </button>
            {isOpen && (
                <div className="border-t px-4 py-3 space-y-4">
                    <div className="max-h-96 overflow-y-auto space-y-4 pr-1">
                        {announcements.length > 0 && (
                            <section className="space-y-2">
                                <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><Megaphone size={12} />Anuncios</p>
                                {announcements.map(a => <AnnouncementItem key={a.id} announcement={a} />)}
                            </section>
                        )}
                        {shownNotifications.length > 0 && (
                            <section className="space-y-3">
                                {announcements.length > 0 && <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Notificaciones</p>}
                                {shownNotifications.map(n => <NotificationItem key={n.recipientId} notice={n} />)}
                            </section>
                        )}
                        {announcements.length === 0 && shownNotifications.length === 0 && (
                            <p className="text-sm text-muted-foreground">Estás al día. No tienes avisos recientes.</p>
                        )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {unread > 0 && <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={markAll}>Marcar todo como leído</Button>}
                        {onViewHistory && (
                            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={onViewHistory}><History size={12} />Ver historial</Button>
                        )}
                    </div>
                </div>
            )}
        </Card>
    );
}
