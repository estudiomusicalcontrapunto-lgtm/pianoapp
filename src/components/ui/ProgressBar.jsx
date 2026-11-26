
import { cn } from "../../lib/utils";

export function ProgressBar({ value, max = 100, className }) {
    const percentage = Math.min(100, Math.max(0, (value / max) * 100));

    return (
        <div className={cn("h-4 w-full overflow-hidden rounded-full bg-secondary", className)}>
            <div
                className="h-full w-full flex-1 bg-primary transition-all duration-300 ease-in-out"
                style={{ transform: `translateX(-${100 - percentage}%)` }}
            />
        </div>
    );
}
