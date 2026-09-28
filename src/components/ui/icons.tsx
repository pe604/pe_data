export const IconX = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
    <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

export const IconCaret = () => (
  <svg width="10" height="6" viewBox="0 0 10 6" aria-hidden="true">
    <path d="M1 1l4 4 4-4" stroke="currentColor" fill="none" strokeWidth="1.5" />
  </svg>
);

export const IconSearch = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
    <circle cx="6" cy="6" r="4.5" stroke="currentColor" fill="none" strokeWidth="1.4" />
    <path d="M9.5 9.5L13 13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);

export const IconDownload = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
    <path d="M7 1.5v8M3.8 6.5L7 9.7l3.2-3.2M2 12.5h10" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const IconPlus = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
    <path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

const CLOUD = "M6.8 15.5h11.4a4.8 4.8 0 0 0 .5-9.57 6.4 6.4 0 0 0-12.2 1.2A4.2 4.2 0 0 0 6.8 15.5z";

export const CloudLine = () => (
  <svg width="22" height="16" viewBox="0 0 24 17" aria-hidden="true">
    <path d={CLOUD} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
  </svg>
);

export const CloudFill = () => (
  <svg width="22" height="16" viewBox="0 0 24 17" aria-hidden="true">
    <path d={CLOUD} fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
  </svg>
);
