const SCALE = [
  { value: 1, label: 'Strongly Disagree' },
  { value: 2, label: 'Disagree' },
  { value: 3, label: 'Neutral' },
  { value: 4, label: 'Agree' },
  { value: 5, label: 'Strongly Agree' },
];

export default function SurveyQuestionStep({ title, subtitle, questions, answers, onAnswer }) {
  return (
    <div>
      <div className="step1-intro">
        <p className="step1-intro-lead">{title}</p>
        {subtitle ? <p className="step1-intro-hint muted">{subtitle}</p> : null}
      </div>

      {questions.map((question) => (
        <div key={question.id} className="theme-row">
          <header>
            <span className="label">{question.text}</span>
            <span className="value">{answers[question.id] ? SCALE[answers[question.id] - 1]?.label : 'Unanswered'}</span>
          </header>
          <div
            role="radiogroup"
            aria-label={question.text}
            style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}
          >
            {SCALE.map((option) => (
              <button
                key={`${question.id}-${option.value}`}
                type="button"
                className={`btn ${answers[question.id] === option.value ? 'btn-primary' : 'btn-ghost'}`}
                style={{ minWidth: 74, padding: '0.38rem 0.55rem', fontSize: '0.82rem' }}
                onClick={() => onAnswer(question.id, option.value)}
              >
                {option.value}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
