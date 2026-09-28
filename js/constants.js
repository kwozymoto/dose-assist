// @ts-check
/* Emergency and advice numbers. The ONLY place they are written
   (CLAUDE.md; tools/check_numbers.mjs fails if one appears anywhere else).
   Checked 2026-09-28 against the sources named. */

export const EMERGENCY = /** @type {const} */ ({
  emergency: {
    name: 'Emergency',
    display: '111',
    tel: '111',
    when: 'If your child is floppy, blue around the mouth, struggling to breathe or not responding.',
    source: 'kidshealth-fever',
  },
  healthline: {
    name: 'Healthline',
    display: '0800 611 116',
    tel: '0800611116',
    when: 'Free advice from nurses and paramedics, 24 hours a day, 7 days a week.',
    source: 'healthnz-healthline',
  },
  poisons: {
    name: 'National Poisons Centre',
    display: '0800 764 766',
    alt: '0800 POISON',
    tel: '0800764766',
    when: 'If your child may have had too much medicine, call now, even if they seem well.',
    source: 'poisons-centre',
  },
});
