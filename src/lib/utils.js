
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

// 260000 -> "$260.000" (COP, whole pesos)
export function formatCOP(amount) {
  const value = Math.round(Number(amount) || 0);
  const digits = String(Math.abs(value)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${value < 0 ? '-' : ''}$${digits}`;
}

export const inputClass = "w-full p-2 rounded-md border bg-background text-sm";

export const ROLE_LABELS = {
  academy: 'Academia',
  teacher: 'Profesor',
  student: 'Estudiante',
};
