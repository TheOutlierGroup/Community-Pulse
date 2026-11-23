import { SURVEY_SCALE, stripEmphasis } from '../../utils/surveyText.js';
import EmphasisText from './EmphasisText.jsx';

export default function SurveyQuestionStep({
  title,
  subtitle,
  note = null,
  questions,
  answers,
  onAnswer,
  startQuestionNumber = 1,
  missingIds = [],
}) {
  const missing = new Set(Array.isArray(missingIds) ? missingIds : []);
  return (
    <div>
      <div className="step1-intro">
        <p className="step1-intro-lead">{title}</p>
        {subtitle ? (
          <p className="step1-intro-hint muted">
            {typeof subtitle === 'string' ? <EmphasisText text={subtitle} /> : subtitle}
          </p>
        ) : null}
        {note ? (
          <p className="survey-section-note">{typeof note === 'string' ? <EmphasisText text={note} /> : note}</p>
        ) : null}
      </div>

      {questions.map((question, index) => {
        const isMissing = missing.has(question.id);
        const plainText = stripEmphasis(question.text);
        return (
          <div
            key={question.id}
            id={`survey-q-${question.id}`}
            className={`theme-row${isMissing ? ' theme-row--missing' : ''}`}
          >
            <header>
              <span className="label">
                {startQuestionNumber + index}. <EmphasisText text={question.text} />
              </span>
            </header>
            {isMissing ? <p className="theme-row__missing-hint">Please choose an answer.</p> : null}
            <div role="radiogroup" aria-label={plainText} className="survey-scale">
              {SURVEY_SCALE.map((option) => {
                const selected = answers[question.id] === option.value;
                return (
                  <button
                    key={`${question.id}-${option.value}`}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={`${option.value}: ${option.label}`}
                    className={`btn survey-scale__option ${selected ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => onAnswer(question.id, option.value)}
                  >
                    <span className="survey-scale__value">{option.value}</span>
                    <span className="survey-scale__label">{option.label}</span>
                  </button>
                );
              })}
            </div>
            <p className="survey-scale__legend" aria-hidden="true">
              <span>Strongly disagree</span>
              <span>Neither</span>
              <span>Strongly agree</span>
            </p>
          </div>
        );
      })}
    </div>
  );
}
