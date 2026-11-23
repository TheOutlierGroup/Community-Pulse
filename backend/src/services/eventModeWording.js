/**
 * Event mode wording, version "event-v1". Approved by the product owner on
 * 23 Nov 2026 (see EVENT_MODE_WORDING.md).
 *
 * Statement ids and order are unchanged, so scoring is unaffected; only the
 * text a respondent reads differs. `**phrase**` marks the key phrase the
 * survey renders in bold (parsed on the frontend, never treated as HTML).
 */

export const EVENT_STAFF_STATEMENTS = {
  pre: {
    Q1: 'When change has happened here before, I got **enough support to genuinely work well** in the new way.',
    Q2: 'Right now, I have **the time, energy and headspace to learn something new** at work.',
    Q3: 'Changes made here **usually stick** over time.',
    Q4: "I've seen change here **delivered in a way that was organised and manageable**.",
    Q5: 'The **amount of change happening right now feels manageable** to me.',
    Q6: 'My team has **room right now to take on something significant** without dropping something else.',
    Q7: 'My manager **talks with me about what changes mean for me**, rather than just passing on information.',
    Q8: 'When I raise concerns about a change, I **feel genuinely listened to**.',
    Q9: 'Senior leaders here **visibly live the changes** they announce.',
    Q10: 'When change gets hard, senior leaders **stay visibly involved**.',
    Q11: 'My manager **follows the same changes** they ask of me.',
    Q12: 'What senior leaders say will happen during a change **matches what actually happens**.',
    Q13: 'Senior leaders are **honest about the hard parts** of a change, not just the positives.',
    Q14: "When something isn't working, senior leaders **change the approach** rather than pushing harder.",
    Q15: "It's **safe to say I'm struggling** with a change here.",
    Q16: "If I struggled with a major change, I'm confident senior leaders would **support me rather than performance-manage me**.",
  },
  mid: {
    Q1: "During this change, I'm getting **enough support to genuinely work well** in the new way.",
    Q2: 'While this change is underway, I have **the time, energy and headspace to keep learning**.',
    Q3: 'So far, the **new ways of working are sticking**.',
    Q4: 'This change is being **delivered in a way that feels organised and manageable**.',
    Q5: 'The **amount of change happening at once feels manageable** to me.',
    // Same meaning as Pre Q6 (room to take on change without dropping
    // something else), in the present: tense only (Post retest, 24 Nov 2026).
    Q6: 'My team has had **room to take on this change** without dropping something else.',
    Q7: 'My manager **talks with me about what this change means for me**, rather than just passing on information.',
    Q8: "When I've raised concerns about this change, I've **felt genuinely listened to**.",
    Q9: 'Senior leaders are **visibly living this change** themselves.',
    Q10: "Now that this change is underway, senior leaders are **staying visibly involved**, even when it's hard.",
    Q11: 'My manager **is following the same changes** they ask of me.',
    Q12: 'What senior leaders said would happen in this change **is matching what is actually happening**.',
    Q13: 'Senior leaders are being **honest about the hard parts** of this change, not just the positives.',
    Q14: "When something hasn't worked in this change, senior leaders have **changed the approach** rather than pushing harder.",
    Q15: "It feels **safe to say I'm struggling** with this change.",
    Q16: "If I struggle with this change, I'm confident senior leaders will **support me rather than performance-manage me**.",
  },
  post: {
    Q1: 'During this change, I got **enough support to genuinely work well** in the new way.',
    Q2: 'Throughout this change, I had **the time, energy and headspace to learn and adapt**.',
    Q3: 'The **changes from this programme have stuck**.',
    Q4: 'This change was **delivered in a way that felt organised and manageable**.',
    Q5: 'The **amount of change happening at once felt manageable** to me.',
    Q6: 'My team had **room to take on this change** without dropping something else.',
    Q7: 'My manager **talked with me about what this change meant for me**, rather than just passing on information.',
    Q8: 'When I raised concerns about this change, I **felt genuinely listened to**.',
    Q9: 'Senior leaders **visibly lived this change** themselves throughout.',
    Q10: 'When this change got hard, senior leaders **stayed visibly involved**.',
    Q11: 'My manager **followed the same changes** they asked of me.',
    Q12: 'What senior leaders said would happen in this change **matched what actually happened**.',
    Q13: 'Senior leaders were **honest about the hard parts** of this change, not just the positives.',
    Q14: "When something wasn't working in this change, senior leaders **changed the approach** rather than pushing harder.",
    Q15: 'It was **safe to say I was struggling** with this change.',
    Q16: 'If I struggled during this change, senior leaders **supported me rather than performance-managing me**.',
  },
};

export const EVENT_MANAGER_STATEMENTS = {
  pre: {
    MQ1: 'I have the **information and support I need** to help my team through this kind of change.',
    MQ2: 'I have **enough time to actively support my team** through a major change, not just announce it.',
    MQ3: 'Big changes my team has adopted before **have stuck**.',
    MQ4: "During past changes, I've **kept my team's performance and morale steady**.",
    MQ5: 'The **number of initiatives my team is juggling feels manageable**.',
    MQ6: 'I have **room to take on the extra management work** a major change would bring.',
    MQ7: 'I have **the authority to make the decisions** my team needs during change, without constantly waiting for approval.',
    MQ8: 'When I raise concerns with senior leaders, they **genuinely engage with my input**.',
    MQ9: 'Senior leaders here **visibly model the changes** they ask of others.',
    MQ10: 'When change gets difficult, I can count on senior leaders to **stay visible rather than leave managers to handle it**.',
    MQ11: 'I **understand why changes are happening** well enough to explain them convincingly to my team.',
    MQ12: 'Senior leaders **give consistent messages** about this change.',
    MQ13: 'I have **the flexibility to adapt how change is rolled out** for my team.',
    MQ14: 'I feel **supported to be honest with my team about the hard parts** of a change.',
    MQ15: 'Leading my team through significant change is **personally sustainable** for me.',
    MQ16: 'I have **the skills and tools to lead my team through** a major change.',
  },
  mid: {
    MQ1: 'I have the **information and support I need** to help my team through this change as it unfolds.',
    MQ2: 'Right now, I have **enough time to actively support my team** through this change, not just announce it.',
    MQ3: "My team's **new ways of working are starting to stick**.",
    MQ4: "So far in this change, I've **kept my team's performance and morale steady**.",
    MQ5: 'The **number of things my team is juggling feels manageable** during this change.',
    MQ6: 'I have **room for the extra management work** this change requires.',
    MQ7: 'I have **the authority to make the decisions** my team needs during this change, without constantly waiting for approval.',
    MQ8: 'When I raise concerns about this change, senior leaders **genuinely engage with my input**.',
    MQ9: 'Senior leaders are **visibly modelling this change**, not just advocating for it.',
    MQ10: 'When this change gets difficult, senior leaders **stay visible rather than leave managers to handle it**.',
    MQ11: 'I **understand why this change is happening** well enough to explain it convincingly to my team.',
    MQ12: 'Senior leaders are **giving consistent messages** about this change.',
    MQ13: 'I have **the flexibility to adapt how this change is rolled out** for my team.',
    MQ14: 'I feel **supported to be honest with my team about the hard parts** of this change.',
    MQ15: 'Leading my team through this change is **personally sustainable** for me.',
    MQ16: 'I have **the skills and tools to lead my team through** this change.',
  },
  post: {
    MQ1: 'Throughout this change, I had the **information and support I needed** to help my team.',
    MQ2: 'Throughout this change, I had **enough time to actively support my team**, not just announce it.',
    MQ3: "My team's **new ways of working have stuck**.",
    MQ4: "Throughout this change, I **kept my team's performance and morale steady**.",
    MQ5: 'The **number of things my team was juggling felt manageable** during this change.',
    MQ6: 'I had **room for the extra management work** this change required.',
    MQ7: 'I had **the authority to make the decisions** my team needed during this change, without constantly waiting for approval.',
    MQ8: 'When I raised concerns about this change, senior leaders **genuinely engaged with my input**.',
    MQ9: 'Senior leaders **visibly modelled this change** throughout, not just advocated for it.',
    MQ10: 'When this change got difficult, senior leaders **stayed visible rather than leaving managers to handle it**.',
    MQ11: 'I **understood why this change was happening** well enough to explain it convincingly to my team.',
    MQ12: 'Senior leaders **gave consistent messages** about this change.',
    MQ13: 'I had **the flexibility to adapt how this change was rolled out** for my team.',
    MQ14: 'I felt **supported to be honest with my team about the hard parts** of this change.',
    MQ15: 'Leading my team through this change was **personally sustainable** for me.',
    MQ16: 'I had **the skills and tools to lead my team through** this change.',
  },
};

const STAFF_INSTRUCTION =
  'Rate each statement from **1 (Strongly disagree)** to **5 (Strongly agree)**. There are no right or wrong answers.';
const MANAGER_INSTRUCTION =
  'Answer as a manager. Rate each statement from **1 (Strongly disagree)** to **5 (Strongly agree)**. There are no right or wrong answers.';

export const EVENT_SURVEY_COPY = {
  pre: {
    staffIntro: 'Before this change starts, we want to know how ready you feel. Your honest answers show where support is needed most.',
    managerIntro: 'Before this change starts, we want to know how ready you feel to lead your team through it, and what support you need.',
    reflection: "Your answers set the starting point. We'll ask again partway through the change to see what has improved.",
  },
  mid: {
    staffIntro: "This change is now underway. We want to know how it's going for you, so support goes where it's needed.",
    managerIntro: "This change is now underway. We want to know how it's going for you as a manager, where pressure is highest, and what support would help most right now.",
    reflection: "Your answers show what's improving and what still needs attention while the change is underway.",
  },
  post: {
    staffIntro: 'This change programme has finished. We want to know how it went for you: what worked and what was hard.',
    managerIntro: 'This change programme has finished. We want to know how it went for you as a manager, and what should be different next time.',
    reflection: 'Your reflections will help the organisation learn from this programme and do the next one better.',
  },
};

function stageKey(stage) {
  const raw = String(stage || '').trim().toLowerCase();
  if (raw === 'mid' || raw === 'during') return 'mid';
  if (raw === 'post' || raw === 'completed') return 'post';
  return 'pre';
}

/** Statement text overrides for an audience and stage, keyed by question id. */
export function eventStatementText(audience, stage) {
  const set = audience === 'manager' ? EVENT_MANAGER_STATEMENTS : EVENT_STAFF_STATEMENTS;
  return set[stageKey(stage)];
}

/** Survey copy overrides (intro, instruction, reflection) for Event mode. */
export function eventSurveyCopy(audience, stage) {
  const copy = EVENT_SURVEY_COPY[stageKey(stage)];
  const isManager = audience === 'manager';
  return {
    intro: isManager ? copy.managerIntro : copy.staffIntro,
    transition: isManager ? MANAGER_INSTRUCTION : STAFF_INSTRUCTION,
    halfwayNote: "**You're halfway.** The next questions are about how senior leaders support this change.",
    reflection: copy.reflection,
  };
}
