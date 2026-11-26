
import { cn } from "../../lib/utils";

export function Button({ className, variant = "primary", size = "md", ...props }) {
    const variants = {
        primary: "bg-primary text-primary-foreground hover:bg-primary/90",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
    };

    // On a phone every button is at least 44 px tall, so it is easy to tap
    const sizes = {
        sm: "h-11 md:h-9 px-3 text-sm md:text-xs",
        md: "h-11 md:h-10 px-4 py-2",
        lg: "h-11 px-8",
        icon: "h-11 w-11 md:h-10 md:w-10",
    };

    return (
        <button
            className={cn(
                "inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
                variants[variant],
                sizes[size],
                className,
                // Even when a screen asks for a compact button, on a phone it stays 44 px to tap
                "max-md:min-h-11",
                size === 'icon' && "max-md:min-w-11"
            )}
            {...props}
        />
    );
}
