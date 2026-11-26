/** @type {import('tailwindcss').Config} */

// Contrapunto palette: status colours are muted and warmed so they sit on the
// cream "paper" next to the ink and terracotta of the logo. Each scale is built
// from a hue and saturation with a Tailwind-like lightness ramp, so existing
// classes such as bg-green-100 or text-red-500 pick up the brand tones.
const RAMP = { 50: 96, 100: 92, 200: 85, 300: 75, 400: 64, 500: 53, 600: 44, 700: 36, 800: 29, 900: 22, 950: 14 };

const scale = (hue, saturation) => Object.fromEntries(
    Object.entries(RAMP).map(([step, lightness]) => [
        step,
        `hsl(${hue} ${step < 200 ? Math.round(saturation * 0.8) : saturation}% ${lightness}% / <alpha-value>)`,
    ])
);

const brick = scale(6, 52);       // errores
const terracotta = scale(20, 60); // pendientes, avisos
const ochre = scale(38, 55);      // advertencias suaves
const sage = scale(88, 26);       // confirmado, al día
const inkBlue = scale(212, 26);   // información
const plum = scale(345, 24);      // reposiciones, niveles
const stone = scale(35, 7);

export default {
    darkMode: ["class"],
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            fontFamily: {
                sans: ['Jost', 'ui-sans-serif', 'system-ui', 'sans-serif'],
            },
            colors: {
                border: "hsl(var(--border))",
                input: "hsl(var(--input))",
                ring: "hsl(var(--ring))",
                background: "hsl(var(--background))",
                foreground: "hsl(var(--foreground))",
                primary: {
                    DEFAULT: "hsl(var(--primary))",
                    foreground: "hsl(var(--primary-foreground))",
                },
                secondary: {
                    DEFAULT: "hsl(var(--secondary))",
                    foreground: "hsl(var(--secondary-foreground))",
                },
                destructive: {
                    DEFAULT: "hsl(var(--destructive))",
                    foreground: "hsl(var(--destructive-foreground))",
                },
                muted: {
                    DEFAULT: "hsl(var(--muted))",
                    foreground: "hsl(var(--muted-foreground))",
                },
                accent: {
                    DEFAULT: "hsl(var(--accent))",
                    foreground: "hsl(var(--accent-foreground))",
                },
                popover: {
                    DEFAULT: "hsl(var(--popover))",
                    foreground: "hsl(var(--popover-foreground))",
                },
                card: {
                    DEFAULT: "hsl(var(--card))",
                    foreground: "hsl(var(--card-foreground))",
                },
                // The red dot of the logo
                brand: {
                    DEFAULT: "hsl(var(--brand))",
                    foreground: "hsl(var(--brand-foreground))",
                },
                sidebar: {
                    DEFAULT: "hsl(var(--sidebar))",
                    foreground: "hsl(var(--sidebar-foreground))",
                    muted: "hsl(var(--sidebar-muted))",
                },
                red: brick,
                rose: brick,
                orange: terracotta,
                amber: ochre,
                yellow: ochre,
                green: sage,
                emerald: sage,
                lime: sage,
                blue: inkBlue,
                sky: inkBlue,
                indigo: inkBlue,
                violet: plum,
                purple: plum,
                gray: stone,
                slate: stone,
            },
            borderRadius: {
                lg: "var(--radius)",
                md: "calc(var(--radius) - 2px)",
                sm: "calc(var(--radius) - 4px)",
            },
        },
    },
    plugins: [],
}
