// @ts-check
/* Every piece of guidance the app shows, each with its sources.

   Rules (CLAUDE.md 13, PLAN.md 4):
   - Never invent clinical content. Every entry names at least one source in
     SOURCES, and tools/check_content.mjs fails if one does not.
   - Wording is our own paraphrase, not copied text: linking out is always
     fine, copying needs the publisher's permission.
   - 'app' is the source for statements about what the app itself does or
     does not do. It is not a clinical source and must not carry one.
   - An entry whose wording or source still needs checking carries
     `verify` with the reason, and is listed in the Sources screen. */

/**
 * @typedef {object} Source
 * @property {string} name
 * @property {string | null} url
 * @property {string | null} checkedAt
 *
 * @typedef {object} Guidance
 * @property {string} [title]
 * @property {string} [text]
 * @property {string[]} [items]
 * @property {string[]} sources
 * @property {string} [verify]  TODO(VERIFY): what still needs checking
 */

/** @type {Record<string, Source>} */
export const SOURCES = {
  app: { name: 'About this app (not clinical advice)', url: null, checkedAt: null },
  'kidshealth-paracetamol': { name: 'KidsHealth NZ: Safe use of paracetamol in children', url: 'https://www.kidshealth.org.nz/safe-use-of-paracetamol-in-children', checkedAt: '2026-09-28' },
  'kidshealth-fever': { name: 'KidsHealth NZ: Fever in children', url: 'https://www.kidshealth.org.nz/fever-in-children', checkedAt: '2026-09-28' },
  'kidshealth-sick': { name: 'KidsHealth NZ: Is my child sick?', url: 'https://www.kidshealth.org.nz/is-my-child-sick', checkedAt: '2026-09-28' },
  'healthify-paracetamol': { name: 'Healthify: Paracetamol for children', url: 'https://healthify.nz/medicines-a-z/p/paracetamol-children', checkedAt: '2026-09-28' },
  'healthify-ibuprofen': { name: 'Healthify: Ibuprofen for children', url: 'https://healthify.nz/medicines-a-z/i/ibuprofen-children', checkedAt: '2026-09-28' },
  'healthify-pain-relief': { name: 'Healthify: Pain relief medicines for children', url: 'https://healthify.nz/medicines-a-z/p/pain-relief-medicines-for-children', checkedAt: '2026-09-28' },
  'bpac-paracetamol': { name: 'bpacnz: Paracetamol dosing for children in primary care', url: 'https://bpac.org.nz/2018/paracetamol.aspx', checkedAt: '2026-09-28' },
  'healthnz-healthline': { name: 'Health New Zealand: Healthline', url: 'https://www.healthnz.govt.nz/services-support/health-and-disability-providers/healthline', checkedAt: '2026-09-28' },
  'poisons-centre': { name: 'National Poisons Centre: Calling us', url: 'https://poisons.co.nz/poisons-centre-info/calling-us/', checkedAt: '2026-09-28' },
};

/** @type {Record<string, Guidance>} */
export const GUIDANCE = {
  whatItDoes: {
    title: 'What WhenDose does',
    items: [
      'Keeps a record of every dose: what, how much, when, and who gave it.',
      'Shows when the next dose is allowed, using the usual limits for each medicine.',
      'Reminds you when that time comes, or at a time you choose.',
      'Counts combination medicines toward each medicine in them.',
    ],
    sources: ['app'],
  },
  whatItDoesNot: {
    title: 'What it does not do',
    items: [
      'It does not work out a dose for you. Always use the dose on the label or from your doctor or pharmacist.',
      'It does not diagnose illness or tell you whether your child needs medicine.',
      'It is not medical advice. If you are unsure, call Healthline.',
    ],
    sources: ['app'],
  },
  notReviewed: {
    text: 'Test version. The limits in this app have not yet been checked by a pharmacist. Always follow the label.',
    sources: ['app'],
  },
  writeItDown: {
    text: 'Health advice in New Zealand is to keep a record of every dose you give. That is what this app is for.',
    sources: ['kidshealth-paracetamol', 'healthify-paracetamol'],
  },
  call111: {
    title: 'Call 111',
    text: 'If your child is floppy, blue around the mouth, struggling to breathe or not responding.',
    sources: ['kidshealth-fever', 'kidshealth-sick'],
  },
  seeUrgently: {
    title: 'See a doctor or nurse urgently if your child has a fever and',
    items: [
      'is under 3 months old',
      'has an unusual high-pitched cry, looks very unwell, or is hard to wake',
      'is not interested in what is around them, or has trouble breathing',
      'has a bad headache or severe pain, or bright lights upset them',
      'is not drinking, or is vomiting and cannot keep fluids down',
      'has a rash',
    ],
    sources: ['kidshealth-fever', 'kidshealth-sick'],
  },
  callHealthline: {
    title: 'Call Healthline or see your doctor if your child has a fever and',
    items: [
      'is drinking less than half of what they usually do',
      'has fewer than half their usual wet nappies',
      'has a sore throat, is vomiting, or has frequent watery diarrhoea',
      'is in pain, or is getting sicker',
    ],
    sources: ['kidshealth-fever'],
  },
  ifWorried: {
    text: 'Whatever the list says: if you are worried, get help.',
    sources: ['kidshealth-fever'],
  },
  overdose: {
    title: 'If your child may have had too much',
    text: 'Call the National Poisons Centre now. Do this even if your child seems well. Too much paracetamol can damage the liver.',
    sources: ['kidshealth-paracetamol', 'poisons-centre'],
    verify: '"even if they seem well" is PLAN.md wording; confirm with the Poisons Centre or a pharmacist.',
  },
  vomited: {
    title: 'If your child vomits or spits out a dose',
    text: 'The app will not tell you to give it again. Ask your pharmacist or call Healthline.',
    sources: ['app'],
  },
  underweight: {
    text: 'If your child is very underweight or has been unwell for a long time, check the dose with your pharmacist or doctor.',
    sources: ['bpac-paracetamol'],
  },
  longUse: {
    text: 'This medicine has been given for a while now. If your child still needs it, see your doctor.',
    sources: ['kidshealth-paracetamol', 'healthify-paracetamol'],
  },
  ibuprofenCautions: {
    title: 'Before giving ibuprofen',
    items: [
      'Do not give ibuprofen for chickenpox. It can cause a serious skin reaction.',
      'Check with a pharmacist or doctor first if your child is dehydrated (not drinking, vomiting or has diarrhoea), has asthma, or has had stomach, heart, liver or kidney problems.',
    ],
    sources: ['healthify-ibuprofen'],
  },
  bothMedicines: {
    text: 'The app tracks each medicine separately and never suggests alternating them. Advice differs on giving both, so follow your doctor or pharmacist. If they have given you a schedule, use a set-time reminder.',
    sources: ['healthify-ibuprofen', 'healthify-pain-relief', 'app'],
  },
  strengthWarning: {
    title: 'Read the strength from the label',
    text: 'Never guess it from the colour, flavour or brand. Children’s paracetamol liquids come in two strengths, and one is about twice as strong as the other.',
    sources: ['healthify-paracetamol'],
  },
  underMinAge: {
    text: 'Babies this young who are unwell need to see a doctor. The app does not track this medicine for them.',
    sources: ['kidshealth-paracetamol', 'healthify-ibuprofen'],
  },
  storage: {
    text: 'Keep medicines up high and out of sight of tamariki.',
    sources: ['app'],
    verify: 'PLAN.md wording; find the KidsHealth or Safekids page to cite.',
  },
};
