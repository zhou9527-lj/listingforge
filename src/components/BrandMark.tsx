import type { SVGProps } from "react";

export function BrandMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 28 28" fill="none" aria-hidden="true" {...props}>
      <path d="M4.5 3.5h17v8.25l-4.4 3.65H9.2v8.1H4.5v-20Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="m9 19 3.4-3.5 2.8 2.25 3.8-4.1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m20.4 3.1.65-1.6.65 1.6 1.6.65-1.6.65-.65 1.6-.65-1.6-1.6-.65 1.6-.65Z" fill="currentColor" />
    </svg>
  );
}

