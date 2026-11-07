// Jelajah UI refresh — inline SVG icon sprite (Lucide-style: 24px grid,
// stroke 2, round caps/joins, currentColor). Ported verbatim from
// design/ui-refresh/icons.js. Pure module (no JSX) so it can be imported
// from both Icon.tsx and the vitest node tests without pulling in React.

export const ICON_NAMES = ['home','calendar','wallet','receipt','coins','user','users','file','files','settings','shield','pin','plane','hotel','train','car','food','ticket','camera','temple','spark','plus','chev-d','chev-r','check','clock','alert','arrow-r','copy','trash','edit','moon','folder','link','chart','more','globe','logout','upload','gift','key','swap','chat','search','flag','eye','download','grip','bag','walk','x','chev-l','chev-u','arrow-l','sun','monitor','info','external','filter','map','route','minus','refresh','sparkles','tag','note','list-check','save','inbox','baby','station','bed','more-v','sort','menu'] as const;
export type IconName = typeof ICON_NAMES[number];

export const DEFS = `
<defs>
<g id="i-home"><path d="M3 10.5 12 3l9 7.5V20a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 20z"/><path d="M9 21.5v-8h6v8"/></g>
<g id="i-calendar"><rect x="3" y="4.5" width="18" height="17" rx="2"/><path d="M16 2.5v4M8 2.5v4M3 10h18"/></g>
<g id="i-wallet"><rect x="2.5" y="5.5" width="19" height="15" rx="2.5"/><path d="M2.5 10h19"/><path d="M15.5 15.5h3" stroke-width="2.4"/></g>
<g id="i-receipt"><path d="M5 2.5v19l2-1.2 2 1.2 2-1.2 2 1.2 2-1.2 2 1.2 2-1.2v-19l-2 1.2-2-1.2-2 1.2-2-1.2-2 1.2-2-1.2z" transform="scale(.92) translate(1 1)"/><path d="M9 8h6M9 12h6M9 16h4"/></g>
<g id="i-coins"><circle cx="9" cy="9" r="6"/><path d="M14.8 5.3a6 6 0 1 1-9.5 7.4"/><path d="M18.6 9.4A6 6 0 1 1 9.4 18.6"/></g>
<g id="i-user"><circle cx="12" cy="7.5" r="4"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/></g>
<g id="i-users"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.7a3.5 3.5 0 0 1 0 6.6M17.7 14.6A6.5 6.5 0 0 1 21.5 20"/></g>
<g id="i-file"><path d="M14.5 2.5H6a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14.5 2.5V8H20"/></g>
<g id="i-files"><path d="M15 4H8a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8z"/><path d="M15 4v4h4M4 7v13a2 2 0 0 0 2 2"/></g>
<g id="i-settings"><path d="M4 21v-6M4 11V3M12 21v-9M12 8V3M20 21v-4M20 13V3"/><path d="M1.5 15h5M9.5 8h5M17.5 17h5"/></g>
<g id="i-shield"><path d="M12 2.5c2 1.6 4.5 2.5 7 2.5v7c0 5-3.2 7.7-7 9.5-3.8-1.8-7-4.5-7-9.5V5c2.5 0 5-.9 7-2.5z"/><path d="m9 11.5 2 2 4-4"/></g>
<g id="i-pin"><path d="M20 10c0 5-6.4 10.5-7.6 11.5a.6.6 0 0 1-.8 0C10.4 20.5 4 15 4 10a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/></g>
<g id="i-plane"><path d="M10.5 13.5 3 11l1.5-2 5.5 1L15 4.5c.8-.9 2.2-1 3-.2s.7 2.2-.2 3L12.5 13l1 5.5-2 1.5-2.5-7.5z" transform="rotate(3 12 12)"/></g>
<g id="i-hotel"><rect x="4" y="2.5" width="16" height="19" rx="2"/><path d="M9 21.5V17h6v4.5"/><path d="M8 6.5h.01M12 6.5h.01M16 6.5h.01M8 10.5h.01M12 10.5h.01M16 10.5h.01M8 14h.01M12 14h.01M16 14h.01" stroke-width="2.4"/></g>
<g id="i-train"><rect x="5" y="3" width="14" height="13" rx="3"/><path d="M5 10.5h14M12 3v7.5"/><path d="M8.5 13.5h.01M15.5 13.5h.01" stroke-width="2.6"/><path d="m8 20-1.5 2M16 20l1.5 2M8 16l-1 4h10l-1-4" opacity=".9"/></g>
<g id="i-car"><path d="M4.5 16.5 5.8 11a2 2 0 0 1 2-1.5h8.4a2 2 0 0 1 2 1.5l1.3 5.5"/><rect x="3" y="15" width="18" height="5" rx="1.5"/><path d="M6.5 20v1.5M17.5 20v1.5M7 17.5h.01M17 17.5h.01" stroke-width="2.4"/></g>
<g id="i-food"><path d="M5 2.5v6a2 2 0 0 0 4 0v-6M7 2.5V21.5"/><path d="M19 15h-3.5a1 1 0 0 1-1-1c0-5 2-11.5 4.5-11.5z"/><path d="M19 2.5v19"/></g>
<g id="i-ticket"><path d="M2.5 9.5a2.5 2.5 0 0 1 0 5v3a2 2 0 0 0 2 2h15a2 2 0 0 0 2-2v-3a2.5 2.5 0 0 1 0-5v-3a2 2 0 0 0-2-2h-15a2 2 0 0 0-2 2z"/><path d="M13.5 5v2M13.5 11v2M13.5 17v2" stroke-dasharray="2 3"/></g>
<g id="i-camera"><path d="M14.5 4.5h-5l-2 2.5H4.5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h15a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3.5"/></g>
<g id="i-temple"><path d="M4 21.5h16M6 21.5V11M10 21.5V11M14 21.5V11M18 21.5V11"/><path d="M3 11h18l-2-3.5H5zM12 3l6 4.5H6z"/></g>
<g id="i-spark"><path d="M12 4.5c.6 3.6 2.4 5.4 6 6-3.6.6-5.4 2.4-6 6-.6-3.6-2.4-5.4-6-6 3.6-.6 5.4-2.4 6-6z"/><path d="M19 15.5c.3 1.7 1.1 2.5 2.5 2.8-1.4.3-2.2 1.1-2.5 2.7-.3-1.6-1.1-2.4-2.5-2.7 1.4-.3 2.2-1.1 2.5-2.8z"/></g>
<g id="i-plus"><path d="M12 5v14M5 12h14"/></g>
<g id="i-chev-d"><path d="m6 9.5 6 6 6-6"/></g>
<g id="i-chev-r"><path d="m9.5 6 6 6-6 6"/></g>
<g id="i-check"><path d="M20 6.5 9.5 17 4 11.5"/></g>
<g id="i-clock"><circle cx="12" cy="12" r="9.5"/><path d="M12 6.5V12l3.5 2"/></g>
<g id="i-alert"><circle cx="12" cy="12" r="9.5"/><path d="M12 7.5V13M12 16.5h.01" stroke-width="2.4"/></g>
<g id="i-arrow-r"><path d="M4.5 12h15M13.5 6l6 6-6 6"/></g>
<g id="i-copy"><rect x="9" y="9" width="12.5" height="12.5" rx="2"/><path d="M5.5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1.5"/></g>
<g id="i-trash"><path d="M3.5 6.5h17M18.5 6.5v13a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-13M8.5 6.5v-2a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v2"/><path d="M10 11v6M14 11v6"/></g>
<g id="i-edit"><path d="M16.5 4a2.3 2.3 0 0 1 3.5 3L8 19l-4.5 1.5L5 16z"/></g>
<g id="i-moon"><path d="M13 3.5a8.5 8.5 0 1 0 7.5 12.5A9 9 0 0 1 13 3.5z"/></g>
<g id="i-folder"><path d="M2.5 6a2 2 0 0 1 2-2h4l2.5 3H19.5a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2z"/></g>
<g id="i-link"><path d="M9.5 14.5a5 5 0 0 0 7 .5l3-3a5 5 0 0 0-7-7l-1.6 1.5"/><path d="M14.5 9.5a5 5 0 0 0-7-.5l-3 3a5 5 0 0 0 7 7l1.6-1.5"/></g>
<g id="i-chart"><path d="M3.5 3.5v15a2 2 0 0 0 2 2h15"/><path d="M8.5 15.5v-4M13 15.5V7M17.5 15.5v-6.5"/></g>
<g id="i-more"><path d="M5 12h.01M12 12h.01M19 12h.01" stroke-width="2.8"/></g>
<g id="i-globe"><circle cx="12" cy="12" r="9.5"/><path d="M2.5 12h19M12 2.5c2.7 2.7 4 6 4 9.5s-1.3 6.8-4 9.5c-2.7-2.7-4-6-4-9.5s1.3-6.8 4-9.5z"/></g>
<g id="i-logout"><path d="M9.5 21.5H5a2 2 0 0 1-2-2v-15a2 2 0 0 1 2-2h4.5"/><path d="m16 16.5 4.5-4.5L16 7.5M20.5 12h-11"/></g>
<g id="i-upload"><path d="M12 21v-9M8.5 15.5 12 12l3.5 3.5"/><path d="M4.5 16.5A6.5 6.5 0 1 1 15.5 8h1.5a4.5 4.5 0 0 1 2 8.5"/></g>
<g id="i-gift"><rect x="3" y="8.5" width="18" height="4" rx="1"/><path d="M12 8.5v13M19 12.5V19a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 5 19v-6.5"/><path d="M7.5 8.5a2.5 2.5 0 0 1 0-5C11 3.5 12 8.5 12 8.5s1-5 4.5-5a2.5 2.5 0 0 1 0 5"/></g>
<g id="i-key"><circle cx="8" cy="16" r="4.5"/><path d="m11.3 12.7 8.2-8.2M17.5 6.5l3 3M14.5 9.5l2.5 2.5"/></g>
<g id="i-swap"><path d="m17 2.5 4 4-4 4M21 6.5H8a4 4 0 0 0-4 4"/><path d="m7 21.5-4-4 4-4M3 17.5h13a4 4 0 0 0 4-4"/></g>
<g id="i-chat"><path d="M21 12a8.5 8.5 0 0 1-12.4 7.5L3 21l1.5-5.6A8.5 8.5 0 1 1 21 12z"/></g>
<g id="i-search"><circle cx="11" cy="11" r="7.5"/><path d="m20.5 20.5-4.2-4.2"/></g>
<g id="i-flag"><path d="M4.5 21.5v-19"/><path d="M4.5 4c2-1.3 4-1.3 6 0s4 1.3 6 0v9c-2 1.3-4 1.3-6 0s-4-1.3-6 0"/></g>
<g id="i-eye"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/></g>
<g id="i-download"><path d="M12 3v9M8.5 8.5 12 12l3.5-3.5"/><path d="M4.5 16v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3"/></g>
<g id="i-grip"><path d="M8 6h.01M8 12h.01M8 18h.01M16 6h.01M16 12h.01M16 18h.01" stroke-width="2.8"/></g>
<g id="i-bag"><path d="M6 7.5 7.5 4h9L18 7.5"/><rect x="4" y="7.5" width="16" height="13" rx="2"/><path d="M9 11.5a3 3 0 0 0 6 0"/></g>
<g id="i-walk"><circle cx="13" cy="4" r="2"/><path d="M13 7l-2 5 3 3 1 6"/><path d="M11 12l-3 2-1 5"/><path d="M13 8l3 2 2-1"/></g>
<g id="i-x"><path d="M18 6 6 18M6 6l12 12"/></g>
<g id="i-chev-l"><path d="m15 18-6-6 6-6"/></g>
<g id="i-chev-u"><path d="m18 15-6-6-6 6"/></g>
<g id="i-arrow-l"><path d="M19 12H5M11 18l-6-6 6-6"/></g>
<g id="i-sun"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></g>
<g id="i-monitor"><rect x="2.5" y="3.5" width="19" height="13" rx="2"/><path d="M8 21h8M12 16.5V21"/></g>
<g id="i-info"><circle cx="12" cy="12" r="9.5"/><path d="M12 16v-4.5M12 8h.01"/></g>
<g id="i-external"><path d="M14 3.5h6.5V10M20.5 3.5 11 13"/><path d="M18.5 13.5v5a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2h5"/></g>
<g id="i-filter"><path d="M3.5 5h17l-6.5 7.5v6l-4 2v-8z"/></g>
<g id="i-map"><path d="M9 4 3.5 6v14L9 18l6 2 5.5-2V4L15 6z"/><path d="M9 4v14M15 6v14"/></g>
<g id="i-route"><circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="5" r="2.5"/><path d="M8.5 19H16a3.5 3.5 0 0 0 0-7H8a3.5 3.5 0 0 1 0-7h7.5"/></g>
<g id="i-minus"><path d="M5 12h14"/></g>
<g id="i-refresh"><path d="M20.5 12a8.5 8.5 0 0 1-14.5 6l-2.5-2.5"/><path d="M3.5 12A8.5 8.5 0 0 1 18 6l2.5 2.5"/><path d="M20.5 3.5v5h-5M3.5 20.5v-5h5"/></g>
<g id="i-sparkles"><path d="M10 3.5 11.6 8a2 2 0 0 0 1.3 1.3l4.6 1.6-4.6 1.6a2 2 0 0 0-1.3 1.3L10 18.5l-1.6-4.6a2 2 0 0 0-1.3-1.3l-4.6-1.6 4.6-1.6A2 2 0 0 0 8.4 8z"/><path d="M19 3v4M17 5h4M18.5 16v3M17 17.5h3"/></g>
<g id="i-tag"><path d="M3.5 3.5h8l9 9-8 8-9-9z"/><path d="M8 8h.01" stroke-width="3"/></g>
<g id="i-note"><path d="M14.5 3.5H6a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14.5 3.5V9H20M8 13h8M8 17h5"/></g>
<g id="i-list-check"><path d="M3.5 6.5 5 8l3-3M3.5 12.5 5 14l3-3M3.5 18.5 5 20l3-3"/><path d="M11 6.5h9.5M11 12.5h9.5M11 18.5h9.5"/></g>
<g id="i-save"><path d="M5 3.5h11L20.5 8v11a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V5A1.5 1.5 0 0 1 5 3.5z"/><path d="M7.5 3.5v5h8v-5M7.5 20.5v-7h9v7"/></g>
<g id="i-inbox"><path d="M3.5 13.5 6 5h12l2.5 8.5V19a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19z"/><path d="M3.5 13.5H8l1.5 2.5h5l1.5-2.5h4.5"/></g>
<g id="i-baby"><circle cx="12" cy="12" r="8.5"/><path d="M9 11h.01M15 11h.01" stroke-width="2.6"/><path d="M9.5 15a3.5 3.5 0 0 0 5 0"/><path d="M12 3.5c1.5 1 1.5 2.5 0 3.5"/></g>
<g id="i-station"><rect x="5" y="3" width="14" height="13" rx="3"/><path d="M5 10h14M9 13.5h.01M15 13.5h.01" /><path d="M8 20l2-4M16 20l-2-4"/></g>
<g id="i-bed"><path d="M3 19.5V5.5M3 15h18v4.5M21 15v-3a3 3 0 0 0-3-3h-7v6"/><circle cx="7" cy="11" r="2"/></g>
<g id="i-more-v"><path d="M12 5h.01M12 12h.01M12 19h.01" stroke-width="3"/></g>
<g id="i-sort"><path d="M7 4v16M3.5 16.5 7 20l3.5-3.5M17 20V4M13.5 7.5 17 4l3.5 3.5"/></g>
<g id="i-menu"><path d="M4 6h16M4 12h16M4 18h16"/></g>
</defs>`;
