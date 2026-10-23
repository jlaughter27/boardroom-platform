/**
 * RD-2 — a synthetic, vault-shaped corpus for the retrieval IR eval.
 *
 * Why: the 2026-10-23 real-data run loaded an Obsidian vault and found that a
 * single-keyword query scored ~0.42 flat across the top 10 and that the note
 * whose TITLE was the keyword could rank #2 or outside the top 20 on identical
 * runs. The legacy corpus (seed-memories.json) is short one-fact memories and
 * cannot show that. This corpus looks like a vault instead:
 *   - long markdown notes (headings, tables, bullet logs, `[[wikilinks]]`);
 *   - a concept / entity / source / daily-note / hub (MOC) mix;
 *   - every concept keyword appears in many OTHER notes' bodies (dailies,
 *     weekly reviews, meetings and two hub notes link it as `[[Concept]]`),
 *     so a keyword query has many body matches and exactly one title match.
 *
 * Everything here is invented: a fictional field-service scheduling SaaS
 * ("Tidewell") with fictional people, customers, tools and sources. Never
 * paste real notes into this file — the repository is public.
 *
 * Deterministic: no clocks, no Math.random — a seeded PRNG picks which
 * concepts each daily note mentions, so the corpus is byte-identical on every
 * run (the seed map and the gold set depend on that).
 */

import type { SeedMemory } from './gold-schema';

export const VAULT_ARCHETYPE = 'vault';

interface Concept {
  key: string;
  title: string;
  summary: string;
  details: string[];
  table: { head: string[]; rows: string[][] };
  related: string[];
  /** Short sentences that OTHER notes use when they mention this concept. Each names it. */
  mentions: string[];
  importance?: number;
  offset: number;
}

const CONCEPTS: Concept[] = [
  {
    key: 'vault-pricing', title: 'Pricing', offset: -110,
    summary: 'How Tidewell charges crews today and the rules we use before changing a price. Pricing is per active crew per month, billed through [[Ledgerly]].',
    details: [
      'The current price list has three plans. Crew Basic covers dispatch and the mobile app, Crew Plus adds route optimisation and customer text alerts, and Crew Pro adds the [[Integrations Roadmap]] connectors and priority support. Prices were last changed in May; the next review is tied to the [[Annual Billing]] launch.',
      'Rule of thumb: never change a price for existing accounts without ninety days notice, and grandfather anyone who signed before the change for one full renewal. Ilse pushed for that rule in the advisory call (see [[Meeting — Ilse Varga advisory call 2026-08-12]]).',
      'Competitor anchor: [[Quillfeather Labs]] lists a flat fee per office instead of per crew, which looks cheaper for large offices and more expensive for two-crew shops.',
    ],
    table: { head: ['Plan', 'Per crew / month', 'Includes'], rows: [['Crew Basic', '$29', 'dispatch, mobile app'], ['Crew Plus', '$49', 'route optimisation, text alerts'], ['Crew Pro', '$79', 'connectors, priority support']] },
    related: ['Annual Billing', 'Positioning', 'Quillfeather Labs', 'Churn'],
    mentions: ['Spent an hour on [[Pricing]] again; the per crew model still feels right.', 'Two prospects asked whether pricing changes if a crew is seasonal.', 'Pricing question from a trial account: does Crew Plus include text alerts? It does.'],
  },
  {
    key: 'vault-churn', title: 'Churn', offset: -104,
    summary: 'Why accounts leave, how we count it, and the save playbook. Churn is measured as logo churn per calendar month, with seasonal pauses excluded.',
    details: [
      'Most churn so far is small shops that never finished the [[Onboarding Checklist]]; the second group is accounts whose office manager left. Seasonal pauses (snow removal crews in summer) are tracked separately so they do not inflate churn.',
      'Save playbook: when weekly active dispatchers drop to zero for fourteen days, the account gets a personal email, then a call offer, then a pause offer. Pausing keeps their job history and costs nothing.',
      'The near miss with [[Harrowgate Plumbing Co]] came from a broken calendar sync, not price — a reminder that churn is often a support problem first.',
    ],
    table: { head: ['Month', 'Accounts start', 'Lost', 'Logo churn'], rows: [['June', '62', '3', '4.8%'], ['July', '67', '2', '3.0%'], ['August', '71', '2', '2.8%']] },
    related: ['Onboarding Checklist', 'Support Load', 'Harrowgate Plumbing Co', 'Activation Metric'],
    mentions: ['Churn review: one account lost, one saved with a pause offer.', 'Looked at [[Churn]] numbers with the save playbook in mind.', 'Worried about churn from shops whose office manager quit.'],
  },
  {
    key: 'vault-onboarding-checklist', title: 'Onboarding Checklist', offset: -100,
    summary: 'The seven steps a new account must finish in the first two weeks. The onboarding checklist drives the [[Activation Metric]].',
    details: [
      'Steps: create the office, invite crews, import customers from a spreadsheet, connect the calendar, schedule the first job, send the first customer text alert, and close the first job with photos.',
      'Drop-off is worst at the customer import step — crews with messy spreadsheets stall there for days. We now offer a free import done by Wren from the support queue (see [[Support Load]]).',
      'The checklist lives in the app as a progress bar; each step links to a two-minute video.',
    ],
    table: { head: ['Step', 'Completion', 'Median days'], rows: [['Invite crews', '91%', '0.5'], ['Import customers', '58%', '3.0'], ['Connect calendar', '74%', '1.5'], ['First job closed', '66%', '4.0']] },
    related: ['Activation Metric', 'Churn', 'Support Load', 'Customer Interviews'],
    mentions: ['Two trials stuck on the customer import step of the [[Onboarding Checklist]].', 'Onboarding call with a new office; they finished four checklist steps live.', 'Rewrote the onboarding checklist video for calendar connect.'],
  },
  {
    key: 'vault-runway', title: 'Runway', offset: -96,
    summary: 'Cash, burn and months of runway, updated monthly. Runway is cash in the bank divided by average net burn over the last three months.',
    details: [
      'Cash on hand is 182k after the August close. Net burn averages 11k a month, so runway is about sixteen months. The contractor hire in the [[Hiring Plan]] raises burn to roughly 17k, which brings runway down to about eleven months.',
      'Floor: if runway drops under nine months we cut paid acquisition first, then delay the [[Integrations Roadmap]] work, before touching support.',
    ],
    table: { head: ['Month', 'Cash', 'Net burn', 'Runway (months)'], rows: [['June', '205k', '12k', '17'], ['July', '193k', '11k', '17'], ['August', '182k', '11k', '16']] },
    related: ['Hiring Plan', 'Pricing', 'Annual Billing'],
    mentions: ['Updated the [[Runway]] sheet after the bank sync.', 'Runway still looks fine but the contractor hire changes it.', 'Quick runway check before saying yes to the conference booth.'],
  },
  {
    key: 'vault-activation-metric', title: 'Activation Metric', offset: -92,
    summary: 'Definition of an activated account: three jobs closed with photos by at least two different crews within fourteen days of signup.',
    details: [
      'We picked the activation metric after the customer interviews showed that shops which close jobs with photos in the first two weeks almost never churn. One crew alone is not enough — a single-crew pattern usually means the owner is testing alone.',
      'Current activation rate is 54% of trials. The target for the quarter is 65%, mostly by fixing the import step in the [[Onboarding Checklist]].',
    ],
    table: { head: ['Cohort', 'Trials', 'Activated', 'Rate'], rows: [['June', '41', '20', '49%'], ['July', '46', '25', '54%'], ['August', '52', '29', '56%']] },
    related: ['Onboarding Checklist', 'Churn', 'Customer Interviews'],
    mentions: ['Activation for the August cohort is up a little.', 'Checked the [[Activation Metric]] dashboard — two crews rule still holds.', 'Debated whether photos should count toward activation.'],
  },
  {
    key: 'vault-cold-email', title: 'Cold Email', offset: -88,
    summary: 'Outbound to plumbing, HVAC and landscaping offices. Cold email runs from a separate sending domain with a slow warmup.',
    details: [
      'Sequence: three emails over nine days, plain text, no images. The first line names the town and the trade. Replies go into [[Halyard CRM]] automatically.',
      'Deliverability rules: the sending domain is rotated every quarter, warmup takes three weeks at ten sends a day, and we stop any domain whose bounce rate passes three percent.',
      'Best performing subject line so far: "crew schedule for <town> jobs".',
    ],
    table: { head: ['Sequence', 'Sent', 'Replies', 'Meetings'], rows: [['Plumbing v3', '420', '19', '6'], ['HVAC v2', '310', '11', '3'], ['Landscaping v1', '280', '7', '1']] },
    related: ['Halyard CRM', 'Positioning', 'Partner Channel'],
    mentions: ['Paused one cold email sequence after a bounce spike.', 'Wrote a new [[Cold Email]] opener for HVAC offices.', 'Cold email replies were slow this week.'],
  },
  {
    key: 'vault-positioning', title: 'Positioning', offset: -85,
    summary: 'Who Tidewell is for and against whom we compete. Positioning: the scheduling app for trades offices with two to fifteen crews that outgrew a whiteboard.',
    details: [
      'We are not a full field-service suite. We win when the office manager runs the day from a whiteboard or a shared spreadsheet and wants crews to see changes on their phones.',
      'Against [[Quillfeather Labs]] we lead with per crew pricing and the two-minute setup videos; against spreadsheets we lead with customer text alerts.',
    ],
    table: { head: ['Segment', 'Fit', 'Why'], rows: [['2–15 crews', 'strong', 'whiteboard pain, no IT'], ['16+ crews', 'weak', 'needs suite features'], ['solo operator', 'weak', 'no dispatch problem']] },
    related: ['Pricing', 'Cold Email', 'Quillfeather Labs'],
    mentions: ['The positioning line worked on the call: whiteboard to phones.', 'Tweaked [[Positioning]] copy on the homepage.', 'A 30-crew prospect is outside our positioning; referred them on.'],
  },
  {
    key: 'vault-hiring-plan', title: 'Hiring Plan', offset: -80,
    summary: 'Who we hire next and when. The hiring plan adds one contract engineer in October and a part-time support lead in January.',
    details: [
      'Contract engineer: [[Tobin Achebe]], twenty hours a week, focused on calendar sync and the importer. Budget impact is tracked in [[Runway]].',
      'Part-time support lead: only once weekly tickets pass 120 for four weeks in a row (see [[Support Load]]).',
    ],
    table: { head: ['Role', 'Start', 'Hours', 'Monthly cost'], rows: [['Contract engineer', 'October', '20/wk', '6k'], ['Support lead', 'January', '15/wk', '3k']] },
    related: ['Runway', 'Support Load', 'Tobin Achebe'],
    mentions: ['Hiring plan: Tobin can start in October.', 'Revisited the [[Hiring Plan]] after the support spike.', 'No new hiring until the contractor is ramped.'],
  },
  {
    key: 'vault-support-load', title: 'Support Load', offset: -77,
    summary: 'Ticket volume, response times and what drives support load. Most tickets are about calendar sync and customer import.',
    details: [
      'Weekly tickets average 84. First response time median is 2.5 hours during business hours. Calendar sync issues are 31% of volume, import help 22%, billing questions 9%.',
      'Wren handles the import queue on Tuesdays and Thursdays. Any ticket that mentions cancelling goes to the save playbook in [[Churn]].',
    ],
    table: { head: ['Category', 'Share', 'Median handle time'], rows: [['Calendar sync', '31%', '18 min'], ['Customer import', '22%', '35 min'], ['Billing', '9%', '8 min']] },
    related: ['Churn', 'Onboarding Checklist', 'Hiring Plan', 'Wren Castellanos'],
    mentions: ['Support load spiked after the calendar provider change.', 'Cleared the [[Support Load]] backlog before lunch.', 'Support tickets about import are still the slowest.'],
  },
  {
    key: 'vault-feature-flags', title: 'Feature Flags', offset: -73,
    summary: 'How we ship behind feature flags and when a flag must be removed. Every flag has an owner and an expiry date.',
    details: [
      'Rule: a feature flag is removed within thirty days of reaching one hundred percent rollout. Flags older than sixty days show up in the Monday review.',
      'Rollout order: internal office, three friendly customers, ten percent, fifty percent, everyone. Route optimisation went through all five stages in three weeks.',
    ],
    table: { head: ['Flag', 'Owner', 'Rollout', 'Expires'], rows: [['route_opt_v2', 'Tobin', '100%', 'Sept 30'], ['text_alerts_es', 'me', '10%', 'Nov 15'], ['import_wizard', 'Tobin', '50%', 'Oct 31']] },
    related: ['Release Cadence', 'Integrations Roadmap'],
    mentions: ['Turned the import wizard feature flag up to fifty percent.', 'Cleaned up two stale [[Feature Flags]].', 'Feature flag for Spanish text alerts is still at ten percent.'],
  },
  {
    key: 'vault-data-retention-policy', title: 'Data Retention Policy', offset: -70,
    summary: 'What we keep, for how long, and how deletion works. Data retention is shorter for photos than for job records.',
    details: [
      'Job records are kept for seven years because trades customers need them for warranty claims. Deleted job photos are purged from storage after thirty days. Customer phone numbers are removed ninety days after an account closes.',
      'The policy is referenced in the [[Security Questionnaire]] answers and in the terms of service.',
    ],
    table: { head: ['Data', 'Retention', 'After deletion'], rows: [['Job records', '7 years', 'archived'], ['Job photos', 'life of account', 'purged after 30 days'], ['Customer phone numbers', 'life of account', 'removed after 90 days']] },
    related: ['Security Questionnaire'],
    mentions: ['A customer asked about data retention for photos.', 'Linked the [[Data Retention Policy]] in a questionnaire answer.', 'Data retention wording needs a lawyer pass.'],
  },
  {
    key: 'vault-referral-program', title: 'Referral Program', offset: -66,
    summary: 'Referral program rules: the referrer gets one free month per paying signup, the new account gets twenty percent off for three months.',
    details: [
      'Referral links live in the app settings. Payouts are credits, never cash. A referral counts once the new account pays its first invoice in [[Ledgerly]].',
      'Eleven referrals so far, eight paying. Trades owners talk to each other at supply stores, which is why the referral program matters more than ads.',
    ],
    table: { head: ['Quarter', 'Referrals', 'Paying', 'Credits issued'], rows: [['Q2', '4', '3', '3 months'], ['Q3', '7', '5', '5 months']] },
    related: ['Partner Channel', 'Pricing'],
    mentions: ['Two new accounts came through the referral program.', 'Referral credits issued for Brightline.', 'Need a better [[Referral Program]] reminder email.'],
  },
  {
    key: 'vault-annual-billing', title: 'Annual Billing', offset: -62,
    summary: 'Annual billing launch plan: pay for twelve months up front and get two months free. Annual billing also improves [[Runway]].',
    details: [
      'The discount is two months free (about 16.7%), not a percentage coupon, because owners understand months. Annual plans renew with a thirty day reminder email.',
      'Risk: annual billing locks in the current price list right before the [[Pricing]] review, so we launch it after the review, not before.',
    ],
    table: { head: ['Option', 'Upfront', 'Effective discount'], rows: [['Monthly', '1 month', '0%'], ['Annual', '12 months', '2 months free']] },
    related: ['Pricing', 'Runway', 'Ledgerly'],
    mentions: ['Drafted the annual billing announcement.', 'Annual billing needs a renewal reminder in Ledgerly.', 'Moved the [[Annual Billing]] launch behind the pricing review.'],
  },
  {
    key: 'vault-integrations-roadmap', title: 'Integrations Roadmap', offset: -58,
    summary: 'Which connectors we build next. The integrations roadmap is ranked by how many paying accounts asked.',
    details: [
      'Requests so far: accounting export (23 accounts), Google Calendar two-way sync (19), supplier price lists (9), and a payroll hours export (7).',
      'Accounting export ships first, then two-way calendar sync. Supplier price lists wait until a partner signs (see [[Partner Channel]]).',
    ],
    table: { head: ['Connector', 'Requests', 'Status'], rows: [['Accounting export', '23', 'building'], ['Calendar two-way sync', '19', 'next'], ['Supplier price lists', '9', 'waiting'], ['Payroll hours export', '7', 'later']] },
    related: ['Partner Channel', 'Feature Flags', 'Release Cadence'],
    mentions: ['Another request for the accounting export on the integrations roadmap.', 'Re-ranked the [[Integrations Roadmap]] by paying requests.', 'Integrations work is blocked on the calendar API quota.'],
  },
  {
    key: 'vault-customer-interviews', title: 'Customer Interviews', offset: -55,
    summary: 'The script and the findings from customer interviews with office managers. Twelve interviews done since June.',
    details: [
      'Script: walk me through yesterday morning; when did the schedule change; how did the crew find out; what happened when a customer called to move a job. Never ask whether they would pay for a feature.',
      'Findings: the morning reshuffle is the pain, not the weekly plan. Office managers text crews one by one. Photos matter because of warranty disputes.',
    ],
    table: { head: ['Interviewee', 'Trade', 'Crews', 'Key quote'], rows: [['Office manager A', 'plumbing', '6', '"I text six guys every time a job moves"'], ['Owner B', 'landscaping', '3', '"the whiteboard is in the truck"']] },
    related: ['Activation Metric', 'Positioning', 'Onboarding Checklist'],
    mentions: ['Booked two more customer interviews for next week.', 'Customer interview notes added; the morning reshuffle came up again.', 'Re-read the [[Customer Interviews]] script before the call.'],
  },
  {
    key: 'vault-release-cadence', title: 'Release Cadence', offset: -51,
    summary: 'Release cadence: web releases every Tuesday and Thursday morning, mobile releases every second Wednesday after a store review buffer.',
    details: [
      'Releases need a green test run and one person who did not write the change to click through the staging app. Tobin approves web releases; I approve mobile releases.',
      'No releases on Fridays or the day before a public holiday. Hotfixes are the only exception and go behind [[Feature Flags]] when possible.',
    ],
    table: { head: ['Channel', 'Cadence', 'Approver'], rows: [['Web', 'Tue + Thu', 'Tobin'], ['Mobile', 'every 2nd Wed', 'founder'], ['Hotfix', 'any weekday', 'whoever is on call']] },
    related: ['Feature Flags', 'Integrations Roadmap', 'Tobin Achebe'],
    mentions: ['Skipped Thursday release; staging was flaky.', 'Release cadence slipped because of the store review.', 'Wrote down the [[Release Cadence]] rules for Tobin.'],
  },
  {
    key: 'vault-security-questionnaire', title: 'Security Questionnaire', offset: -48,
    summary: 'Standard answers for the security questionnaire larger customers send. Keep answers short and link evidence.',
    details: [
      'Common questions: encryption at rest (yes, managed database encryption), single sign-on (Google only), penetration test (not yet, planned after SOC 2 readiness), data retention (link the [[Data Retention Policy]]).',
      'Brightline sent a 140-question security questionnaire; we answered 128 and marked 12 as roadmap.',
    ],
    table: { head: ['Topic', 'Answer', 'Evidence'], rows: [['Encryption at rest', 'yes', 'provider docs'], ['SSO', 'Google only', 'settings screenshot'], ['Pen test', 'planned', 'roadmap note']] },
    related: ['Data Retention Policy', 'Brightline Facilities'],
    mentions: ['Spent the afternoon on a security questionnaire.', 'Added two answers to the [[Security Questionnaire]] library.', 'Security questions from Brightline again.'],
  },
  {
    key: 'vault-partner-channel', title: 'Partner Channel', offset: -44,
    summary: 'Selling through supply stores and trade associations. The partner channel is early: one pilot with a supply store chain.',
    details: [
      'Pilot: a regional plumbing supply chain puts a Tidewell flyer at the counter and gets fifteen percent of first-year revenue for accounts that use their code.',
      'If the pilot brings ten paying accounts by December, we build supplier price lists into the [[Integrations Roadmap]].',
    ],
    table: { head: ['Partner', 'Type', 'Accounts', 'Revenue share'], rows: [['Supply chain pilot', 'supply store', '3', '15% year one']] },
    related: ['Referral Program', 'Integrations Roadmap', 'Cold Email'],
    mentions: ['Partner channel pilot brought one more account.', 'Printed new flyers for the [[Partner Channel]] pilot.', 'Partner revenue share paperwork is done.'],
  },
];

interface Entity {
  key: string;
  title: string;
  kind: 'person' | 'company' | 'tool';
  body: string;
  table: { head: string[]; rows: string[][] };
  related: string[];
  mentions: string[];
  offset: number;
}

const ENTITIES: Entity[] = [
  {
    key: 'vault-ilse-varga', title: 'Ilse Varga', kind: 'person', offset: -108,
    body: 'Advisor since spring. Ran operations at a regional HVAC company for eleven years, so she knows how an office manager thinks. Monthly advisory call on the second Tuesday. Strong opinions on [[Pricing]] for existing customers and on keeping [[Support Load]] personal while we are small.',
    table: { head: ['Topic', 'Her view'], rows: [['Price changes', 'grandfather existing accounts one renewal'], ['Hiring', 'support before sales'], ['Partners', 'supply stores beat associations']] },
    related: ['Pricing', 'Hiring Plan', 'Partner Channel'],
    mentions: ['Sent Ilse the churn numbers before our call.', 'Ilse Varga suggested a supply store pilot.'],
  },
  {
    key: 'vault-tobin-achebe', title: 'Tobin Achebe', kind: 'person', offset: -79,
    body: 'Contract engineer starting in October, twenty hours a week. Owns calendar sync, the import wizard and web releases. Previously built dispatch software for a courier company. Approves web releases per [[Release Cadence]].',
    table: { head: ['Area', 'Ownership'], rows: [['Calendar sync', 'owner'], ['Import wizard', 'owner'], ['Web releases', 'approver']] },
    related: ['Hiring Plan', 'Release Cadence', 'Feature Flags'],
    mentions: ['Paired with Tobin on the import wizard.', 'Tobin Achebe fixed the calendar token refresh.'],
  },
  {
    key: 'vault-wren-castellanos', title: 'Wren Castellanos', kind: 'person', offset: -76,
    body: 'Part-time support contractor. Handles the customer import queue on Tuesdays and Thursdays and writes the help-centre articles. Escalates cancellation requests to the save playbook.',
    table: { head: ['Day', 'Focus'], rows: [['Tuesday', 'import queue'], ['Thursday', 'import queue + articles']] },
    related: ['Support Load', 'Onboarding Checklist'],
    mentions: ['Wren cleared nine import tickets.', 'Wren Castellanos drafted the calendar sync help article.'],
  },
  {
    key: 'vault-harrowgate', title: 'Harrowgate Plumbing Co', kind: 'company', offset: -90,
    body: 'Customer since March, eight crews, Crew Plus plan. Almost churned in August because their calendar sync silently stopped after the office manager changed her password; jobs stopped appearing on crew phones for two days. Saved after a call and a month of credit.',
    table: { head: ['Field', 'Value'], rows: [['Plan', 'Crew Plus'], ['Crews', '8'], ['Risk', 'recovered (August)']] },
    related: ['Churn', 'Support Load'],
    mentions: ['Harrowgate jobs synced fine this week.', 'Checked in with Harrowgate Plumbing after the outage.'],
  },
  {
    key: 'vault-brightline', title: 'Brightline Facilities', kind: 'company', offset: -60,
    body: 'Largest prospect: fourteen crews across two towns. Sent a long [[Security Questionnaire]] and asked for single sign-on beyond Google. Came in through the [[Referral Program]] from a landscaping customer.',
    table: { head: ['Field', 'Value'], rows: [['Crews', '14'], ['Stage', 'security review'], ['Source', 'referral']] },
    related: ['Security Questionnaire', 'Referral Program'],
    mentions: ['Brightline asked about SSO again.', 'Brightline Facilities wants a pilot in one town first.'],
  },
  {
    key: 'vault-quillfeather', title: 'Quillfeather Labs', kind: 'company', offset: -86,
    body: 'Main competitor for mid-size offices. Charges a flat 240 per office per month regardless of crew count, bundles invoicing, and has a slower setup. Wins offices over twenty crews; loses small shops on price and setup time.',
    table: { head: ['Dimension', 'Quillfeather', 'Tidewell'], rows: [['Price model', 'flat per office', 'per crew'], ['Setup', 'days', 'minutes'], ['Invoicing', 'built in', 'export']] },
    related: ['Positioning', 'Pricing'],
    mentions: ['Lost a deal to Quillfeather on invoicing.', 'A prospect is switching from Quillfeather Labs because of setup time.'],
  },
  {
    key: 'vault-halyard-crm', title: 'Halyard CRM', kind: 'tool', offset: -87,
    body: 'The CRM we use for the sales pipeline. Cold email replies land here automatically; every deal has a next step and a date. Pipeline stages: replied, demo booked, trial, paying.',
    table: { head: ['Stage', 'Deals'], rows: [['Replied', '14'], ['Demo booked', '6'], ['Trial', '9'], ['Paying', '71']] },
    related: ['Cold Email', 'Positioning'],
    mentions: ['Cleaned up stale deals in Halyard.', 'Halyard CRM pipeline review: six demos booked.'],
  },
  {
    key: 'vault-ledgerly', title: 'Ledgerly', kind: 'tool', offset: -102,
    body: 'Billing tool. Handles per crew subscriptions, referral credits and dunning. Annual plans and renewal reminders are configured here.',
    table: { head: ['Feature', 'Used'], rows: [['Per seat billing', 'yes'], ['Credits', 'yes'], ['Dunning', 'yes']] },
    related: ['Pricing', 'Annual Billing', 'Referral Program'],
    mentions: ['Ledgerly dunning recovered two failed cards.', 'Configured renewal reminders in Ledgerly.'],
  },
];

interface Source {
  key: string;
  title: string;
  body: string[];
  related: string[];
  offset: number;
}

const SOURCES: Source[] = [
  {
    key: 'vault-src-podcast-trades', title: 'Source — Podcast: Selling to Trades Businesses ep 41', offset: -98,
    body: [
      'Host interviewed a former plumbing supply rep about selling software to plumbing businesses. Main points: owners buy from people they meet at the supply counter; demos must happen before 7am or after 5pm; never pitch during the morning dispatch rush.',
      'Takeaways for us: the [[Partner Channel]] idea is right; demo booking links should offer early-morning slots; [[Cold Email]] should mention the supply store the shop uses.',
    ],
    related: ['Partner Channel', 'Cold Email'],
  },
  {
    key: 'vault-src-activation-cliff', title: 'Source — Article: The Activation Cliff', offset: -93,
    body: [
      'Essay arguing that most B2B trials decide in the first three sessions and that an activation metric should require collaboration (two users), not just usage by one person.',
      'Applied: our [[Activation Metric]] requires two different crews closing jobs, which matches the article\'s collaboration rule.',
    ],
    related: ['Activation Metric', 'Onboarding Checklist'],
  },
  {
    key: 'vault-src-calm-pricing', title: 'Source — Book notes: Calm Pricing', offset: -97,
    body: [
      'Notes from a short book on pricing for small software companies. Chapters on value metrics (charge for what grows with the customer), grandfathering, and annual plans framed as months free instead of percentages.',
      'Applied: per crew is our value metric; [[Annual Billing]] is framed as two months free; grandfathering rule went into [[Pricing]].',
    ],
    related: ['Pricing', 'Annual Billing'],
  },
  {
    key: 'vault-src-soc2-webinar', title: 'Source — Webinar: SOC 2 for Tiny Teams', offset: -47,
    body: [
      'Webinar on SOC 2 readiness for teams under five people. Lessons: start with a written access review and an offboarding checklist; a readiness assessment costs less than the audit and finds most gaps; auditors care about evidence that policies are followed, not about policy length.',
      'What we learned for the [[Security Questionnaire]]: answer "readiness in progress" honestly, link the [[Data Retention Policy]], and schedule the first quarterly access review.',
    ],
    related: ['Security Questionnaire', 'Data Retention Policy'],
  },
  {
    key: 'vault-src-field-survey', title: 'Source — Report: Field Service Software Survey 2026', offset: -40,
    body: [
      'Industry survey of 600 trades offices. Findings: 41% still schedule on whiteboards or spreadsheets; the top reason for switching tools is crews not seeing schedule changes; average willingness to pay is 30 to 60 per crew per month.',
      'Supports our [[Positioning]] (whiteboard to phones) and the Crew Plus price point in [[Pricing]].',
    ],
    related: ['Positioning', 'Pricing'],
  },
];

interface Meeting {
  key: string;
  title: string;
  body: string[];
  related: string[];
  offset: number;
  explicitDate: string;
}

const MEETINGS: Meeting[] = [
  {
    key: 'vault-mtg-ilse-0812', title: 'Meeting — Ilse Varga advisory call 2026-08-12', offset: -72, explicitDate: '2026-08-12',
    body: [
      'Agenda: price review, support hire timing, partner pilot.',
      'Ilse advised grandfathering existing customers on their current price for one full renewal and giving ninety days notice before any increase. Her reasoning: trades owners remember who raised prices on them and tell the supply counter.',
      'On support: hire support before sales; the founder should keep answering tickets until volume passes 120 a week.',
      'Action items: write the grandfathering rule into [[Pricing]]; draft a supply store pitch for the [[Partner Channel]].',
    ],
    related: ['Pricing', 'Partner Channel', 'Ilse Varga', 'Support Load'],
  },
  {
    key: 'vault-mtg-harrowgate-0821', title: 'Meeting — Harrowgate save call 2026-08-21', offset: -63, explicitDate: '2026-08-21',
    body: [
      'Office manager was ready to cancel: jobs disappeared from crew phones for two days. Root cause: calendar sync token expired after her password change and we did not alert anyone.',
      'Fix: Tobin added a sync-health alert email. Offered one month of credit; she agreed to stay. Logged under [[Churn]] as a save.',
    ],
    related: ['Harrowgate Plumbing Co', 'Churn', 'Support Load'],
  },
  {
    key: 'vault-mtg-brightline-0910', title: 'Meeting — Brightline security review 2026-09-10', offset: -43, explicitDate: '2026-09-10',
    body: [
      'Walked their IT contractor through the questionnaire answers. Open items: SSO beyond Google, a penetration test date, and written proof of the photo purge in the retention policy.',
      'Next step: send the pilot proposal for one town with fourteen crews split across two offices.',
    ],
    related: ['Brightline Facilities', 'Security Questionnaire', 'Data Retention Policy'],
  },
];

const HUBS: Array<{ key: string; title: string; intro: string; members: string[]; offset: number }> = [
  {
    key: 'vault-moc-business', title: 'Business MOC', offset: -20,
    intro: 'Map of content for running the business. Every concept note is linked here with one line on why it matters.',
    members: ['Pricing', 'Annual Billing', 'Churn', 'Runway', 'Hiring Plan', 'Positioning', 'Cold Email', 'Referral Program', 'Partner Channel', 'Customer Interviews'],
  },
  {
    key: 'vault-moc-product', title: 'Product MOC', offset: -18,
    intro: 'Map of content for the product side: onboarding, metrics, shipping and security.',
    members: ['Onboarding Checklist', 'Activation Metric', 'Support Load', 'Feature Flags', 'Release Cadence', 'Integrations Roadmap', 'Security Questionnaire', 'Data Retention Policy'],
  },
];

// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mdTable(t: { head: string[]; rows: string[][] }): string {
  return [`| ${t.head.join(' | ')} |`, `|${t.head.map(() => '---').join('|')}|`, ...t.rows.map(r => `| ${r.join(' | ')} |`)].join('\n');
}

function related(titles: string[]): string {
  return `## Related\n\n${titles.map(t => `- [[${t}]]`).join('\n')}`;
}

const DAILY_COUNT = 32;
const WEEKLY_COUNT = 6;
/** 2026-10-23 minus |offset| days = the note's date; only used for titles. */
const ANCHOR = Date.UTC(2026, 9, 23);
const isoDay = (offset: number) => new Date(ANCHOR + offset * 86_400_000).toISOString().slice(0, 10);

function conceptNote(c: Concept): SeedMemory {
  const content = [
    `# ${c.title}`,
    '',
    `> ${c.summary}`,
    '',
    '## Details',
    '',
    c.details.join('\n\n'),
    '',
    '## Numbers',
    '',
    mdTable(c.table),
    '',
    related(c.related),
    '',
    '## Log',
    '',
    `- ${isoDay(c.offset)} — note created`,
    `- ${isoDay(c.offset + 30)} — reviewed in the weekly review`,
  ].join('\n');
  return { key: c.key, archetype: VAULT_ARCHETYPE, title: c.title, content, tags: ['concept'], importance: c.importance ?? 0.5, memoryClass: 'SEMANTIC', confidence: 'HIGH', createdAtOffsetDays: c.offset };
}

function entityNote(e: Entity): SeedMemory {
  const content = [`# ${e.title}`, '', `Type: ${e.kind}`, '', '## Notes', '', e.body, '', '## Facts', '', mdTable(e.table), '', related(e.related)].join('\n');
  return { key: e.key, archetype: VAULT_ARCHETYPE, title: e.title, content, tags: ['entity', e.kind], importance: 0.5, memoryClass: 'SEMANTIC', confidence: 'HIGH', createdAtOffsetDays: e.offset };
}

function sourceNote(s: Source): SeedMemory {
  const content = [`# ${s.title}`, '', '## Summary', '', s.body.join('\n\n'), '', related(s.related)].join('\n');
  return { key: s.key, archetype: VAULT_ARCHETYPE, title: s.title, content, tags: ['source'], importance: 0.5, memoryClass: 'SEMANTIC', confidence: 'MEDIUM', createdAtOffsetDays: s.offset };
}

function meetingNote(m: Meeting): SeedMemory {
  const content = [`# ${m.title}`, '', `Date: ${m.explicitDate}`, '', '## Notes', '', m.body.join('\n\n'), '', related(m.related)].join('\n');
  return { key: m.key, archetype: VAULT_ARCHETYPE, title: m.title, content, tags: ['meeting'], importance: 0.5, memoryClass: 'EPISODIC', confidence: 'HIGH', createdAtOffsetDays: m.offset, explicitDate: m.explicitDate };
}

function hubNote(h: (typeof HUBS)[number]): SeedMemory {
  const lines = h.members.map(t => {
    const c = CONCEPTS.find(x => x.title === t);
    return `| [[${t}]] | ${c ? c.summary.replace(/\[\[|\]\]/g, '').split('. ')[0] : ''} |`;
  });
  const content = [`# ${h.title}`, '', h.intro, '', '| Note | Why it matters |', '|---|---|', ...lines, '', '## Open threads', '', ...h.members.slice(0, 4).map(t => `- Revisit [[${t}]] next month`)].join('\n');
  return { key: h.key, archetype: VAULT_ARCHETYPE, title: h.title, content, tags: ['moc'], importance: 0.5, memoryClass: 'SEMANTIC', confidence: 'HIGH', createdAtOffsetDays: h.offset };
}

const ALL_MENTIONERS: Array<{ title: string; mentions: string[] }> = [...CONCEPTS, ...ENTITIES];

function dailyNote(i: number, rnd: () => number): SeedMemory {
  const offset = -2 - i * 3;
  const day = isoDay(offset);
  const picks: Array<{ title: string; mentions: string[] }> = [];
  while (picks.length < 7) {
    const c = ALL_MENTIONERS[Math.floor(rnd() * ALL_MENTIONERS.length)];
    if (!picks.includes(c)) picks.push(c);
  }
  const bullets = picks.map(c => `- ${c.mentions[Math.floor(rnd() * c.mentions.length)]}`);
  const tasks = picks.slice(0, 3).map((c, j) => `| Follow up on [[${c.title}]] | ${['open', 'done', 'waiting'][(i + j) % 3]} |`);
  const content = [
    `# ${day}`, '',
    '## Morning', '', bullets.slice(0, 3).join('\n'), '',
    '## Afternoon', '', bullets.slice(3, 5).join('\n'), '',
    '## Evening', '', bullets.slice(5).join('\n'), '',
    '## Inbox', '', '- [ ] Reply to two trial accounts', '- [ ] File receipts', '- [x] Check the sync-health alerts', '',
    '## Tasks', '', '| Task | Status |', '|---|---|', ...tasks, '',
    `Energy ${['low', 'ok', 'good'][i % 3]}. Mostly calls and admin today; ${picks[0].title.toLowerCase()} and ${picks[1].title.toLowerCase()} took the most time.`,
  ].join('\n');
  return { key: `vault-daily-${String(i + 1).padStart(2, '0')}`, archetype: VAULT_ARCHETYPE, title: day, content, tags: ['daily'], importance: 0.5, memoryClass: 'EPISODIC', confidence: 'MEDIUM', createdAtOffsetDays: offset };
}

function weeklyNote(i: number, rnd: () => number): SeedMemory {
  const offset = -5 - i * 14;
  const picks = CONCEPTS.filter(() => rnd() < 0.45).slice(0, 7);
  const rows = picks.map(c => `| [[${c.title}]] | ${c.mentions[Math.floor(rnd() * c.mentions.length)].replace(/\|/g, '/')} |`);
  const content = [
    `# Weekly Review ${isoDay(offset)}`, '',
    '## What moved', '', '| Area | Note |', '|---|---|', ...rows, '',
    '## Next week', '', ...picks.slice(0, 3).map(c => `- Decide the next step on ${c.title.toLowerCase()} and update [[${c.title}]]`),
  ].join('\n');
  return { key: `vault-weekly-${String(i + 1).padStart(2, '0')}`, archetype: VAULT_ARCHETYPE, title: `Weekly Review ${isoDay(offset)}`, content, tags: ['weekly'], importance: 0.5, memoryClass: 'EPISODIC', confidence: 'MEDIUM', createdAtOffsetDays: offset };
}

/** The vault archetype's memories, in a stable order. */
export function buildVaultMemories(): SeedMemory[] {
  const rnd = mulberry32(0x7a1de);
  return [
    ...CONCEPTS.map(conceptNote),
    ...ENTITIES.map(entityNote),
    ...SOURCES.map(sourceNote),
    ...MEETINGS.map(meetingNote),
    ...HUBS.map(hubNote),
    ...Array.from({ length: DAILY_COUNT }, (_, i) => dailyNote(i, rnd)),
    ...Array.from({ length: WEEKLY_COUNT }, (_, i) => weeklyNote(i, rnd)),
  ];
}

/** Archetype declaration merged into the seed file by loadSeedFile(). */
export const VAULT_ARCHETYPE_CONFIG = { userIdSuffix: 'vault', domain: 'business', kind: 'vault' as const };
