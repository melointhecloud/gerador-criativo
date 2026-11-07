// Ícones inline (SVG, traço de 2 px, 24×24). Decorativos: sempre ao lado de texto visível, por isso aria-hidden.
type IconProps = { className?: string };

export function AlertIcon({ className = "icon" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5M12 16.5v.01" />
    </svg>
  );
}

export function CheckIcon({ className = "icon" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

export function LockIcon({ className = "icon" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <rect x="5" y="10.5" width="14" height="10" rx="2" />
      <path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3" />
    </svg>
  );
}

export function PlusIcon({ className = "icon" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" focusable="false">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

// Marca: quadro 9:16 com cantos de visor e o cabeçote (barra de tungstênio) no centro.
export function BrandMark({ className = "brand-mark" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 36" fill="none" aria-hidden="true" focusable="false">
      <path d="M1 7V1h6M13 1h6v6M19 29v6h-6M7 35H1v-6" stroke="currentColor" strokeWidth="2" />
      <rect x="8.5" y="8" width="3" height="20" rx="1" fill="var(--color-accent)" />
    </svg>
  );
}
